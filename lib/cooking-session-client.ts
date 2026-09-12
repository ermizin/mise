import { applyCookingEvent } from "../domain/cooking/replan";
import type { CompiledSession, CookingEvent, CookingExecutionState, CookingSchedule, CookingSessionInput } from "../domain/cooking/types";

export type CookingEnvelope = {
  input: CookingSessionInput;
  compiled: CompiledSession;
  schedule: CookingSchedule;
  execution: CookingExecutionState;
};
export type PendingMutation = { mutationId: string; event: CookingEvent };
export type CookingClientSnapshot = {
  session: CookingEnvelope | null;
  revision: number | null;
  signature: string;
  planSnapshotSignature: string;
  pending: PendingMutation[];
  requiresUserAction?: string;
};
type ClientStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
type Options = {
  fetch: typeof fetch; storage: ClientStorage; clientId: () => string; now: () => number;
  key: string; planId: string; batchId: string; signature: string; planSnapshotSignature: string;
};
type ServerResponse = { session?: CookingEnvelope; revision?: number; signature?: string; current?: { session: CookingEnvelope; revision: number } };

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validEnvelope(value: unknown): value is CookingEnvelope {
  if (!record(value) || !record(value.input) || !record(value.compiled) || !record(value.schedule) || !record(value.execution) ||
    typeof value.input.sessionId !== "string" || typeof value.input.planId !== "string" || !Array.isArray(value.input.recipes) ||
    !value.input.recipes.every(recipe => record(recipe) && typeof recipe.dishKey === "string" && typeof recipe.recipeId === "string" &&
      typeof recipe.methodId === "string" && Array.isArray(recipe.personIds)) ||
    typeof value.compiled.id !== "string" || !Array.isArray(value.compiled.operations) ||
    !value.compiled.operations.every(operation => record(operation) && typeof operation.id === "string" && typeof operation.kind === "string" &&
      finite(operation.durationSeconds) && Array.isArray(operation.dependsOn) && operation.dependsOn.every(id => typeof id === "string") &&
      Array.isArray(operation.allocations) && operation.allocations.every(record) && Array.isArray(operation.resources) &&
      operation.resources.every(resource => record(resource) && typeof resource.resourceId === "string" && typeof resource.kind === "string")) ||
    !Array.isArray(value.schedule.entries) || !value.schedule.entries.every(entry => record(entry) && typeof entry.opId === "string" && finite(entry.startAt) && finite(entry.endAt)) ||
    !record(value.execution.statusByOperation) || !Array.isArray(value.execution.events)) return false;
  const anchors = value.execution.endsAtByOperation;
  return anchors === undefined || (record(anchors) && Object.values(anchors).every(finite));
}

function validCachedSnapshot(value: unknown): value is CookingClientSnapshot {
  if (!record(value) || typeof value.signature !== "string" || typeof value.planSnapshotSignature !== "string" ||
    !(value.revision === null || (Number.isInteger(value.revision) && (value.revision as number) >= 0)) || !Array.isArray(value.pending)) return false;
  if (!value.pending.every(item => record(item) && typeof item.mutationId === "string" && record(item.event) &&
    typeof item.event.id === "string" && typeof item.event.type === "string" && finite(item.event.occurredAt))) return false;
  return value.session === null || validEnvelope(value.session);
}

