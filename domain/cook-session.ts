export type CookTimer = {
  endsAt: number | null;
  remainingMs: number;
  status: "running" | "paused" | "done";
  title: string;
};

export type CookSessionState = {
  version: 1;
  stepIndex: number;
  completedStepIds: string[];
  phase: "cooking" | "portioning" | "complete";
  timers: Record<string, CookTimer>;
  cookedWeights: Record<string, Record<string, number>>;
  updatedAt: number;
};

export type CookSessionEnvelope = {
  version: 1;
  state: CookSessionState;
  revision: number;
  mutationId: string | null;
  pending: {
    state: CookSessionState;
    revision: number;
    mutationId: string;
  } | null;
  /** The exact request being retried after an uncertain network result. */
  inFlight: {
    state: CookSessionState;
    revision: number;
    mutationId: string;
  } | null;
  conflict?: { state: CookSessionState; revision: number } | null;
};

export type CookSessionMutation = NonNullable<CookSessionEnvelope["pending"]>;

export type CookStepWeight = { id: string; weight?: number } | string;

const phases = new Set(["cooking", "portioning", "complete"]);
const timerStates = new Set(["running", "paused", "done"]);

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function timerRemainingMs(timer: CookTimer, now = Date.now()) {
  if (timer.status === "done") return 0;
  if (timer.status === "running" && timer.endsAt !== null)
    return Math.max(0, Math.ceil(timer.endsAt - now));
  return Math.max(0, Math.ceil(timer.remainingMs));
}

function normalizeTimer(value: unknown, now: number, resolveExpired: boolean): CookTimer | null {
  const raw = record(value);
  const title = typeof raw.title === "string" ? raw.title : "";
  const status = timerStates.has(raw.status as string)
    ? (raw.status as CookTimer["status"])
    : "paused";
  const endsAt = typeof raw.endsAt === "number" && Number.isFinite(raw.endsAt)
    ? raw.endsAt
    : null;
  const remainingMs = Math.max(0, finite(raw.remainingMs));
  if (!title) return null;
  const timer: CookTimer = { title, status, endsAt, remainingMs };
  const remaining = timerRemainingMs(timer, now);
  if (remaining === 0 && status === "running" && resolveExpired)
    return { ...timer, endsAt: null, remainingMs: 0, status: "done" };
  if (status === "done") return { ...timer, endsAt: null, remainingMs: 0 };
  if (status === "running" && endsAt === null)
    return { ...timer, status: "paused", remainingMs: remaining };
  return { ...timer, remainingMs: resolveExpired ? remaining : remainingMs };
}

/** Safely accepts both first-load state and durable state from a prior version. */
export function normalizeCookSessionState(value: unknown, now = Date.now(), resolveExpired = true): CookSessionState {
  const raw = record(value);
  const timers: Record<string, CookTimer> = {};
  for (const [id, timer] of Object.entries(record(raw.timers))) {
    const normalized = normalizeTimer(timer, now, resolveExpired);
    if (id && normalized) timers[id] = normalized;
  }
  const cookedWeights: Record<string, Record<string, number>> = {};
  for (const [dishId, weights] of Object.entries(record(raw.cookedWeights))) {
    const normalized: Record<string, number> = {};
    for (const [partId, weight] of Object.entries(record(weights))) {
      if (partId && finite(weight) >= 0) normalized[partId] = finite(weight);
    }
    if (dishId) cookedWeights[dishId] = normalized;
  }
  const completedStepIds = [...new Set(
    Array.isArray(raw.completedStepIds)
      ? raw.completedStepIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  )];
  return {
    version: 1,
    stepIndex: Math.max(0, Math.floor(finite(raw.stepIndex))),
    completedStepIds,
    phase: phases.has(raw.phase as string)
      ? (raw.phase as CookSessionState["phase"])
      : "cooking",
    timers,
    cookedWeights,
    updatedAt: Math.max(0, finite(raw.updatedAt, now)),
  };
}

export function refreshCookSessionTimers(state: CookSessionState, now = Date.now()) {
  const normalized = normalizeCookSessionState(state, now);
  return { ...normalized, updatedAt: Math.max(normalized.updatedAt, now) };
}

export function pauseCookSessionTimer(state: CookSessionState, timerId: string, now = Date.now()) {
  const timer = state.timers[timerId];
  if (!timer || timer.status !== "running") return refreshCookSessionTimers(state, now);
  const remainingMs = timerRemainingMs(timer, now);
  return normalizeCookSessionState({
    ...state,
    timers: {
      ...state.timers,
      [timerId]: {
        ...timer,
        endsAt: null,
        remainingMs,
        status: remainingMs === 0 ? "done" : "paused",
      },
    },
    updatedAt: now,
  }, now);
}

