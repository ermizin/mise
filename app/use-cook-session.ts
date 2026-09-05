"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeCookSessionMutation,
  beginCookSessionRequest,
  normalizeCookSessionEnvelope,
  normalizeCookSessionState,
  queueCookSessionUpdate,
  reconcileCookSessionLoad,
  type CookSessionEnvelope,
  type CookSessionState,
} from "../domain/cook-session";

type SyncState = "loading" | "saved" | "saving" | "offline" | "error" | "conflict";
type Update = CookSessionState | ((current: CookSessionState) => CookSessionState);

export type UseCookSessionOptions = {
  planId: string;
  batchId: string;
  sessionKey: string;
  initialState: CookSessionState;
};

const timeoutMs = 10_000;

function storageKey({ planId, batchId, sessionKey }: UseCookSessionOptions) {
  return `mise-cook-session-v1:${planId}:${batchId}:${sessionKey}`;
}

function mutationId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mise-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storedIdentifier(key: "mise-client-id" | "mise-device-id") {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved) return saved;
    const created = mutationId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return "";
  }
}

function readEnvelope(options: UseCookSessionOptions) {
  const fallback = normalizeCookSessionState(options.initialState);
  if (typeof window === "undefined") return { envelope: normalizeCookSessionEnvelope(null, fallback), failed: false };
  try {
    return {
      envelope: normalizeCookSessionEnvelope((() => {
        const raw = window.localStorage.getItem(storageKey(options));
        return raw ? JSON.parse(raw) : null;
      })(), fallback),
      failed: false,
    };
  } catch {
    return { envelope: normalizeCookSessionEnvelope(null, fallback), failed: true };
  }
}

