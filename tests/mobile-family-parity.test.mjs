import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildMobileBootstrap } from "../domain/mobile.ts";
import { calculateChildNutritionTarget, calculateMealPlanTargets } from "../domain/nutrition.ts";
import { recipeMatchesDislikes } from "../domain/plan-generator.ts";
import { familyFiberProfile, solveChildShare } from "../domain/recipe-engine.ts";
import { loadTypeScriptModule } from "./typescript-module.mjs";

/* The iOS generator keeps its own copies of the PWA's family-mode and fiber
   rules: app/page.tsx is not a shared module. These tests compare them recipe
   by recipe, so a change on one side fails here until the other side follows. */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const modules = await Promise.all(
  ["recipe-engine", "cooking-duration", "nutrition-history", "recipe-cuisine", "nutrition", "portion-allocation", "meal-execution", "cooking-session"].map(
    (name) => loadTypeScriptModule(new URL(`../domain/${name}.ts`, import.meta.url)),
  ),
);
const nutrition = modules[4];
const page = await read("app/page.tsx");

async function webRuntime() {
  const start = page.indexOf("const mealMeta");
  const end = page.indexOf("export default function Home");
  const output = ts.transpileModule(
    `${page.slice(start, end)}\nglobalThis.__runtime = { recipesById, recipeIsSpicy, dislikeOptions, dislikeMatches, recipeFiber, childScaledSolve, recipeFamilyFor };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    ...Object.assign({}, ...modules.map((module) => ({ ...module }))),
    runtimeRecipeCatalogJson: JSON.parse(await read("data/recipe-runtime-catalog.json")),
    portionComponentsJson: JSON.parse(await read("data/recipe-portion-components.json")),
    legacyRecipeImageDownloadSourcesJson: JSON.parse(await read("data/legacy-recipe-image-download-sources.json")),
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    nutritionRepairLegacyDailyMacros: nutrition.repairLegacyDailyMacros,
    togglePersonMealSlotSelection: nutrition.togglePersonMealSlot,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__runtime;
}
const R = await webRuntime();
const bootstrap = buildMobileBootstrap(
  JSON.parse(await read("data/recipe-runtime-catalog.json")),
  JSON.parse(await read("data/recipe-release-audit.json")),
  JSON.parse(await read("data/simple-recipe-images.json")),
);

test("«Острое» marks the same recipes as the PWA", () => {
  for (const recipe of bootstrap.recipes) assert.equal(recipe.spicy, R.recipeIsSpicy(R.recipesById[recipe.id]), recipe.id);
});

test("every «Не люблю» option excludes the same recipes as in the PWA", () => {
  const codes = R.dislikeOptions.map((option) => option.id);
  assert.ok(codes.includes("spicy") && codes.includes("sportProtein"));
  for (const code of codes)
    for (const recipe of bootstrap.recipes)
      assert.equal(recipeMatchesDislikes(recipe, [code]), R.dislikeMatches(R.recipesById[recipe.id], { dislikes: [code] }).length > 0, `${code}: ${recipe.id}`);
});

test("fiber per 1000 kcal and fresh vegetables rank from the PWA's numbers", () => {
  for (const recipe of bootstrap.recipes) assert.deepEqual(familyFiberProfile(recipe.solver), { ...R.recipeFiber(R.recipesById[recipe.id]) }, recipe.id);
});

test("a child's share of the family dish is solved exactly as in the PWA", () => {
  // Девочка 3 лет — самая маленькая норма семейного режима, где доля нужна чаще всего.
  const daily = calculateChildNutritionTarget({ sex: "female", age: 3, activity: "usual" }).target;
  const slots = calculateMealPlanTargets(daily, ["breakfast", "lunch", "dinner"]).slots;
  let shared = 0;
  for (const recipe of bootstrap.recipes.filter((_, index) => index % 3 === 0)) {
    const target = slots[recipe.slot.startsWith("snack") ? "breakfast" : recipe.slot];
    const input = {
      targetCalories: target.kcal, targetProtein: Math.min(target.kcal / 8, target.protein), proteinFloor: 0, proteinGoalMode: "soft",
      targetFat: target.fat, targetCarbs: target.carbs, hardExclusions: [], cookingFatShare: 1 / 6,
    };
    const native = solveChildShare(recipe.solver, input);
    const web = R.childScaledSolve(R.recipeFamilyFor(R.recipesById[recipe.id]), input);
    assert.equal(native === null, web === null, recipe.id);
    if (!native) continue;
    shared += 1;
    assert.deepEqual(native.amounts, { ...web.amounts }, recipe.id);
    assert.deepEqual(native.nutrition, { ...web.nutrition }, recipe.id);
  }
  assert.ok(shared >= 20, `${shared} recipes solved as a child's share`);
});
