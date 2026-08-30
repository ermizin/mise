import runtimeRecipeCatalogJson from "../data/recipe-runtime-catalog.json";

const mealSlots = new Set(["breakfast", "lunch", "dinner", "snack1", "snack2"]);
const menuStyles = new Set(["protein", "budget"]);

type RuntimeCatalog = {
  recipes: {
    id: string;
    recipeFamily: { reviewStatus: string; ingredients: unknown[] };
  }[];
};

// These hand-authored source cards pass the same production predicate used by
// the client. Imported cards are read from the generated hard-gated catalogue
// below, so adding a reviewed runtime recipe cannot silently break plan saves.
const handAuthoredProductionRecipeIds = [
  "src-taco-mac",
  "src-halal-chicken",
  "src-crispy-beef-noodles",
  "src-mediterranean-wrap",
  "src-creamy-chicken-pasta",
  "src-lemon-chicken",
  "src-curry-fried-rice",
  "src-fajita-rice",
  "src-japanese-beef-curry",
  "src-gochujang-beef",
  "src-sausage-pepper-pasta",
  "src-honey-lime-steak",
  "src-light-stroganoff",
  "src-bbq-burger-bowl",
  "src-red-pepper-chicken-dip",
  "src-beefy-cheese-potatoes",
];
const runtimeRecipeCatalog = runtimeRecipeCatalogJson as unknown as RuntimeCatalog;
const productionRecipeIds = new Set([
  ...handAuthoredProductionRecipeIds,
  ...runtimeRecipeCatalog.recipes
    .filter(
      (recipe) =>
        recipe.recipeFamily.reviewStatus === "pilot" &&
        recipe.recipeFamily.ingredients.length >= 3,
    )
    .map((recipe) => recipe.id),
]);

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
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function recipeReference(value: unknown): value is string {
  return string(value, 100) && productionRecipeIds.has(value);
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
  if (!string(value.id, 100) || !date(value.start) || !date(value.end) || !integer(value.periodDays, 1, 14) || !integer(value.cookEveryDays, 1, 14)) {
    return { valid: false, error: "plan has an invalid period", status: 400 };
  }
  if (typeof value.menuStyle !== "string" || !menuStyles.has(value.menuStyle) || !Array.isArray(value.mealSlots) || value.mealSlots.length < 1 || value.mealSlots.length > 5 || !value.mealSlots.every((slot) => typeof slot === "string" && mealSlots.has(slot)) || new Set(value.mealSlots).size !== value.mealSlots.length) {
    return { valid: false, error: "plan has invalid meal settings", status: 400 };
  }
  const planMealSlots = value.mealSlots as string[];
  if (!Array.isArray(value.people) || value.people.length < 1 || value.people.length > 4 || !Array.isArray(value.batches) || value.batches.length < 1 || value.batches.length > 14 || !record(value.selections) || !Array.isArray(value.shopping)) {
    return { valid: false, error: "plan has an invalid structure", status: 400 };
  }

  const people = new Set<string>();
  for (const person of value.people) {
    if (!record(person) || !string(person.id, 100) || people.has(person.id) || !string(person.name, 100) || !validDailyNutrition(person.daily) || !Array.isArray(person.includedSlots) || new Set(person.includedSlots).size !== person.includedSlots.length || !person.includedSlots.every((slot) => typeof slot === "string" && planMealSlots.includes(slot))) {
      return { valid: false, error: "plan has an invalid person", status: 400 };
    }
    people.add(person.id);
  }

  const batchIds = new Set<string>();
  for (const batch of value.batches) {
    if (!record(batch) || !string(batch.id, 100) || batchIds.has(batch.id) || !integer(batch.index, 0, 13) || !date(batch.start) || !date(batch.end) || !integer(batch.days, 1, 14)) {
      return { valid: false, error: "plan has an invalid cooking batch", status: 400 };
    }
    batchIds.add(batch.id);
  }
  const validSelectionKeys = new Set([...batchIds].flatMap((batchId) => planMealSlots.map((slot) => `${batchId}:${slot}`)));
  for (const [key, recipeId] of Object.entries(value.selections)) {
    if (!validSelectionKeys.has(key)) return { valid: false, error: "plan has an invalid recipe slot", status: 400 };
    if (!recipeReference(recipeId)) return { valid: false, error: "plan references an unavailable recipe", status: 422 };
  }

  if (value.selectionAssignments !== undefined) {
    if (!record(value.selectionAssignments)) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
    for (const [key, assignments] of Object.entries(value.selectionAssignments)) {
      if (!validSelectionKeys.has(key) || !Array.isArray(assignments)) return { valid: false, error: "plan has invalid recipe assignments", status: 400 };
      for (const assignment of assignments) {
        if (!record(assignment) || !recipeReference(assignment.recipeId) || !Array.isArray(assignment.personIds) || assignment.personIds.length < 1 || assignment.personIds.some((personId) => !string(personId, 100) || !people.has(personId))) {
          return { valid: false, error: "plan references an unavailable recipe", status: 422 };
        }
      }
    }
  }
  return { valid: true };
}
