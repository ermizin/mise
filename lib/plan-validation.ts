import planRecipeRegistryJson from "../data/plan-recipe-registry.json";

const mealSlots = new Set(["breakfast", "lunch", "dinner", "snack1", "snack2"]);
const menuStyles = new Set(["protein", "budget"]);

type RegistryRecipe = {
  id: string;
  slot: string;
  allergens: string[];
  storageDays: number;
  freezable: boolean;
  equipmentOptions: { id: string; requiredEquipment: string[] }[];
};

const planRecipeRegistry = planRecipeRegistryJson as unknown as {
  recipes: RegistryRecipe[];
  kitchenEquipmentIds: string[];
};
const productionRecipesById = new Map(
  planRecipeRegistry.recipes.map((recipe) => [recipe.id, recipe]),
);

const minimumDailyCalories = 1_200;
const maximumDailyCalories = 5_000;
const macroCalorieTolerance = 5;

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function recipeReference(value: unknown): RegistryRecipe | null {
  return string(value, 100) ? productionRecipesById.get(value) ?? null : null;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(start: string, end: string) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
}

function recipeSupportsSlot(recipe: RegistryRecipe, slot: string) {
  return recipe.slot === slot ||
    (recipe.slot === "snack1" && slot === "snack2") ||
    (recipe.slot === "snack2" && slot === "snack1");
}

function validForBatch(recipe: RegistryRecipe, slot: string, days: number, equipment?: string[], methods?: Record<string, string>) {
  const methodId = methods?.[recipe.id] ?? (equipment === undefined ? "original" : "");
  const method = recipe.equipmentOptions.find((method) => method.id === methodId);
  const compatible = Boolean(method && (equipment === undefined || method.requiredEquipment.every((item) => equipment.includes(item))));
  return compatible && recipeSupportsSlot(recipe, slot) && (recipe.storageDays >= days || recipe.freezable);
}

function validDailyNutrition(value: unknown) {
  if (!record(value)) return false;
  const { kcal, protein, fat, carbs } = value;
  if (
    !Number.isFinite(kcal) ||
    !Number.isFinite(protein) ||
    !Number.isFinite(fat) ||
    !Number.isFinite(carbs) ||
    (kcal as number) < minimumDailyCalories ||
    (kcal as number) > maximumDailyCalories ||
    (protein as number) < 0 ||
    (fat as number) < 0 ||
    (carbs as number) < 0
  )
    return false;
  const caloriesFromMacros =
    (protein as number) * 4 + (fat as number) * 9 + (carbs as number) * 4;
  return Math.abs(caloriesFromMacros - (kcal as number)) <= macroCalorieTolerance;
}

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; error: string; status: 400 | 422 };

