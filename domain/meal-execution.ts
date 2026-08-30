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
};

export type MealExecution = {
  eaten: string[];
};

export type BaseMealOccurrence = {
  personId: string;
  date: string;
  slot: MealSlot;
};

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

/**
 * Makes legacy and externally persisted execution data safe to render. Invalid
 * and duplicate eaten occurrences are discarded deterministically. Legacy meal
 * moves are intentionally ignored because the transfer feature is no longer part
 * of the product.
 */
export function normalizeMealExecution(
  plan: ExecutionPlan,
  value: unknown,
): MealExecution {
  const raw = value && typeof value === "object" ? (value as Partial<MealExecution>) : {};
  const eaten = new Set<string>();
  for (const key of Array.isArray(raw.eaten) ? raw.eaten : []) {
    if (typeof key !== "string" || eaten.has(key)) continue;
    const [personId, date, slot, ...rest] = key.split(":");
    if (rest.length || !personId || !date || !isMealSlot(slot)) continue;
    if (sourceFor(plan, { personId, date, slot })) eaten.add(key);
  }
  return { eaten: [...eaten] };
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
  if (!sourceFor(plan, occurrence)) return normalized;
  return normalized.eaten.includes(key)
    ? { ...normalized, eaten: normalized.eaten.filter((item) => item !== key) }
    : { ...normalized, eaten: [...normalized.eaten, key] };
}
