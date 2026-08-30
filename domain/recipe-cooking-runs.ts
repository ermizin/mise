/**
 * A small, UI-independent run planner for cookware-constrained recipes.
 *
 * RecipeFamily base amounts describe one Mise serving.  `geometryLockedMax`
 * is therefore the largest number of those base servings that may share one
 * physical vessel, not an arbitrary multiplier of the whole weekly plan.
 */
export type CookingRunIngredient = {
  sourceIngredientId: string;
  baseAmount: number;
  role: string;
};

export type CookingRunFamily = {
  geometryLockedMax?: number;
  ingredients: CookingRunIngredient[];
};

export type CookingRunPortion = {
  /** Stable caller-owned identity, for example a person id. */
  id: string;
  /** Solved ingredient amounts for one serving. */
  amounts: Record<string, number>;
};

export type CookingRunPortionRef = CookingRunPortion & {
  day: number;
  order: number;
};

export type CookingRun = {
  index: number;
  portions: CookingRunPortionRef[];
  totals: Record<string, number>;
};

export type CookingRunPlan = {
  viable: boolean;
  reason?: "geometry_capacity_exceeded";
  runs: CookingRun[];
  runCount: number;
  totals: Record<string, number>;
};

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Mise pools equal components from every physical run before the final weigh
 * and allocation. This makes each planned container carry the same share of
 * the total pan/form fat, including uneven 5+1 or similar run splits.
 */
export function pooledCookingFatShare(runCount: number, portionCount: number) {
  const safeRuns = Math.max(1, Math.floor(runCount));
  const safePortions = Math.max(1, Math.floor(portionCount));
  return safeRuns / safePortions;
}

function expandedPortions(portions: CookingRunPortion[], days: number) {
  const safeDays = Math.max(0, Math.floor(days));
  return Array.from({ length: safeDays }, (_, day) =>
    portions.map((portion, index) => ({ ...portion, day, order: index })),
  ).flat();
}

function totalsFor(
  ingredients: CookingRunIngredient[],
  portions: CookingRunPortionRef[],
) {
  const totals: Record<string, number> = {};
  for (const ingredient of ingredients) {
    if (ingredient.role === "fat_cooking") {
      if (portions.length) totals[ingredient.sourceIngredientId] = ingredient.baseAmount;
      continue;
    }
    const amount = portions.reduce(
      (sum, portion) => sum + Math.max(0, portion.amounts[ingredient.sourceIngredientId] ?? 0),
      0,
    );
    if (amount) totals[ingredient.sourceIngredientId] = rounded(amount);
  }
  return totals;
}

function aggregateRuns(runs: CookingRun[]) {
  const totals: Record<string, number> = {};
  for (const run of runs)
    for (const [ingredientId, amount] of Object.entries(run.totals))
      totals[ingredientId] = rounded((totals[ingredientId] ?? 0) + amount);
  return totals;
}

function exceedsCapacity(
  ingredients: CookingRunIngredient[],
  portions: CookingRunPortionRef[],
  capacity: number,
) {
  return ingredients.some((ingredient) => {
    if (ingredient.role === "fat_cooking" || ingredient.baseAmount <= 0) return false;
    const load = portions.reduce(
      (sum, portion) => sum + Math.max(0, portion.amounts[ingredient.sourceIngredientId] ?? 0),
      0,
    ) / ingredient.baseAmount;
    return load > capacity + 0.000001;
  });
}

/**
 * Expands each solved portion over the requested days and packs them in
 * deterministic day-major/person order. `fat_cooking` is a physical-vessel
 * amount, so it is added once to every resulting run rather than once per
 * serving.
 */
export function planRecipeCookingRuns(
  family: CookingRunFamily,
  portionAmounts: CookingRunPortion[],
  days: number,
): CookingRunPlan {
  const portions = expandedPortions(portionAmounts, days);
  const capacity = family.geometryLockedMax;
  const hasCapacity = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0;

  if (!hasCapacity) {
    const runs = [{ index: 0, portions, totals: totalsFor(family.ingredients, portions) }];
    return { viable: true, runs, runCount: 1, totals: aggregateRuns(runs) };
  }

  if (portions.some((portion) => exceedsCapacity(family.ingredients, [portion], capacity)))
    return {
      viable: false,
      reason: "geometry_capacity_exceeded",
      runs: [],
      runCount: 0,
      totals: {},
    };

  const runs: CookingRun[] = [];
  for (const portion of portions) {
    const current = runs.at(-1);
    if (current && !exceedsCapacity(family.ingredients, [...current.portions, portion], capacity)) {
      current.portions.push(portion);
      current.totals = totalsFor(family.ingredients, current.portions);
      continue;
    }
    runs.push({ index: runs.length, portions: [portion], totals: totalsFor(family.ingredients, [portion]) });
  }
  if (!runs.length) runs.push({ index: 0, portions: [], totals: {} });
  return { viable: true, runs, runCount: runs.length, totals: aggregateRuns(runs) };
}
