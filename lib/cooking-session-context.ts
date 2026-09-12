type RecordValue = Record<string, unknown>;

export type CookingDishContext = {
  dishKey: string;
  recipeId: string;
  methodId: string;
  personIds: string[];
  cookingAmounts: Record<string, unknown>;
};

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (!value || typeof value !== "object") return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as RecordValue).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as RecordValue)[key])}`).join(",")}}`;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value] as string[] : null;
}

function validAmounts(value: unknown): value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length > 80) return false;
  return Object.entries(value).every(([id, amount]) =>
    /^[A-Za-z0-9:_-]{1,120}$/u.test(id) && record(amount) &&
    typeof amount.amount === "number" && Number.isFinite(amount.amount) && amount.amount >= 0 && amount.amount <= 100_000 &&
    typeof amount.unit === "string" && amount.unit.length > 0 && amount.unit.length <= 24 &&
    typeof amount.canonicalId === "string" && amount.canonicalId.length > 0 && amount.canonicalId.length <= 120,
  );
}

/** Binds durable plan facts to the physical amounts used by this saved session. */
export function cookingPlanSnapshotSignature(
  plan: unknown,
  batchId: string,
  dishes: CookingDishContext[],
  legacy = false,
) {
  const source = record(plan) ? plan : {};
  const normalizedAssignments = Array.isArray(source.batches) ? Object.fromEntries(source.batches.flatMap(batch => {
    if (!record(batch) || typeof batch.id !== "string") return [];
    const planned = plannedCookingDishes(source, batch.id);
    if (!planned) return [];
    const grouped = new Map<string, { recipeId: string; personIds: string[] }[]>();
    for (const dish of planned) {
      const key = dish.dishKey.slice(0, -(dish.recipeId.length + 1));
      grouped.set(key, [...(grouped.get(key) ?? []), { recipeId: dish.recipeId, personIds: dish.personIds }]);
    }
    return [...grouped].map(([key, groups]) => [key, groups.sort((a, b) => a.recipeId.localeCompare(b.recipeId))]);
  })) : source.selectionAssignments;
  return stableJson({
    ...(!legacy ? { snapshotSchemaVersion: 2 } : {}),
    planId: source.id,
    batchId,
    batches: source.batches,
    mealSlots: source.mealSlots,
    selections: source.selections,
    selectionAssignments: legacy ? source.selectionAssignments : normalizedAssignments,
    people: Array.isArray(source.people) ? source.people.map((person) => record(person) ? {
      id: person.id, includedSlots: person.includedSlots, daily: person.daily, hardExclusions: person.hardExclusions,
    } : person) : source.people,
    tuning: source.tuning,
    recipeMethods: source.recipeMethods,
    kitchenEquipment: source.kitchenEquipment,
    dishes: dishes.map((dish) => ({
      dishKey: dish.dishKey, recipeId: dish.recipeId, methodId: dish.methodId,
      personIds: [...dish.personIds].sort(), cookingAmounts: dish.cookingAmounts,
    })).sort((left, right) => left.dishKey.localeCompare(right.dishKey)),
  });
}

/** Old sessions retain their original signature; equivalent legacy assignments do not invalidate them. */
export function cookingPlanSnapshotMatches(signature: string, plan: unknown, batchId: string, dishes: CookingDishContext[]) {
  const current = cookingPlanSnapshotSignature(plan, batchId, dishes);
  if (signature === current || signature === cookingPlanSnapshotSignature(plan, batchId, dishes, true)) return true;
  try {
    const saved = JSON.parse(signature);
    if (!record(saved) || saved.snapshotSchemaVersion !== undefined || saved.batchId !== batchId || !Array.isArray(saved.dishes)) return false;
    const savedDishes = saved.dishes.map(cookingDishContext);
    if (savedDishes.some(dish => !dish)) return false;
    return cookingPlanSnapshotSignature({ ...saved, id: saved.planId }, batchId, savedDishes as CookingDishContext[]) === current;
  } catch { return false; }
}

/** Derives the only dish identities which a batch session may address. */
export function plannedCookingDishes(plan: unknown, batchId: string): CookingDishContext[] | null {
  if (!record(plan) || !Array.isArray(plan.mealSlots) || !Array.isArray(plan.people) || !record(plan.selections)) return null;
  const methods = record(plan.recipeMethods) ? plan.recipeMethods : {};
  const assignments = record(plan.selectionAssignments) ? plan.selectionAssignments : null;
  const people = plan.people.filter(record);
  const dishes: CookingDishContext[] = [];
  for (const slot of plan.mealSlots) {
    if (typeof slot !== "string") return null;
    const key = `${batchId}:${slot}`;
    const rawGroups = assignments?.[key];
    const groups = Array.isArray(rawGroups)
      ? rawGroups
      : [{ recipeId: plan.selections[key], personIds: people.filter((person) => stringArray(person.includedSlots)?.includes(slot)).map((person) => person.id) }];
    for (const group of groups) {
      const personIds = record(group) ? stringArray(group.personIds) : null;
      if (!record(group) || typeof group.recipeId !== "string" || !personIds?.length || !personIds.every((id) => people.some((person) => person.id === id))) return null;
      const recipeId = group.recipeId as string;
      const methodId = typeof methods[recipeId] === "string" ? methods[recipeId] : "original";
      dishes.push({ dishKey: `${batchId}:${slot}:${recipeId}`, recipeId, methodId, personIds: [...personIds].sort(), cookingAmounts: {} });
    }
  }
  return new Set(dishes.map((dish) => dish.dishKey)).size === dishes.length ? dishes : null;
}

export function cookingDishContext(value: unknown): CookingDishContext | null {
  if (!record(value) || typeof value.dishKey !== "string" || !/^[A-Za-z0-9:_-]{1,240}$/u.test(value.dishKey) || typeof value.recipeId !== "string" || typeof value.methodId !== "string" || !stringArray(value.personIds) || !validAmounts(value.cookingAmounts)) return null;
  return { dishKey: value.dishKey, recipeId: value.recipeId, methodId: value.methodId, personIds: [...value.personIds as string[]].sort(), cookingAmounts: value.cookingAmounts };
}
