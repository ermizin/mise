import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));

const family = () => ({
  id: "cache-role-boundary",
  minViableCalories: 1,
  maxViableCalories: 1_000,
  minimumProtein: 0,
  ingredients: [{
    sourceIngredientId: "oil",
    canonicalIngredientId: "olive_oil_processed",
    baseAmount: 10,
    unit: "g",
    role: "fat_cooking",
    minAmount: 10,
    preferredMin: 10,
    preferredMax: 10,
    maxAmount: 10,
    scalable: false,
    scalingPriority: 9,
    substitutions: [],
    optional: false,
  }],
});

test("solver cache fingerprint includes role and unit-sensitive bounds", () => {
  const recipe = family();
  engine.resetRecipeSolverCache();
  const shared = engine.solveRecipeFamily(recipe, { targetCalories: 45, cookingFatShare: 0.5 });
  assert.equal(shared.amounts.oil, 5);

  recipe.ingredients[0].role = "fat";
  recipe.ingredients[0].minAmount = 10;
  recipe.ingredients[0].preferredMin = 10;
  recipe.ingredients[0].preferredMax = 10;
  recipe.ingredients[0].maxAmount = 10;
  const edible = engine.solveRecipeFamily(recipe, { targetCalories: 90, cookingFatShare: 0.5 });
  assert.equal(edible.amounts.oil, 10, "role mutation cannot reuse an old shared-fat cache entry");
});

test("soft protein goals keep a calorie-valid low-protein recipe available without weakening exclusions", () => {
  const lowProtein = {
    id: "soft-protein",
    minViableCalories: 1,
    maxViableCalories: 1_000,
    minimumProtein: 0,
    ingredients: [{
      sourceIngredientId: "rice",
      canonicalIngredientId: "rice_raw",
      baseAmount: 25,
      unit: "g",
      role: "carb",
      minAmount: 25,
      preferredMin: 25,
      preferredMax: 25,
      maxAmount: 25,
      scalable: false,
      scalingPriority: 1,
      substitutions: [],
      optional: false,
    }],
  };
  const strict = engine.solveRecipeFamily(lowProtein, { targetCalories: 92, targetProtein: 40 });
  const soft = engine.solveRecipeFamily(lowProtein, { targetCalories: 92, targetProtein: 40, proteinGoalMode: "soft" });
  assert.equal(strict.viable, false);
  assert.equal(soft.viable, true, "soft mode keeps the calorie-fit variant");

  const excluded = {
    ...lowProtein,
    id: "soft-protein-excluded",
    ingredients: [{ ...lowProtein.ingredients[0], canonicalIngredientId: "salmon_raw" }],
  };
  assert.equal(
    engine.solveRecipeFamily(excluded, { targetCalories: 52, proteinGoalMode: "soft", hardExclusions: ["fish"] }).reason,
    "hard_exclusion",
  );
});
