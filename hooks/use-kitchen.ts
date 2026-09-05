"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultKitchen, isKitchenProfile, type KitchenProfile } from "../domain/kitchen";

type Cache = { value: KitchenProfile; confirmed: KitchenProfile | null; pending: boolean };
export type KitchenSync = "loading" | "synced" | "saving" | "pending" | "error";
export function useKitchen(getClientId: () => string, initialEquipment?: readonly string[], enabled = true) {
  const [editable, setEditable] = useState(false);
  const [value, setValue] = useState<KitchenProfile | null>(null);
  const [status, setStatus] = useState<KitchenSync>("loading");
  const [error, setError] = useState("");
  const [errorSection, setErrorSection] = useState("summary");
  const cache = useRef<Cache | null>(null);
  const identity = useRef("");
  const revision = useRef(0);
  const busy = useRef(false);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const section = useRef("summary");
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const write = useCallback((next: Cache) => {
    localStorage.setItem(`mise-kitchen-v1:${identity.current}`, JSON.stringify(next));
    cache.current = next;
  }, []);
  const flush = useCallback(async () => {
    const current = cache.current;
    if (!ready.current || !current?.pending || busy.current) return;
    if (!navigator.onLine) { setStatus("pending"); return; }
    busy.current = true;
    const sentRevision = revision.current;
    const sentSection = section.current;
    setStatus("saving");
    try {
      const response = await fetch("/api/kitchen", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Mise-Client": identity.current }, body: JSON.stringify(current.value) });
      if (response.status >= 500 || response.status === 429) throw new Error("Temporary save failure");
      if (!response.ok) {
        // A server rejection is distinct from an uncertain network outcome.
        const latest = cache.current!;
        if (sentRevision === revision.current) {
          const restored = current.confirmed ?? defaultKitchen();
          write({ value: restored, confirmed: current.confirmed, pending: false });
          setValue(restored);
        } else write({ ...latest, confirmed: current.confirmed });
        setError("Изменение не принято сервером. Проверьте значения и повторите.");
        setErrorSection(sentSection); setStatus("error");
      } else {
        const result = await response.json();
        if (!isKitchenProfile(result.kitchen)) throw new Error("Invalid kitchen response");
        const latest = cache.current!;
        const changed = sentRevision !== revision.current;
        write({ value: changed ? latest.value : result.kitchen, confirmed: result.kitchen, pending: changed });
        if (!changed) { setValue(result.kitchen); setStatus("synced"); setError(""); }
      }
    } catch {
      // The server may have committed already. Retry the same full snapshot.
      setStatus("pending");
    } finally {
      busy.current = false;
      if (sentRevision !== revision.current && cache.current?.pending) void flushRef.current();
    }
  }, [write]);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    identity.current = getClientId();
    const fallback = defaultKitchen(initialEquipment);
    let saved: Cache | null = null;
    try {
      const raw = JSON.parse(localStorage.getItem(`mise-kitchen-v1:${identity.current}`) ?? "null");
      if (raw && isKitchenProfile(raw.value) && (raw.confirmed === null || isKitchenProfile(raw.confirmed))) saved = raw;
    } catch { /* keep remote loading available */ }
    cache.current = saved ?? { value: fallback, confirmed: null, pending: false };
    setValue(cache.current.value);
    const startedAt = revision.current;
    async function load() {
      try {
        const response = await fetch("/api/kitchen", { headers: { "X-Mise-Client": identity.current } });
        if (!response.ok) throw new Error("load");
        const body = await response.json();
        if (body.kitchen !== null && !isKitchenProfile(body.kitchen)) throw new Error("invalid");
        if (disposed) return;
        if (!cache.current?.pending && startedAt === revision.current) {
          const remote = body.kitchen ?? fallback;
          write({ value: remote, confirmed: remote, pending: false }); setValue(remote); setStatus("synced");
        }
        ready.current = true; setEditable(true);
        if (cache.current?.pending) void flushRef.current();
      } catch {
        if (disposed) return;
        ready.current = Boolean(saved); setEditable(Boolean(saved));
        setStatus(saved ? "pending" : "error");
        if (!saved) setError("Кухня не загрузилась. Повторите загрузку, чтобы не заменить сохранённые настройки.");
      }
    }
    void load();
    const online = () => { if (ready.current && cache.current?.pending) void flushRef.current(); else void load(); };
    const offline = () => setStatus("pending");
    const onVisibility = () => { if (document.visibilityState === "visible") online(); };
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { disposed = true; window.removeEventListener("online", online); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", onVisibility); if (timer.current) clearTimeout(timer.current); };
    // Initialize once after the active plan has loaded; later plan changes must
    // not overwrite independently saved profile settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, getClientId, write]);
  const update = useCallback((next: KitchenProfile, block: string) => {
    if (!ready.current || !isKitchenProfile(next)) return;
    try {
      write({ value: next, confirmed: cache.current?.confirmed ?? null, pending: true });
    } catch { setError("Не удалось сохранить на устройстве. Освободите место и повторите."); setErrorSection(block); setStatus("error"); return; }
    section.current = block; revision.current += 1;
    setValue(next); setError(""); setStatus(navigator.onLine ? "saving" : "pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 600);
  }, [write]);
  const retry = useCallback(() => { window.dispatchEvent(new Event("online")); }, []);
  return { value, status, error, errorSection, update, retry, editable };
}