export function validatePlanForPersistence(value: unknown): PlanValidationResult {
  if (!record(value)) return { valid: false, error: "plan must be an object", status: 400 };
  if (!string(value.id, 100) || !date(value.start) || !date(value.end) || !integer(value.periodDays, 1, 14) || !integer(value.cookEveryDays, 1, 14) || daysInclusive(value.start, value.end) !== value.periodDays) {
    return { valid: false, error: "plan has an invalid period", status: 400 };
  }
  if (typeof value.menuStyle !== "string" || !menuStyles.has(value.menuStyle) || !Array.isArray(value.mealSlots) || value.mealSlots.length < 1 || value.mealSlots.length > 5 || !value.mealSlots.every((slot) => typeof slot === "string" && mealSlots.has(slot)) || new Set(value.mealSlots).size !== value.mealSlots.length) {
    return { valid: false, error: "plan has invalid meal settings", status: 400 };
  }
  if (value.kitchenEquipment !== undefined && (!Array.isArray(value.kitchenEquipment) || value.kitchenEquipment.some((item) => typeof item !== "string" || !planRecipeRegistry.kitchenEquipmentIds.includes(item)) || new Set(value.kitchenEquipment).size !== value.kitchenEquipment.length)) {
    return { valid: false, error: "plan has invalid kitchen equipment", status: 400 };
  }
  const kitchenEquipment = value.kitchenEquipment as string[] | undefined;
  if (value.recipeMethods !== undefined && (!record(value.recipeMethods) || Object.entries(value.recipeMethods).some(([id, method]) => typeof method !== "string" || !productionRecipesById.get(id)?.equipmentOptions.some((option) => option.id === method)))) {
    return { valid: false, error: "plan has invalid recipe methods", status: 400 };
  }
  const recipeMethods = value.recipeMethods as Record<string, string> | undefined;
  const planMealSlots = value.mealSlots as string[];
  if (!Array.isArray(value.people) || value.people.length < 1 || value.people.length > 4 || !Array.isArray(value.batches) || value.batches.length < 1 || value.batches.length > 14 || !record(value.selections) || !Array.isArray(value.shopping)) {
    return { valid: false, error: "plan has an invalid structure", status: 400 };
  }

  const people = new Map<string, { id: string; hardExclusions: string[]; includedSlots: string[] }>();
  for (const person of value.people) {
    const hardExclusions = person && record(person) && person.hardExclusions === undefined
      ? []
      : record(person) && Array.isArray(person.hardExclusions) && person.hardExclusions.every((allergen) => string(allergen, 100))
        ? person.hardExclusions as string[]
        : null;
    if (!record(person) || !string(person.id, 100) || people.has(person.id) || !string(person.name, 100) || !validDailyNutrition(person.daily) || !Array.isArray(person.includedSlots) || new Set(person.includedSlots).size !== person.includedSlots.length || !person.includedSlots.every((slot) => typeof slot === "string" && planMealSlots.includes(slot)) || hardExclusions === null) {
      return { valid: false, error: "plan has an invalid person", status: 400 };
    }
    people.set(person.id, { id: person.id, includedSlots: person.includedSlots as string[], hardExclusions });
  }

  const batches: { id: string; index: number; start: string; end: string; days: number }[] = [];
  const batchIds = new Set<string>();
  for (const batch of value.batches) {
    if (!record(batch) || !string(batch.id, 100) || batchIds.has(batch.id) || !integer(batch.index, 0, 13) || !date(batch.start) || !date(batch.end) || !integer(batch.days, 1, 14)) {
      return { valid: false, error: "plan has an invalid cooking batch", status: 400 };
    }
    const normalizedBatch = batch as { id: string; index: number; start: string; end: string; days: number };
    if (normalizedBatch.end !== addDays(normalizedBatch.start, normalizedBatch.days - 1) || normalizedBatch.days > value.cookEveryDays) return { valid: false, error: "plan has an invalid cooking batch", status: 400 };
    batchIds.add(normalizedBatch.id);
    batches.push(normalizedBatch);
  }
  const orderedBatches = [...batches].sort((left, right) => left.index - right.index);
  if (orderedBatches.some((batch, index) => batch.index !== index || batch.start !== (index ? addDays(orderedBatches[index - 1].end, 1) : value.start)) || orderedBatches.at(-1)?.end !== value.end) return { valid: false, error: "plan has an invalid cooking batch", status: 400 };
  const validSelectionKeys = new Set([...batchIds].flatMap((batchId) => planMealSlots.map((slot) => `${batchId}:${slot}`)));
  for (const [key, recipeId] of Object.entries(value.selections)) {
    if (!validSelectionKeys.has(key)) return { valid: false, error: "plan has an invalid recipe slot", status: 400 };
    if (!recipeReference(recipeId)) return { valid: false, error: "plan references an unavailable recipe", status: 422 };
  }
  const hasExplicitAssignments = value.selectionAssignments !== undefined;
  if (hasExplicitAssignments && !record(value.selectionAssignments)) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
  const assignments = (value.selectionAssignments ?? {}) as Record<string, unknown>;
  if (hasExplicitAssignments && (Object.keys(assignments).some((key) => !validSelectionKeys.has(key)) || [...validSelectionKeys].some((key) => !Object.hasOwn(assignments, key)))) return { valid: false, error: "plan has incomplete recipe assignments", status: 422 };
  for (const batch of orderedBatches) for (const slot of planMealSlots) {
    const key = `${batch.id}:${slot}`;
    const selected = recipeReference(value.selections[key]);
    if (!selected || !validForBatch(selected, slot, batch.days, kitchenEquipment, recipeMethods)) return { valid: false, error: "plan references an unavailable recipe", status: 422 };
    const eaters = [...people.values()].filter((person) => person.includedSlots.includes(slot));
    if (!eaters.length) return { valid: false, error: "plan has incomplete recipe assignments", status: 422 };
    let effective: { recipe: RegistryRecipe; personIds: string[] }[];
    if (!hasExplicitAssignments) {
      effective = [{ recipe: selected, personIds: eaters.map((person) => person.id) }];
    } else {
      const raw = assignments[key];
      if (!Array.isArray(raw) || !raw.length) return { valid: false, error: "plan has incomplete recipe assignments", status: 422 };
      const covered = new Set<string>();
      const recipeIds = new Set<string>();
      effective = [];
      for (const assignment of raw) {
        if (!record(assignment) || !Array.isArray(assignment.personIds) || assignment.personIds.length < 1) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
        const recipe = recipeReference(assignment.recipeId);
        if (!recipe || !validForBatch(recipe, slot, batch.days, kitchenEquipment, recipeMethods)) return { valid: false, error: "plan references an unavailable recipe", status: 422 };
        if (recipeIds.has(recipe.id)) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
        recipeIds.add(recipe.id);
        const personIds: string[] = [];
        for (const personId of assignment.personIds) {
          if (!string(personId, 100) || !eaters.some((person) => person.id === personId) || covered.has(personId)) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
          covered.add(personId);
          personIds.push(personId);
        }
        effective.push({ recipe, personIds });
      }
      if (covered.size !== eaters.length) return { valid: false, error: "plan has incomplete recipe assignments", status: 422 };
    }
    for (const assignment of effective) {
      for (const personId of assignment.personIds) {
        const person = people.get(personId)!;
        if (assignment.recipe.allergens.some((allergen) => person.hardExclusions.includes(allergen))) return { valid: false, error: "plan violates a hard exclusion", status: 422 };
      }
    }
  }
  return { valid: true };
}