export function startCookSessionTimer(state: CookSessionState, timerId: string, now = Date.now()) {
  const timer = state.timers[timerId];
  if (!timer || timer.status === "done") return refreshCookSessionTimers(state, now);
  const remainingMs = timerRemainingMs(timer, now);
  return normalizeCookSessionState({
    ...state,
    timers: {
      ...state.timers,
      [timerId]: {
        ...timer,
        endsAt: now + remainingMs,
        remainingMs,
        status: "running",
      },
    },
    updatedAt: now,
  }, now);
}

/** Progress uses UI step weights, so long active steps contribute proportionally. */
export function weightedCookSessionCompletion(state: CookSessionState, steps: readonly CookStepWeight[]) {
  const total = steps.reduce((sum, item) => sum + Math.max(0, typeof item === "string" ? 1 : finite(item.weight, 1)), 0);
  if (!total) return 0;
  const completed = new Set(state.completedStepIds);
  return steps.reduce((sum, item) => {
    const id = typeof item === "string" ? item : item.id;
    const weight = Math.max(0, typeof item === "string" ? 1 : finite(item.weight, 1));
    return sum + (completed.has(id) ? weight : 0);
  }, 0) / total;
}

export function normalizeCookSessionEnvelope(value: unknown, fallback: CookSessionState, now = Date.now()): CookSessionEnvelope {
  const raw = record(value);
  const revision = typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0
    ? raw.revision
    : 0;
  const mutationId = typeof raw.mutationId === "string" && raw.mutationId ? raw.mutationId : null;
  const pendingRaw = record(raw.pending);
  const pendingId = typeof pendingRaw.mutationId === "string" && pendingRaw.mutationId ? pendingRaw.mutationId : null;
  const pending = pendingId
    ? {
        state: normalizeCookSessionState(pendingRaw.state, now, false),
        revision: typeof pendingRaw.revision === "number" && Number.isInteger(pendingRaw.revision) && pendingRaw.revision >= 0 ? pendingRaw.revision : revision,
        mutationId: pendingId,
      }
    : null;
  const inFlightRaw = record(raw.inFlight);
  const inFlightId = typeof inFlightRaw.mutationId === "string" && inFlightRaw.mutationId ? inFlightRaw.mutationId : null;
  const inFlight = inFlightId
    ? {
        state: normalizeCookSessionState(inFlightRaw.state, now, false),
        revision: typeof inFlightRaw.revision === "number" && Number.isInteger(inFlightRaw.revision) && inFlightRaw.revision >= 0 ? inFlightRaw.revision : revision,
        mutationId: inFlightId,
      }
    : null;
  const conflictRaw = record(raw.conflict);
  const conflict = conflictRaw.state
    ? {
        state: normalizeCookSessionState(conflictRaw.state, now, false),
        revision: typeof conflictRaw.revision === "number" && Number.isInteger(conflictRaw.revision) && conflictRaw.revision >= 0 ? conflictRaw.revision : revision,
      }
    : null;
  return {
    version: 1,
    state: normalizeCookSessionState(raw.state ?? fallback, now, false),
    revision,
    mutationId,
    pending,
    inFlight,
    conflict,
  };
}

/** Adds a local edit without replacing an uncertain request already on the wire. */
export function queueCookSessionUpdate(envelope: CookSessionEnvelope, state: CookSessionState, mutationId: string): CookSessionEnvelope {
  if (envelope.conflict) return envelope;
  return {
    ...envelope,
    state,
    pending: { state, revision: envelope.revision, mutationId },
  };
}

/** Moves the latest local snapshot into the durable retry slot before sending it. */
export function beginCookSessionRequest(envelope: CookSessionEnvelope): CookSessionEnvelope {
  if (envelope.inFlight || !envelope.pending || envelope.conflict) return envelope;
  return { ...envelope, inFlight: envelope.pending, pending: null };
}

/** ACK can only clear its own durable request; newer edits remain queued. */
export function acknowledgeCookSessionMutation(
  envelope: CookSessionEnvelope,
  mutationId: string,
  state: CookSessionState,
  revision: number,
): CookSessionEnvelope {
  if (envelope.inFlight?.mutationId !== mutationId) return envelope;
  const pending = envelope.pending
    ? { ...envelope.pending, revision }
    : null;
  return {
    ...envelope,
    state: pending ? envelope.state : state,
    revision,
    mutationId,
    inFlight: null,
    pending,
  };
}

/** A load may only rebase local work when it proves the request was acknowledged. */
export function reconcileCookSessionLoad(
  envelope: CookSessionEnvelope,
  state: CookSessionState,
  revision: number,
  mutationId: string | null,
): CookSessionEnvelope {
  // A GET started before an acknowledged write may arrive after its PUT.
  if (revision < envelope.revision) return envelope;
  if (!envelope.inFlight && !envelope.pending) return { ...envelope, state, revision, mutationId, conflict: null };
  if (envelope.inFlight && mutationId === envelope.inFlight.mutationId)
    return acknowledgeCookSessionMutation(envelope, mutationId, state, revision);
  if (revision === envelope.revision) return envelope;
  return { ...envelope, conflict: { state, revision } };
}
