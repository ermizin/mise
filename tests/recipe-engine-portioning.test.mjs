import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const nutritionModule = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));

async function recipeCatalog() {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const runtimeRecipeCatalogJson = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(
    `${source.slice(start, end)}\nglobalThis.__catalog = { recipes, productionRecipes, recipeFamiliesById, recipeFamilyFor, recipeFamilyReleased, recipeFamilyViableFor, portionFor, targetFor, candidateRecipes, cookingPortionCount };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    runtimeRecipeCatalogJson,
    ACTIVITY_FACTORS: nutritionModule.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutritionModule.MEAL_SLOT_SHARES,
    calculateMealPlanTargets: nutritionModule.calculateMealPlanTargets,
    capMacrosAtCalories: nutritionModule.capMacrosAtCalories,
    nutritionMacroCalories: nutritionModule.macroCalories,
    nutritionMacrosForCalories: nutritionModule.macrosForCalories,
    nutritionRecalculateDailyMacros: nutritionModule.recalculateDailyMacros,
    nutritionShareForSlots: nutritionModule.shareForSlots,
    materializeInstructions: engine.materializeInstructions,
    canonicalIngredients: engine.canonicalIngredients,
    PILOT_RAW_SOURCE_SLUGS: engine.PILOT_RAW_SOURCE_SLUGS,
    recipeToFamily: engine.recipeToFamily,
    deriveRecipeFamilyFromCatalog: engine.deriveRecipeFamilyFromCatalog,
    solveRecipeFamily: engine.solveRecipeFamily,
    solveRecipeBatch: engine.solveRecipeBatch,
    normalizeRawRecipeCandidate: engine.normalizeRawRecipeCandidate,
    auditRawCandidateAgainstFamily: engine.auditRawCandidateAgainstFamily,
    aggregateCookingAmounts: engine.aggregateCookingAmounts,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}

const pilotFamilies = (catalog) =>
  Object.values(catalog.recipeFamiliesById).filter((family) => family.reviewStatus === "pilot");

test("one cooking session's pan fat is divided among the portions that share it", async () => {
  const catalog = await recipeCatalog();
  const families = pilotFamilies(catalog).filter((family) =>
    family.ingredients.some((ingredient) => ingredient.role === "fat_cooking"),
  );
  assert.ok(families.length, "at least one pilot family cooks in fat");

  for (const family of families) {
    const fat = family.ingredients.find((ingredient) => ingredient.role === "fat_cooking");
    const targets = [500, 600, 650];
    const portions = targets.map((targetCalories) =>
      engine.solveRecipeFamily(family, { targetCalories, cookingFatShare: 1 / targets.length }),
    );
    if (!portions.every((portion) => portion.viable)) continue;

    const pouredFat = portions.reduce((sum, portion) => sum + portion.amounts[fat.sourceIngredientId], 0);
    assert.ok(
      Math.abs(pouredFat - fat.baseAmount) < 0.05,
      `${family.id}: portions claim ${pouredFat} of ${fat.baseAmount} pan fat`,
    );

    // What the plan promises the eaters must equal what the pan actually holds.
    const cooked = engine.aggregateCookingAmounts(family.ingredients, portions.map((portion) => portion.amounts), 1);
    const cookedNutrition = engine.nutritionForFamily(family, cooked);
    const promised = portions.reduce((sum, portion) => sum + portion.nutrition.kcal, 0);
    assert.ok(
      Math.abs(promised - cookedNutrition.kcal) <= 2,
      `${family.id}: portions promise ${promised} kcal, the pan yields ${cookedNutrition.kcal}`,
    );
  }
});

test("a family's working calorie range is one its ingredients can actually reach", async () => {
  const catalog = await recipeCatalog();
  for (const family of Object.values(catalog.recipeFamiliesById)) {
    const reach = engine.nutritionReachForIngredients(family.ingredients);
    assert.ok(
      family.minViableCalories >= reach.minKcal,
      `${family.id}: declares ${family.minViableCalories} kcal below its reachable ${reach.minKcal}`,
    );
    assert.ok(
      family.maxViableCalories >= reach.maxKcal,
      `${family.id}: declares ${family.maxViableCalories} kcal above its reachable ${reach.maxKcal}`,
    );
    // A protein floor the dish cannot physically hit makes every target fail.
    assert.ok(
      family.minimumProtein <= reach.maxProtein,
      `${family.id}: protein floor ${family.minimumProtein} exceeds the reachable ${reach.maxProtein}`,
    );
    const belowRange = engine.solveRecipeFamily(family, { targetCalories: family.minViableCalories - 1 });
    assert.equal(belowRange.reason, "outside_calorie_range", `${family.id} below range`);
  }
});

test("memoized solutions are equal to fresh ones and cannot be mutated through the cache", async () => {
  const catalog = await recipeCatalog();
  const family = pilotFamilies(catalog)[0];
  const input = { targetCalories: 600, targetProtein: 40, targetCarbs: 55, targetFat: 20 };

  engine.resetRecipeSolverCache();
  const fresh = engine.solveRecipeFamily(family, input);
  const cached = engine.solveRecipeFamily(family, input);
  assert.deepEqual(cached, fresh);

  cached.amounts[Object.keys(cached.amounts)[0]] = -1;
  cached.explanation.push("подделка");
  const afterMutation = engine.solveRecipeFamily(family, input);
  assert.deepEqual(afterMutation, fresh);

  engine.resetRecipeSolverCache();
  assert.deepEqual(engine.solveRecipeFamily(family, input), fresh);
});

test("the catalog filter never promises a recipe the portion solver then refuses", async () => {
  const catalog = await recipeCatalog();
  const person = {
    id: "filter-parity",
    name: "Фильтр",
    daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 },
    includedSlots: ["breakfast", "lunch", "dinner"],
    dislikes: [],
    hardExclusions: [],
  };
  let checked = 0;
  for (const recipe of catalog.recipes) {
    if (!catalog.recipeFamilyFor(recipe)) continue;
    if (!catalog.recipeFamilyViableFor(recipe, person, recipe.slot)) continue;
    checked += 1;
    assert.equal(
      catalog.portionFor(person, recipe.slot, recipe).engine,
      "recipe-family-v1",
      `${recipe.id} passed the filter but fell back to the legacy scaler`,
    );
  }
  assert.ok(checked > 0, "the parity check saw at least one family recipe");
});

test("a family awaiting nutrition review stays out of the catalog even with nobody added", async () => {
  const catalog = await recipeCatalog();
  const pending = Object.values(catalog.recipeFamiliesById)
    .filter((family) => family.reviewStatus !== "pilot")
    .map((family) => family.id);
  assert.ok(pending.length, "the fixture still has families under review");

  for (const slot of ["breakfast", "lunch", "dinner"])
    for (const people of [[], [{
      id: "solo",
      name: "Один",
      daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 },
      includedSlots: ["breakfast", "lunch", "dinner"],
      dislikes: [],
      hardExclusions: [],
    }]]) {
      const offered = catalog.candidateRecipes(slot, "protein", people, 1, { limit: "all" });
      for (const recipe of offered) {
        assert.ok(
          catalog.recipeFamilyFor(recipe),
          `${recipe.id} offered without a Recipe Family`,
        );
        assert.ok(!pending.includes(recipe.id), `${recipe.id} offered for ${slot} with ${people.length} people`);
      }
    }
});
