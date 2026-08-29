import type { MealSlot } from "./nutrition";

export type ExecutionPerson = {
  id: string;
  includedSlots: MealSlot[];
};

export type ExecutionBatch = {
  id: string;
  start: string;
  end: string;
};

export type RecipeStoragePolicy = {
  storageDays: number;
  freezable: boolean;
};

/** The small, stable projection of a plan needed to validate execution data. */
export type ExecutionPlan = {
  start: string;
  end: string;
  people: ExecutionPerson[];
  batches: ExecutionBatch[];
  selections: Record<string, string>;
  selectionAssignments?: Record<
    string,
    { recipeId: string; personIds: string[] }[]
  >;
  /** Optional during rollout: plans without recipe metadata retain prior behavior. */
  recipeStorage?: Record<string, RecipeStoragePolicy>;
};

export type MealMove = {
  id: string;
  personId: string;
  fromDate: string;
  toDate: string;
  slot: MealSlot;
  recipeId: string;
  sourceBatchId: string;
  createdAt: string;
  wasEaten?: boolean;
};

export type MealExecution = {
  eaten: string[];
  moves: MealMove[];
};

export type BaseMealOccurrence = {
  personId: string;
  date: string;
  slot: MealSlot;
};

export type MoveBaseOccurrence = BaseMealOccurrence & {
  kind: "base";
  id: string;
  toDate: string;
  createdAt: string;
};

export type MoveExistingOccurrence = {
  kind: "moved";
  id: string;
  toDate: string;
};

export type MoveOccurrenceRequest = MoveBaseOccurrence | MoveExistingOccurrence;

const slots: readonly MealSlot[] = [
  "breakfast",
  "snack1",
  "lunch",
  "snack2",
  "dinner",
];

function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === "string" && slots.includes(value as MealSlot);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function dateInRange(date: string, start: string, end: string) {
  return isIsoDate(date) && isIsoDate(start) && isIsoDate(end) && date >= start && date <= end;
}

function daysBetween(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(startYear, startMonth - 1, startDay)) /
      86_400_000,
  );
}

function selectionKey(batchId: string, slot: MealSlot) {
  return `${batchId}:${slot}`;
}

export function mealOccurrenceKey(personId: string, date: string, slot: MealSlot) {
  return `${personId}:${date}:${slot}`;
}

function personCanHaveOccurrence(
  plan: ExecutionPlan,
  occurrence: BaseMealOccurrence,
) {
  const person = plan.people.find((item) => item.id === occurrence.personId);
  return Boolean(
    person &&
      person.includedSlots.includes(occurrence.slot) &&
      dateInRange(occurrence.date, plan.start, plan.end),
  );
}

function sourceFor(
  plan: ExecutionPlan,
  occurrence: BaseMealOccurrence,
): { batch: ExecutionBatch; recipeId: string } | null {
  if (!personCanHaveOccurrence(plan, occurrence)) return null;
  const batch = plan.batches.find(
    (item) =>
      item.start <= occurrence.date &&
      occurrence.date <= item.end &&
      dateInRange(item.start, plan.start, plan.end) &&
      dateInRange(item.end, plan.start, plan.end),
  );
  if (!batch) return null;
  const key = selectionKey(batch.id, occurrence.slot);
  const assignedRecipeId = plan.selectionAssignments?.[key]?.find(
    (assignment) => assignment.personIds.includes(occurrence.personId),
  )?.recipeId;
  const recipeId = assignedRecipeId ?? plan.selections[key];
  return typeof recipeId === "string" && recipeId ? { batch, recipeId } : null;
}

/* A non-freezable dish cannot be moved to its storage limit or beyond. */
function targetIsStorageSafe(
  plan: ExecutionPlan,
  batch: ExecutionBatch,
  recipeId: string,
  toDate: string,
) {
  const policy = plan.recipeStorage?.[recipeId];
  if (!policy || policy.freezable) return true;
  if (!Number.isFinite(policy.storageDays) || policy.storageDays < 0) return false;
  return daysBetween(batch.start, toDate) < policy.storageDays;
}

function isValidMove(plan: ExecutionPlan, value: unknown): value is MealMove {
  if (!value || typeof value !== "object") return false;
  const move = value as Partial<MealMove>;
  if (
    typeof move.id !== "string" ||
    !move.id ||
    typeof move.personId !== "string" ||
    typeof move.fromDate !== "string" ||
    typeof move.toDate !== "string" ||
    !isMealSlot(move.slot) ||
    typeof move.recipeId !== "string" ||
    typeof move.sourceBatchId !== "string" ||
    typeof move.createdAt !== "string" ||
    !move.createdAt
  )
    return false;
  if (
    !dateInRange(move.fromDate, plan.start, plan.end) ||
    !dateInRange(move.toDate, plan.start, plan.end) ||
    move.toDate <= move.fromDate
  )
    return false;
  const source = sourceFor(plan, {
    personId: move.personId,
    date: move.fromDate,
    slot: move.slot,
  });
  return Boolean(
    source &&
      source.batch.id === move.sourceBatchId &&
      source.recipeId === move.recipeId &&
      targetIsStorageSafe(plan, source.batch, move.recipeId, move.toDate),
  );
}

