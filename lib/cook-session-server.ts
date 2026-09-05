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

const MAX_STATE_BYTES = 400_000;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;

export function validOpaqueId(value: unknown, maximum = 100): value is string {
  return typeof value === "string" && value.length <= maximum && maximum <= 512 && SAFE_ID.test(value);
}

export function validMutationId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 100 && /^[a-zA-Z0-9-]+$/.test(value);
}

export function validateCookState(value: unknown, now = Date.now()): value is CookSessionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || !Number.isInteger(state.stepIndex) || (state.stepIndex as number) < 0 || (state.stepIndex as number) > 500) return false;
  if (state.phase !== "cooking" && state.phase !== "portioning" && state.phase !== "complete") return false;
  if (!Number.isFinite(state.updatedAt) || Math.abs((state.updatedAt as number) - now) > 365 * 24 * 60 * 60 * 1000) return false;
  if (!Array.isArray(state.completedStepIds) || state.completedStepIds.length > 500 || !state.completedStepIds.every((id) => validOpaqueId(id, 512))) return false;
  if (!state.timers || typeof state.timers !== "object" || Array.isArray(state.timers) || Object.keys(state.timers as object).length > 80) return false;
  for (const [id, timer] of Object.entries(state.timers as Record<string, unknown>)) {
    if (!validOpaqueId(id, 512) || !timer || typeof timer !== "object" || Array.isArray(timer)) return false;
    const item = timer as Record<string, unknown>;
    if ((item.status !== "running" && item.status !== "paused" && item.status !== "done") || typeof item.title !== "string" || !item.title.trim() || item.title.length > 2_000 || !Number.isFinite(item.remainingMs) || (item.remainingMs as number) < 0 || (item.remainingMs as number) > 24 * 60 * 60 * 1000 || !(item.endsAt === null || (Number.isFinite(item.endsAt) && (item.endsAt as number) <= now + 24 * 60 * 60 * 1000))) return false;
    if (item.status === "running" && item.endsAt === null) return false;
    if (item.status !== "running" && item.endsAt !== null) return false;
  }
  if (!state.cookedWeights || typeof state.cookedWeights !== "object" || Array.isArray(state.cookedWeights) || Object.keys(state.cookedWeights as object).length > 100) return false;
  for (const [recipeId, ingredients] of Object.entries(state.cookedWeights as Record<string, unknown>)) {
    if (!validOpaqueId(recipeId, 512) || !ingredients || typeof ingredients !== "object" || Array.isArray(ingredients) || Object.keys(ingredients as object).length > 100) return false;
    if (!Object.entries(ingredients as Record<string, unknown>).every(([ingredientId, weight]) => validOpaqueId(ingredientId, 512) && Number.isFinite(weight) && (weight as number) >= 0 && (weight as number) <= 100_000)) return false;
  }
  try { return JSON.stringify(value).length <= MAX_STATE_BYTES; } catch { return false; }
}

export async function cookSessionId(clientId: string, planId: string, sessionKey: string) {
  const bytes = new TextEncoder().encode(`${clientId}\n${planId}\n${sessionKey}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timerJobKind(sessionId: string, timerId: string) { return `cooking-timer:${sessionId}:${timerId}`; }

export function timerJobId(sessionId: string, timerId: string, endsAt: number) { return `${sessionId}:${timerId}:${endsAt}`; }

export function parseTimerJobKind(kind: string) {
  const match = /^cooking-timer:([a-f0-9]{64}):([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,511})$/.exec(kind);
  return match ? { sessionId: match[1], timerId: match[2] } : null;
}
