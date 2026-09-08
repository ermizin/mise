export type CookingPhase = "cooking" | "portioning" | "completed";

export type CookingTimer = {
  stepId: string;
  remainingSeconds: number;
  /** Absolute epoch milliseconds, retained to survive a reload. */
  endsAt: number | null;
};

export type CookingDraft = {
  schemaVersion: 1;
  signature: string;
  phase: CookingPhase;
  currentStepId: string | null;
  weights: Record<string, Record<string, number>>;
  timer: CookingTimer;
};

type RestoreResult = { draft: CookingDraft | null; invalidated: boolean };

function stableJson(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") throw new TypeError("Cannot serialize BigInt in a cooking signature");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return "null";
  if (typeof value !== "object") return "null";
  if (ancestors.has(value)) throw new TypeError("Cannot serialize circular cooking signature");

  ancestors.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => stableJson(item, ancestors)).join(",")}]`
    : `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const item = (value as Record<string, unknown>)[key];
        return typeof item === "undefined" || typeof item === "function" || typeof item === "symbol"
          ? []
          : [`${JSON.stringify(key)}:${stableJson(item, ancestors)}`];
      })
      .join(",")}}`;
  ancestors.delete(value);
  return result;
}

/** A deterministic full JSON signature for the plan content that owns a cooking draft. */
export function makeCookingSignature(value: unknown) {
  return stableJson(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validWeights(value: unknown): value is Record<string, Record<string, number>> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((personWeights) =>
    isRecord(personWeights) && Object.values(personWeights).every((weight) =>
      typeof weight === "number" && Number.isFinite(weight) && weight >= 0,
    )
  );
}

function validPhase(value: unknown): value is CookingPhase {
  return value === "cooking" || value === "portioning" || value === "completed";
}

function validCurrentStepId(value: unknown, stepIds: Set<string>): value is string | null {
  return value === null || (typeof value === "string" && stepIds.has(value));
}

function validTimer(value: unknown, stepIds: Set<string>): value is CookingTimer {
  return isRecord(value) &&
    typeof value.stepId === "string" && stepIds.has(value.stepId) &&
    typeof value.remainingSeconds === "number" && Number.isFinite(value.remainingSeconds) && value.remainingSeconds >= 0 &&
    (value.endsAt === null || (typeof value.endsAt === "number" && Number.isFinite(value.endsAt)));
}

function parseRaw(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Restores only a complete v1 draft for the exact current cooking content. A
 * well-formed draft for another signature is explicitly invalidated, while
 * malformed persistence is simply ignored.
 */
export function restoreCookingDraft(
  raw: unknown,
  signature: string,
  stepIds: readonly string[],
): RestoreResult {
  const parsed = parseRaw(raw);
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.signature !== "string") {
    return { draft: null, invalidated: false };
  }
  const savedSignature = parsed.signature;
  if (savedSignature !== signature) return { draft: null, invalidated: true };

  const validStepIds = new Set(stepIds.filter((stepId): stepId is string => typeof stepId === "string"));
  const phase = parsed.phase;
  const currentStepId = parsed.currentStepId;
  const timer = parsed.timer;
  if (!validPhase(phase) || !validCurrentStepId(currentStepId, validStepIds) || !validWeights(parsed.weights) || (!validTimer(timer, validStepIds) || timer.stepId !== currentStepId)) {
    return { draft: null, invalidated: false };
  }

  return {
    draft: {
      schemaVersion: 1,
      signature: savedSignature,
      phase,
      currentStepId,
      weights: parsed.weights,
      timer: {
        stepId: timer.stepId,
        remainingSeconds: timer.remainingSeconds,
        endsAt: timer.endsAt,
      },
    },
    invalidated: false,
  };
}

/** Progress reserves the final N+1 slot for portioning before completion. */
export function cookingProgress(phase: CookingPhase, stepIndex: number, stepCount: number) {
  if (phase === "completed") return 1;
  const count = Math.max(0, Math.trunc(Number.isFinite(stepCount) ? stepCount : 0));
  if (phase === "portioning") return count / (count + 1);
  const index = Math.max(0, Math.min(count, Math.trunc(Number.isFinite(stepIndex) ? stepIndex : 0)));
  return index / (count + 1);
}
