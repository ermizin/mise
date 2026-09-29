import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const { recipes, recipeFamilyFor } = await recipeCatalog();

/*
 * Reference search: the plain form of the solver, one candidate at a time and
 * nothing reused between candidates. The production search is written for
 * speed; whatever it does to get there, it has to return these amounts.
 */
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function referenceViews(family) {
  return family.ingredients.map((ingredient) => {
    const canonical = engine.canonicalIngredients[ingredient.canonicalIngredientId];
    const step = canonical.unit.structuralDiscrete
      ? 1
      : ingredient.unit === "piece" ? 0.1 : Math.max(1, canonical.unit.roundTo);
    const grams = ingredient.unit === "piece"
      ? canonical.unit.gramsPerUnit
      : ingredient.unit === "ml" ? canonical.densityGPerMl ?? 1 : 1;
    const gridMin = Math.ceil(ingredient.minAmount / step) * step;
    const gridMax = Math.floor(ingredient.maxAmount / step) * step;
    return {
      id: ingredient.sourceIngredientId,
      perUnit: Object.fromEntries(
        ["kcal", "protein", "fat", "carbs"].map((key) => [key, canonical.nutritionPer100g[key] * (grams / 100)]),
      ),
      center: (ingredient.preferredMin + ingredient.preferredMax) / 2,
      scale: 1 / Math.max(1, ingredient.baseAmount),
      priority: ingredient.scalingPriority,
      step,
      gridMin,
      gridMax,
      baseAmount: ingredient.baseAmount,
      minAmount: ingredient.minAmount,
      scalable: ingredient.scalable && gridMin <= gridMax,
    };
  });
}

function referenceNormalized(view, value) {
  if (!view.scalable) return view.baseAmount;
  return round(
    Math.max(view.gridMin, Math.min(view.gridMax, Math.round(value / view.step) * view.step)),
    view.step < 1 ? 1 : 0,
  );
}

function referenceTotals(views, amounts) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  views.forEach((view, index) => {
    for (const key of Object.keys(totals)) totals[key] += view.perUnit[key] * amounts[index];
  });
  return totals;
}

const referenceTerm = (view, amount) => {
  const relative = (amount - view.center) * view.scale;
  return relative * relative * view.priority;
};

function referenceScore(totals, deviation, targets) {
  const protein = round(totals.protein);
  const proteinTarget = Math.max(targets.minimumProtein, targets.targetProtein ?? 0);
  const shortfall = Math.max(0, proteinTarget - protein);
  const proteinError = targets.targetProtein === undefined ? 0 : Math.abs(targets.targetProtein - protein);
  const carbError = targets.targetCarbs === undefined ? 0 : Math.abs(targets.targetCarbs - round(totals.carbs));
  const fatError = targets.targetFat === undefined ? 0 : Math.abs(targets.targetFat - round(totals.fat));
  const calorieError = Math.abs(round(totals.kcal) - targets.targetCalories);
  return calorieError * 10 + shortfall * 150 + proteinError * 2 + carbError * 8 + fatError * 10 + deviation * 50;
}

