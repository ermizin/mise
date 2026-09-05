import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildSimpleRecipeCatalog } from "../scripts/build-simple-recipe-catalog.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [source, media, runtimeCatalog] = await Promise.all([
  readJson("../data/simple-recipes.json"),
  readJson("../data/simple-recipe-images.json"),
  readJson("../data/recipe-runtime-catalog.json"),
]);
const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
const recipeCuisine = await loadTypeScriptModule(new URL("../domain/recipe-cuisine.ts", import.meta.url));
const mealExecution = await loadTypeScriptModule(new URL("../domain/meal-execution.ts", import.meta.url));
const { validatePlanForPersistence } = await loadTypeScriptModule(
  new URL("../lib/plan-validation.ts", import.meta.url),
);

async function appRuntime() {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("const mealMeta");
  const catalogEnd = page.indexOf("export default function Home");
  const procedureStart = page.indexOf("function procedureIngredientAmountLabel(");
  const procedureEnd = page.indexOf("function ingredientSortableAmount(", procedureStart);
  assert.ok(start >= 0 && catalogEnd > start, "client catalog section is present");
  assert.ok(
    procedureStart >= 0 && procedureEnd > procedureStart,
    "procedure amount formatter is present",
  );
  const output = ts.transpileModule(
    `${page.slice(start, catalogEnd)}
${page.slice(procedureStart, procedureEnd)}
globalThis.__simpleRuntime = { recipes, candidateRecipes, recipeCookingSession, procedureIngredientAmountLabel };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const legacyImages = await readJson("../data/legacy-recipe-image-download-sources.json");
  const sandbox = {
    recipeCuisine: recipeCuisine.recipeCuisine,
    cuisineOrder: recipeCuisine.cuisineOrder,
    cuisineLabels: recipeCuisine.cuisineLabels,
    matchesCuisine: recipeCuisine.matchesCuisine,
    filterByCuisine: recipeCuisine.filterByCuisine,
    availableCuisines: recipeCuisine.availableCuisines,
    carryCuisineFilter: recipeCuisine.carryCuisineFilter,
    runtimeRecipeCatalogJson: runtimeCatalog,
    legacyRecipeImageDownloadSourcesJson: legacyImages,
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    calculateMealPlanTargets: nutrition.calculateMealPlanTargets,
    calculateNutritionTarget: nutrition.calculateNutritionTarget,
    normalizeNutritionTargetMode: nutrition.normalizeNutritionTargetMode,
    capMacrosAtCalories: nutrition.capMacrosAtCalories,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionRepairLegacyDailyMacros: nutrition.repairLegacyDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    materializeInstructions: engine.materializeInstructions,
    canonicalIngredients: engine.canonicalIngredients,
    nutritionForFamily: engine.nutritionForFamily,
    PILOT_RAW_SOURCE_SLUGS: engine.PILOT_RAW_SOURCE_SLUGS,
    recipeToFamily: engine.recipeToFamily,
    deriveRecipeFamilyFromCatalog: engine.deriveRecipeFamilyFromCatalog,
    solveRecipeFamily: engine.solveRecipeFamily,
    solveRecipeBatch: engine.solveRecipeBatch,
    normalizeRawRecipeCandidate: engine.normalizeRawRecipeCandidate,
    auditRawCandidateAgainstFamily: engine.auditRawCandidateAgainstFamily,
    aggregateCookingAmounts: engine.aggregateCookingAmounts,
    recipeEffortDifficulty: engine.recipeEffortDifficulty,
    recipeEffortLevel: engine.recipeEffortLevel,
    normalizeMealExecution: mealExecution.normalizeMealExecution,
  };
  vm.runInNewContext(output, sandbox, { filename: "app/page.tsx" });
  return sandbox.__simpleRuntime;
}

const ui = await appRuntime();
const simpleRuntime = runtimeCatalog.simpleRecipes ?? [];
const simpleSourceById = new Map(source.recipes.map((recipe) => [recipe.id, recipe]));

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function sourceMacros(recipe) {
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const ingredient of recipe.ingredients) {
    const canonical = engine.canonicalIngredients[ingredient.canonicalIngredientId];
    assert.ok(canonical, `${recipe.id}: canonical ingredient exists`);
    const factor = ingredient.grams / 100;
    for (const key of Object.keys(total)) total[key] += canonical.nutritionPer100g[key] * factor;
  }
  return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, rounded(value)]));
}

function person(slot, id = "simple-person", hardExclusions = []) {
  return {
    id,
    name: id,
    daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 },
    includedSlots: [slot],
    hardExclusions,
    dislikes: [],
  };
}

function planFor(recipe) {
  const slot = recipe.slot;
  return {
    id: "simple-plan", start: "2026-09-05", end: "2026-09-05", periodDays: 1, cookEveryDays: 1,
    menuStyle: "simple", mealSlots: [slot], people: [person(slot)],
    batches: [{ id: "batch-1", index: 0, start: "2026-09-05", end: "2026-09-05", days: 1 }],
    selections: { [`batch-1:${slot}`]: recipe.id },
    selectionAssignments: { [`batch-1:${slot}`]: [{ recipeId: recipe.id, personIds: ["simple-person"] }] },
    shopping: [],
  };
}

test("simple source corpus is immutable-shaped and has exactly 25 generated plus 25 parsed cards", () => {
  assert.equal(source.schemaVersion, 1);
  assert.ok(typeof source.createdAt === "string" && source.createdAt.length > 0, "source records its editorial snapshot date");
  assert.ok(typeof source.scope === "string" && source.scope.length > 0, "source records its frozen scope");
  assert.ok(typeof source.nutritionBasis === "string" && source.nutritionBasis.length > 0, "source records its nutrition basis");
  assert.equal(source.recipes.length, 50);
  assert.equal(new Set(source.recipes.map((recipe) => recipe.id)).size, 50);
  assert.equal(source.recipes.filter((recipe) => recipe.origin === "generated").length, 25);
  assert.equal(source.recipes.filter((recipe) => recipe.origin === "parsed").length, 25);
  assert.ok(source.recipes.every((recipe) => Array.isArray(recipe.ingredients) && recipe.ingredients.length >= 2));
});

test("simple builder is deterministic, recalculates macros from canonical amounts, and exactly matches runtime simpleRecipes", async () => {
  const [first, second] = await Promise.all([buildSimpleRecipeCatalog(), buildSimpleRecipeCatalog()]);
  assert.equal(JSON.stringify(first), JSON.stringify(second), "builder is deterministic");
  assert.equal(first.coverage.total, 50);
  assert.equal(first.coverage.generated, 25);
  assert.equal(first.coverage.parsed, 25);
  assert.deepEqual(simpleRuntime, first.recipes);
  for (const record of first.recipes) {
    const original = simpleSourceById.get(record.id);
    assert.ok(original, `${record.id}: source card exists`);
    assert.deepEqual(record.macros, sourceMacros(original), `${record.id}: canonical macro calculation`);
    assert.equal(record.recipeFamily.miseCalculatedNutrition.kcal, record.macros.kcal);
    assert.equal(engine.solveRecipeFamily(record.recipeFamily, { targetCalories: record.macros.kcal }).viable, true, `${record.id}: the editorial base portion must be cookable`);
  }
});

test("all fifty media files match their manifest SHA-256 and source identity", async () => {
  assert.equal(media.images.length, 50);
  assert.equal(new Set(media.images.map((item) => item.id)).size, 50);
  assert.deepEqual(new Set(media.images.map((item) => item.id)), new Set(source.recipes.map((item) => item.id)));
  for (const image of media.images) {
    const bytes = await readFile(new URL(`../public${image.localPath}`, import.meta.url));
    assert.equal(bytes.length, image.bytes, `${image.id}: byte count`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), image.sha256, `${image.id}: checksum`);
  }
});

test("simple candidates are strict-simple for every slot, including dinner and snack2", () => {
  for (const slot of ["breakfast", "lunch", "dinner", "snack1", "snack2"]) {
    const candidates = ui.candidateRecipes(slot, "simple", [], 1, { limit: "all" });
    assert.ok(candidates.length > 0, `${slot}: simple candidate exists`);
    assert.ok(candidates.every((recipe) => recipe.tags.includes("simple")), `${slot}: no non-simple candidate`);
  }
  assert.ok(ui.candidateRecipes("dinner", "simple", [], 1, { limit: "all" }).some((recipe) => recipe.slot === "lunch" || recipe.slot === "dinner"));
  assert.ok(ui.candidateRecipes("snack2", "simple", [], 1, { limit: "all" }).every((recipe) => recipe.slot === "snack1" || recipe.slot === "snack2"));
});

test("simple hard exclusions remove an allergen-containing recipe and server persistence accepts an allowed simple plan", () => {
  const allergicRecipe = ui.recipes.find((recipe) => recipe.tags.includes("simple") && recipe.allergens.length > 0);
  assert.ok(allergicRecipe, "a simple recipe declares an allergen");
  const allergen = allergicRecipe.allergens[0];
  const offered = ui.candidateRecipes(
    allergicRecipe.slot,
    "simple",
    [person(allergicRecipe.slot, "allergic", [allergen])],
    1,
    { limit: "all" },
  );
  assert.ok(!offered.some((recipe) => recipe.id === allergicRecipe.id), "hard exclusion blocks the card");
  assert.equal(validatePlanForPersistence(planFor(simpleRuntime[0])).valid, true);
});

test("procedure water follows the dry grain batch amount, and a two-person non-dough batch owns every ingredient exactly once", () => {
  const water = { name: "Вода", classification: "pantry", unit: "ml", ratioToSourceIngredientId: "grain", ratio: 2 };
  assert.equal(ui.procedureIngredientAmountLabel(water, 99, { grain: 180 }), "360 мл");

  const recipe = ui.recipes.find((item) => item.id === "simple-generated-d04");
  assert.ok(recipe, "a non-dough simple recipe exists");
  const people = [person(recipe.slot, "one"), person(recipe.slot, "two")];
  const session = ui.recipeCookingSession(people, recipe.slot, recipe, 1);
  assert.equal(session.viable, true, "rice and chicken provide a viable shared main-meal batch");
  assert.ok(Object.keys(session.cookingAmounts).length > 0, "the batch has a real ingredient allocation");
  assert.equal(session.portionCount, 2);
  for (const [ingredientId, total] of Object.entries(session.cookingAmounts)) {
    const owned = session.portions.reduce((sum, portion) => sum + (portion.solvedAmounts[ingredientId] ?? 0), 0);
    assert.ok(Math.abs(owned - total) < 1e-8, `${recipe.id}/${ingredientId}: no duplicate or missing ownership`);
  }
});