function saveEnvelope(options: UseCookSessionOptions, envelope: CookSessionEnvelope) {
  try {
    window.localStorage.setItem(storageKey(options), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

async function responseJson(response: Response) {
  try {
    return await response.json() as { state?: unknown; revision?: unknown; mutationId?: unknown; pushScheduled?: unknown };
  } catch {
    return {};
  }
}

export function useCookSession(options: UseCookSessionOptions) {
  // A cooking surface is keyed by sessionKey. Keep its durable requests bound
  // to that original key even if a parent renders with new props mid-flight.
  const [fixedOptions] = useState(() => options);
  const [initial] = useState(() => readEnvelope(fixedOptions));
  const envelopeRef = useRef(initial.envelope);
  const mounted = useRef(false);
  const sending = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const networkAttempts = useRef(0);
  const loadGeneration = useRef(0);
  const scheduleNetworkRetryRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState(initial.envelope.state);
  const [syncState, setSyncState] = useState<SyncState>(initial.failed ? "error" : "loading");
  const [pushScheduled, setPushScheduled] = useState(false);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const setVisible = useCallback((next: SyncState) => {
    if (mounted.current) setSyncState(next);
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while ((envelopeRef.current.inFlight || envelopeRef.current.pending) && !envelopeRef.current.conflict) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setVisible("offline");
          return;
        }
        if (!envelopeRef.current.inFlight) {
          envelopeRef.current = beginCookSessionRequest(envelopeRef.current);
          if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
            setVisible("error");
            return;
          }
        }
        const inFlight = envelopeRef.current.inFlight;
        if (!inFlight) return;
        setVisible("saving");
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch("/api/cook-sessions", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-mise-client": storedIdentifier("mise-client-id"),
              "x-mise-device": storedIdentifier("mise-device-id"),
            },
            body: JSON.stringify({
              planId: fixedOptions.planId,
              batchId: fixedOptions.batchId,
              sessionKey: fixedOptions.sessionKey,
              revision: inFlight.revision,
              mutationId: inFlight.mutationId,
              state: inFlight.state,
            }),
            signal: controller.signal,
          });
        } catch {
          setVisible(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
          // The online event can arrive before a captive/mobile transport is
          // usable. Keep this exact inFlight snapshot and try a few times.
          scheduleNetworkRetryRef.current();
          return;
        } finally {
          window.clearTimeout(timeout);
        }
        const body = await responseJson(response);
        const serverState = body.state ? normalizeCookSessionState(body.state, Date.now(), false) : null;
        const serverRevision = typeof body.revision === "number" && Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null;
        if (response.status === 409 && serverState && serverRevision !== null) {
          const current = envelopeRef.current;
          envelopeRef.current = {
            ...current,
            conflict: { state: serverState, revision: serverRevision },
          };
          saveEnvelope(fixedOptions, envelopeRef.current);
          setVisible("conflict");
          return;
        }
        if (!response.ok || !serverState || serverRevision === null) {
          setVisible("error");
          return;
        }
        envelopeRef.current = acknowledgeCookSessionMutation(
          envelopeRef.current,
          inFlight.mutationId,
          serverState,
          serverRevision,
        );
        if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
          setVisible("error");
          return;
        }
        if (!envelopeRef.current.pending && !envelopeRef.current.inFlight && mounted.current)
          setState(serverState);
        if (mounted.current) setPushScheduled(body.pushScheduled === true);
        networkAttempts.current = 0;
        loadGeneration.current += 1;
        if (retryTimer.current !== null) {
          window.clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }
      }
      if (!envelopeRef.current.conflict) setVisible("saved");
    } finally {
      sending.current = false;
    }
  }, [fixedOptions, setVisible]);

  const scheduleNetworkRetry = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (retryTimer.current !== null || networkAttempts.current >= 3) return;
    const delay = [1_000, 2_000, 5_000][networkAttempts.current] ?? 5_000;
    networkAttempts.current += 1;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      void flush();
    }, delay);
  }, [flush]);

  useEffect(() => {
    scheduleNetworkRetryRef.current = scheduleNetworkRetry;
  }, [scheduleNetworkRetry]);

  const update = useCallback((next: Update) => {
    const current = envelopeRef.current.state;
    const proposed = typeof next === "function" ? next(current) : next;
    const state = normalizeCookSessionState({ ...proposed, updatedAt: Date.now() }, Date.now(), false);
    if (envelopeRef.current.conflict) {
      setVisible("conflict");
      return;
    }
    envelopeRef.current = queueCookSessionUpdate(envelopeRef.current, state, mutationId());
    if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
      setVisible("error");
      return;
    }
    if (mounted.current) setState(state);
    void flush();
  }, [fixedOptions, flush, setVisible]);

  const retry = useCallback(() => {
    if (envelopeRef.current.inFlight || envelopeRef.current.pending) void flush();
    else void loadRef.current();
  }, [flush]);

  const resolveConflict = useCallback((choice: "local" | "server") => {
    const conflict = envelopeRef.current.conflict;
    if (!conflict) return;
    if (choice === "server") {
      envelopeRef.current = { ...envelopeRef.current, state: conflict.state, revision: conflict.revision, pending: null, inFlight: null, conflict: null };
      if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
        setVisible("error");
        return;
      }
      if (mounted.current) setState(conflict.state);
      setVisible("saved");
      return;
    }
    const local = envelopeRef.current.state;
    envelopeRef.current = {
      ...envelopeRef.current,
      revision: conflict.revision,
      state: local,
      conflict: null,
      inFlight: null,
      pending: { state: local, revision: conflict.revision, mutationId: mutationId() },
    };
    if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
      setVisible("error");
      return;
    }
    void flush();
  }, [fixedOptions, flush, setVisible]);

  useEffect(() => {
    mounted.current = true;
    const load = async () => {
      // Persist even a pristine initial snapshot: a reload before the first edit
      // must not forget the kitchen state.
      if (!saveEnvelope(fixedOptions, envelopeRef.current)) {
        setVisible("error");
        return;
      }
      const generation = ++loadGeneration.current;
      try {
        const query = new URLSearchParams({ planId: fixedOptions.planId, sessionKey: fixedOptions.sessionKey });
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch(`/api/cook-sessions?${query}`, {
            headers: { "x-mise-client": storedIdentifier("mise-client-id"), "x-mise-device": storedIdentifier("mise-device-id") },
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
        if (generation !== loadGeneration.current) return;
        if (response.status === 404) {
          if (envelopeRef.current.inFlight || envelopeRef.current.pending) {
            setVisible("saving");
            void flush();
          } else setVisible("saved");
          return;
        }
        const body = await responseJson(response);
        if (generation !== loadGeneration.current) return;
        if (!response.ok || !body.state || typeof body.revision !== "number" || !Number.isInteger(body.revision)) throw new Error("load failed");
        const server = normalizeCookSessionState(body.state, Date.now(), false);
        envelopeRef.current = reconcileCookSessionLoad(
          envelopeRef.current,
          server,
          body.revision,
          typeof body.mutationId === "string" ? body.mutationId : null,
        );
        if (!saveEnvelope(fixedOptions, envelopeRef.current)) throw new Error("storage failed");
        if (mounted.current) setPushScheduled(body.pushScheduled === true);
        if (envelopeRef.current.conflict) {
          setVisible("conflict");
          return;
        }
        if (!envelopeRef.current.inFlight && !envelopeRef.current.pending) {
          if (mounted.current) setState(envelopeRef.current.state);
          setVisible("saved");
        } else {
          setVisible("saving");
          void flush();
        }
      } catch {
        if (generation !== loadGeneration.current) return;
        const online = typeof navigator === "undefined" || navigator.onLine !== false;
        setVisible(online ? "error" : "offline");
        if (!online) return;
        if (envelopeRef.current.inFlight || envelopeRef.current.pending) {
          // An offline GET can settle after connectivity has already returned,
          // before the online listener was installed. Its durable outbox still
          // needs a bounded PUT retry without another user action.
          scheduleNetworkRetryRef.current();
          return;
        }
        // With no local write to flush, retry GET itself; calling flush here
        // would incorrectly report an unsynced first load as saved.
        if (retryTimer.current === null && networkAttempts.current < 3) {
          const delay = [1_000, 2_000, 5_000][networkAttempts.current] ?? 5_000;
          networkAttempts.current += 1;
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            void loadRef.current();
          }, delay);
        }
      }
    };
    loadRef.current = load;
    void load();
    const retryWhenReachable = () => { void retry(); };
    window.addEventListener("online", retryWhenReachable);
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") void retry();
    };
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      mounted.current = false;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      window.removeEventListener("online", retryWhenReachable);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [fixedOptions, flush, retry, setVisible]);

  return { state, update, syncState, pushScheduled, retry, resolveConflict };
}

export default useCookSession;