function referenceClimb(family, seed, targets) {
  const views = referenceViews(family);
  const amounts = views.map((view) =>
    referenceNormalized(view, seed === "min" ? view.minAmount : seed === "preferred" ? view.center : view.baseAmount),
  );
  const state = () => {
    const totals = referenceTotals(views, amounts);
    const deviation = views.reduce((sum, view, index) => sum + referenceTerm(view, amounts[index]), 0);
    return { totals, deviation, score: referenceScore(totals, deviation, targets) };
  };
  let { totals, deviation, score } = state();
  const moveScore = (indexes, values) => {
    const next = { ...totals };
    let nextDeviation = deviation;
    indexes.forEach((index, slot) => {
      const delta = values[slot] - amounts[index];
      for (const key of Object.keys(next)) next[key] += views[index].perUnit[key] * delta;
      nextDeviation += referenceTerm(views[index], values[slot]) - referenceTerm(views[index], amounts[index]);
    });
    return referenceScore(next, nextDeviation, targets);
  };
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let best = null;
    const consider = (indexes, values) => {
      const nextScore = moveScore(indexes, values);
      if (nextScore + 0.0001 < (best?.score ?? score)) best = { indexes, values, score: nextScore };
    };
    views.forEach((view, index) => {
      if (!view.scalable) return;
      for (const direction of [-1, 1]) {
        const next = referenceNormalized(view, amounts[index] + direction * view.step);
        if (next !== amounts[index]) consider([index], [next]);
      }
    });
    for (let leftIndex = 0; leftIndex < views.length; leftIndex += 1)
      for (let rightIndex = leftIndex + 1; rightIndex < views.length; rightIndex += 1) {
        const left = views[leftIndex];
        const right = views[rightIndex];
        if (!left.scalable || !right.scalable || left.perUnit.kcal <= 0 || right.perUnit.kcal <= 0) continue;
        for (const direction of [-1, 1]) {
          const leftAmount = referenceNormalized(left, amounts[leftIndex] + direction * left.step);
          const leftDelta = leftAmount - amounts[leftIndex];
          if (!leftDelta) continue;
          const desired = -(leftDelta * left.perUnit.kcal) / right.perUnit.kcal;
          const rightAmount = referenceNormalized(
            right,
            amounts[rightIndex] + Math.round(desired / right.step) * right.step,
          );
          if (rightAmount !== amounts[rightIndex]) consider([leftIndex, rightIndex], [leftAmount, rightAmount]);
        }
      }
    if (!best) break;
    best.indexes.forEach((index, slot) => { amounts[index] = best.values[slot]; });
    ({ totals, deviation, score } = state());
  }
  const solved = Object.fromEntries(views.map((view, index) => [view.id, amounts[index]]));
  return { amounts: solved, nutrition: engine.nutritionForFamily(family, solved), score };
}

function referenceSolve(family, input) {
  const share = input.cookingFatShare ?? 1;
  const solvedFamily = share === 1
    ? family
    : {
        ...family,
        ingredients: family.ingredients.map((ingredient) => {
          if (ingredient.role !== "fat_cooking") return ingredient;
          const amount = ingredient.baseAmount * share;
          return { ...ingredient, baseAmount: amount, minAmount: amount, preferredMin: amount, preferredMax: amount, maxAmount: amount };
        }),
      };
  const targets = { minimumProtein: family.minimumProtein, ...input };
  const candidates = ["min", "base", "preferred"]
    .map((seed) => referenceClimb(solvedFamily, seed, targets))
    .sort((left, right) => left.score - right.score);
  const inCorridor = (candidate) =>
    candidate.nutrition.kcal >= input.targetCalories * 0.9 &&
    candidate.nutrition.kcal <= input.targetCalories * 1.05;
  return candidates.find(inCorridor) ?? candidates[0];
}

const families = [...new Map(
  recipes.flatMap((recipe) => {
    const family = recipeFamilyFor(recipe);
    return family ? [[family.id, family]] : [];
  }),
).values()];

function targetsFor(family, position, cookingFatShare) {
  const targetCalories = Math.round(
    family.minViableCalories + (family.maxViableCalories - family.minViableCalories) * position,
  );
  return {
    targetCalories,
    targetProtein: Math.min(targetCalories / 8, (targetCalories * 0.3) / 4),
    targetFat: (targetCalories * 0.3) / 9,
    targetCarbs: (targetCalories * 0.4) / 4,
    cookingFatShare,
  };
}