export function createCookingSessionClient(options: Options) {
  let state: CookingClientSnapshot = {
    session: null, revision: null, signature: options.signature,
    planSnapshotSignature: options.planSnapshotSignature, pending: [],
  };
  let syncing: Promise<void> | null = null;
  const listeners = new Set<(snapshot: CookingClientSnapshot) => void>();
  const headers = { "Content-Type": "application/json", "X-Mise-Client": options.clientId() };
  const snapshot = () => copy(state);
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  const persist = (next: CookingClientSnapshot) => {
    try { options.storage.setItem(options.key, JSON.stringify(next)); }
    catch { throw new Error("Не удалось сохранить прогресс готовки на этом устройстве."); }
  };
  const commit = (next: CookingClientSnapshot) => { persist(next); state = next; emit(); };

  function replay(session: CookingEnvelope, pending: PendingMutation[]) {
    let next = session;
    for (const mutation of pending) {
      const applied = applyCookingEvent(next.compiled, next.execution, mutation.event, options.now());
      if (applied.diagnostics.length) return { session: next, error: applied.diagnostics[0].code };
      next = { ...next, execution: applied.execution, schedule: applied.schedule };
    }
    return { session: next };
  }

  function restore() {
    try {
      const raw = options.storage.getItem(options.key);
      if (!raw) return snapshot();
      const parsed = JSON.parse(raw) as CookingClientSnapshot;
      state = validCachedSnapshot(parsed) && parsed.signature === options.signature && parsed.planSnapshotSignature === options.planSnapshotSignature
        ? parsed
        : validCachedSnapshot(parsed) ? { ...state, requiresUserAction: "source_changed" }
          : { ...state, requiresUserAction: "local_state_invalid" };
    } catch {
      state = { ...state, requiresUserAction: "local_state_invalid" };
    }
    emit();
    return snapshot();
  }

  function enqueue(event: CookingEvent) {
    if (!state.session || state.requiresUserAction) throw new Error("Готовка требует проверки перед новым действием.");
    const immutable = { ...event, id: event.id || crypto.randomUUID(), occurredAt: event.occurredAt || options.now() };
    const applied = applyCookingEvent(state.session.compiled, state.session.execution, immutable, options.now());
    if (applied.diagnostics.length) throw new Error(applied.diagnostics[0].message);
    commit({
      ...state,
      session: { ...state.session, execution: applied.execution, schedule: applied.schedule },
      pending: [...state.pending, { mutationId: immutable.id, event: immutable }],
    });
    void sync();
    return snapshot();
  }

  async function create(session: CookingEnvelope, graph: { operationIds: string[]; recipeIds: string[] }) {
    const provisional = { ...state, session };
    commit(provisional);
    const response = await options.fetch("/api/cooking-session", {
      method: "PUT", headers,
      body: JSON.stringify({
        sessionId: session.compiled.id, planId: options.planId, batchId: options.batchId,
        signature: options.signature, planSnapshotSignature: options.planSnapshotSignature, graph,
        session: { ...session, execution: undefined, schedule: undefined },
      }),
    });
    if (!response.ok) throw new Error(`create:${response.status}`);
    const body = await response.json() as { session: CookingEnvelope; revision: number };
    const replayed = replay(body.session, state.pending);
    commit(replayed.error
      ? { ...state, session: replayed.session, revision: body.revision, requiresUserAction: replayed.error }
      : { ...state, session: replayed.session, revision: body.revision });
    return snapshot();
  }

  async function refresh() {
    const response = await options.fetch(`/api/cooking-session?planId=${encodeURIComponent(options.planId)}&batchId=${encodeURIComponent(options.batchId)}`, { headers });
    if (!response.ok) return snapshot();
    const body = await response.json() as { session: CookingEnvelope | null; revision: number | null; signature?: string; planSnapshotSignature?: string };
    if (!body.session) return snapshot();
    if (body.signature !== options.signature || body.planSnapshotSignature !== options.planSnapshotSignature) {
      commit({ ...state, requiresUserAction: "source_changed" });
      return snapshot();
    }
    const replayed = replay(body.session, state.pending);
    commit(replayed.error
      ? { ...state, session: replayed.session, revision: body.revision, requiresUserAction: replayed.error }
      : { ...state, session: replayed.session, revision: body.revision });
    return snapshot();
  }

  /** User-initiated replacement after a conflict. Unsynced device actions are intentionally discarded. */
  async function resolveFromServer() {
    try {
      const response = await options.fetch(`/api/cooking-session?planId=${encodeURIComponent(options.planId)}&batchId=${encodeURIComponent(options.batchId)}`, { headers });
      if (!response.ok) return snapshot();
      const body = await response.json() as { session: CookingEnvelope | null; revision: number | null; signature?: string; planSnapshotSignature?: string };
      if (!body.session || body.signature !== options.signature || body.planSnapshotSignature !== options.planSnapshotSignature) {
        if (body.session) commit({ ...state, requiresUserAction: "source_changed" });
        return snapshot();
      }
      const replacement: CookingClientSnapshot = {
        session: body.session, revision: body.revision, signature: options.signature,
        planSnapshotSignature: options.planSnapshotSignature, pending: [],
      };
      if (!validCachedSnapshot(replacement)) return snapshot();
      commit(replacement);
      return snapshot();
    } catch { return snapshot(); }
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      if (state.session && state.revision === null) {
        const graph = {
          operationIds: state.session.compiled.operations.map(op => op.id),
          recipeIds: [...new Set(state.session.input.recipes.map(recipe => recipe.recipeId))],
        };
        try { await create(state.session, graph); } catch { return; }
      }
      while (state.pending.length && state.session && !state.requiresUserAction) {
        const pending = state.pending[0];
        try {
          const response = await options.fetch("/api/cooking-session", {
            method: "POST", headers,
            body: JSON.stringify({
              sessionId: state.session.compiled.id, planId: options.planId, batchId: options.batchId,
              expectedRevision: state.revision, mutationId: pending.mutationId, event: pending.event,
            }),
          });
          const body = await response.json().catch(() => null) as ServerResponse | null;
          const accepted = response.ok
            ? body?.session
            : response.status === 409 && body?.current?.session.execution.events.some(event => event.id === pending.mutationId)
              ? body.current.session : null;
          if (!accepted) {
            if (response.status === 409 || response.status === 422) commit({ ...state, requiresUserAction: "session_conflict" });
            break;
          }
          const remaining = state.pending.slice(1);
          const replayed = replay(accepted, remaining);
          commit(replayed.error
            ? { ...state, session: replayed.session, requiresUserAction: replayed.error }
            : { ...state, session: replayed.session, revision: body?.revision ?? body?.current?.revision ?? state.revision, pending: remaining });
          if (replayed.error) break;
        } catch { break; }
      }
    })().finally(() => { syncing = null; });
    return syncing;
  }

  return {
    snapshot,
    subscribe: (listener: (value: CookingClientSnapshot) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    restore, create, refresh, resolveFromServer, enqueue, sync,
  };
}