/**
 * Makes legacy and externally persisted execution data safe to render. Invalid,
 * duplicate and superseded base-eaten occurrences are discarded deterministically.
 */
export function normalizeMealExecution(
  plan: ExecutionPlan,
  value: unknown,
): MealExecution {
  const raw = value && typeof value === "object" ? (value as Partial<MealExecution>) : {};
  const moveIds = new Set<string>();
  const moveSources = new Set<string>();
  const moves: MealMove[] = [];
  for (const candidate of Array.isArray(raw.moves) ? raw.moves : []) {
    if (!isValidMove(plan, candidate)) continue;
    const sourceKey = mealOccurrenceKey(candidate.personId, candidate.fromDate, candidate.slot);
    if (moveIds.has(candidate.id) || moveSources.has(sourceKey)) continue;
    moveIds.add(candidate.id);
    moveSources.add(sourceKey);
    moves.push({ ...candidate, ...(candidate.wasEaten ? { wasEaten: true } : {}) });
  }

  const eaten = new Set<string>();
  for (const key of Array.isArray(raw.eaten) ? raw.eaten : []) {
    if (typeof key !== "string" || eaten.has(key) || moveSources.has(key)) continue;
    const [personId, date, slot, ...rest] = key.split(":");
    if (rest.length || !personId || !date || !isMealSlot(slot)) continue;
    if (sourceFor(plan, { personId, date, slot })) eaten.add(key);
  }
  return { eaten: [...eaten], moves };
}

/** Re-validates execution against a changed plan, preserving only still-real meals. */
export function reconcileMealExecution(
  plan: ExecutionPlan,
  execution: MealExecution | undefined,
): MealExecution {
  return normalizeMealExecution(plan, execution);
}

export function toggleBaseEaten(
  plan: ExecutionPlan,
  execution: MealExecution | undefined,
  occurrence: BaseMealOccurrence,
): MealExecution {
  const normalized = normalizeMealExecution(plan, execution);
  const key = mealOccurrenceKey(occurrence.personId, occurrence.date, occurrence.slot);
  if (!sourceFor(plan, occurrence) || normalized.moves.some((move) =>
    mealOccurrenceKey(move.personId, move.fromDate, move.slot) === key,
  ))
    return normalized;
  return normalized.eaten.includes(key)
    ? { ...normalized, eaten: normalized.eaten.filter((item) => item !== key) }
    : { ...normalized, eaten: [...normalized.eaten, key] };
}

export function toggleMovedEaten(
  plan: ExecutionPlan,
  execution: MealExecution | undefined,
  moveId: string,
): MealExecution {
  const normalized = normalizeMealExecution(plan, execution);
  return {
    ...normalized,
    moves: normalized.moves.map((move) =>
      move.id === moveId ? { ...move, wasEaten: !move.wasEaten } : move,
    ),
  };
}

/** Moves a base occurrence, or retargets an existing move without changing its source. */
export function moveOccurrence(
  plan: ExecutionPlan,
  execution: MealExecution | undefined,
  request: MoveOccurrenceRequest,
): MealExecution {
  const normalized = normalizeMealExecution(plan, execution);
  if (!dateInRange(request.toDate, plan.start, plan.end)) return normalized;

  if (request.kind === "moved") {
    return {
      ...normalized,
      moves: normalized.moves.map((move) => {
        const sourceBatch = plan.batches.find(
          (batch) => batch.id === move.sourceBatchId,
        );
        return move.id === request.id &&
          sourceBatch &&
          request.toDate > move.fromDate &&
          targetIsStorageSafe(plan, sourceBatch, move.recipeId, request.toDate)
          ? { ...move, toDate: request.toDate }
          : move;
      }),
    };
  }

  const occurrence: BaseMealOccurrence = request;
  const source = sourceFor(plan, occurrence);
  const sourceKey = mealOccurrenceKey(occurrence.personId, occurrence.date, occurrence.slot);
  if (
    !source ||
    !request.id ||
    !request.createdAt ||
    request.toDate <= occurrence.date ||
    !targetIsStorageSafe(plan, source.batch, source.recipeId, request.toDate) ||
    normalized.moves.some(
      (move) => move.id === request.id ||
        mealOccurrenceKey(move.personId, move.fromDate, move.slot) === sourceKey,
    )
  )
    return normalized;

  const move: MealMove = {
    id: request.id,
    personId: occurrence.personId,
    fromDate: occurrence.date,
    toDate: request.toDate,
    slot: occurrence.slot,
    recipeId: source.recipeId,
    sourceBatchId: source.batch.id,
    createdAt: request.createdAt,
    ...(normalized.eaten.includes(sourceKey) ? { wasEaten: true } : {}),
  };
  return {
    eaten: normalized.eaten.filter((key) => key !== sourceKey),
    moves: [...normalized.moves, move],
  };
}