test("the production search returns exactly the reference search's portions", (t) => {
  assert.ok(families.length >= 200, "the comparison samples the real catalog");
  const sample = families.filter((_, index) => index % 7 === 0);
  const withCookingFat = families.filter((family) =>
    family.ingredients.some((ingredient) => ingredient.role === "fat_cooking"),
  ).slice(0, 4);
  let compared = 0;
  engine.resetRecipeSolverCache();
  for (const family of new Set([...sample, ...withCookingFat]))
    for (const position of [0, 0.35, 0.8])
      for (const cookingFatShare of withCookingFat.includes(family) ? [1, 1 / 6] : [1]) {
        const input = targetsFor(family, position, cookingFatShare);
        const solved = engine.solveRecipeFamily(family, { ...input, proteinGoalMode: "soft", proteinFloor: 0 });
        const reference = referenceSolve(family, input);
        assert.deepEqual(
          { ...solved.amounts },
          reference.amounts,
          `${family.id} at ${input.targetCalories} kcal, fat share ${cookingFatShare}`,
        );
        assert.deepEqual({ ...solved.nutrition }, { ...reference.nutrition }, `${family.id} nutrition`);
        compared += 1;
      }
  t.diagnostic(`compared=${compared}; families=${families.length}`);
});

test("batch length reuses a solve only when the dish has no pan fat to share", () => {
  const plain = families.find((family) =>
    family.ingredients.every((ingredient) => ingredient.role !== "fat_cooking") &&
    family.ingredients.some((ingredient) => ingredient.scalable),
  );
  const oiled = families.find((family) =>
    family.ingredients.some((ingredient) => ingredient.role === "fat_cooking" && ingredient.baseAmount > 0),
  );
  assert.ok(plain && oiled, "the catalog has both kinds of dish");

  engine.resetRecipeSolverCache();
  const plainInput = targetsFor(plain, 0.5, 1);
  assert.deepEqual(
    engine.solveRecipeFamily(plain, { ...plainInput, cookingFatShare: 1 / 3 }),
    engine.solveRecipeFamily(plain, { ...plainInput, cookingFatShare: 1 / 7 }),
    "a dish without pan fat is the same portion in a 3-day and a 7-day batch",
  );

  const oiledInput = targetsFor(oiled, 0.5, 1);
  const fatId = oiled.ingredients.find((ingredient) => ingredient.role === "fat_cooking").sourceIngredientId;
  const whole = engine.solveRecipeFamily(oiled, { ...oiledInput, cookingFatShare: 1 });
  const third = engine.solveRecipeFamily(oiled, { ...oiledInput, cookingFatShare: 1 / 3 });
  const seventh = engine.solveRecipeFamily(oiled, { ...oiledInput, cookingFatShare: 1 / 7 });
  assert.ok(third.amounts[fatId] < whole.amounts[fatId], "a shared pan gives each portion less of its oil");
  assert.ok(seventh.amounts[fatId] < third.amounts[fatId], "and the share keeps following the batch size");
});

test("a full solver cache drops its oldest solve, not the one just made", () => {
  const family = families.find((item) => item.ingredients.some((ingredient) => ingredient.scalable));
  const input = targetsFor(family, 0.5, 1);
  // Targets below the working range are rejected before any search, so they
  // fill the cache with distinct entries at no cost.
  const fill = (from, count) => {
    for (let index = from; index < from + count; index += 1)
      engine.solveRecipeFamily(family, { targetCalories: family.minViableCalories - 1 - index });
  };
  engine.resetRecipeSolverCache();
  fill(0, 3_999);
  const solved = engine.solveRecipeFamily(family, input);
  fill(3_999, 1);

  // A memoized answer is the only one that cannot see a changed reference
  // profile, which makes the cache observable without reaching into it.
  const canonical = engine.canonicalIngredients[family.ingredients[0].canonicalIngredientId];
  const original = canonical.nutritionPer100g;
  canonical.nutritionPer100g = { ...original, kcal: original.kcal + 50 };
  try {
    assert.deepEqual(
      engine.solveRecipeFamily(family, input).nutrition,
      solved.nutrition,
      "the newest solve survived the cache reaching its limit",
    );
    engine.resetRecipeSolverCache();
    assert.notDeepEqual(
      engine.solveRecipeFamily(family, input).nutrition,
      solved.nutrition,
      "an emptied cache recomputes from the current reference data",
    );
  } finally {
    canonical.nutritionPer100g = original;
    engine.resetRecipeSolverCache();
  }
});
