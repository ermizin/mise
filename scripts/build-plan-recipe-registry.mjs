import { kitchenEquipmentIds } from "./recipe-equipment.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

async function loadTypeScriptModule(url) {
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports, require: createRequire(url) };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}

async function productionRecipes() {
  const [nutrition, engine, recipeCuisineModule, mealExecution, runtimeRecipeCatalogJson, legacyRecipeImageDownloadSourcesJson, source] = await Promise.all([
    loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url)),
    loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url)),
    loadTypeScriptModule(new URL("../domain/recipe-cuisine.ts", import.meta.url)),
    loadTypeScriptModule(new URL("../domain/meal-execution.ts", import.meta.url)),
    readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/legacy-recipe-image-download-sources.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  if (start < 0 || end <= start) throw new Error("Could not locate the client recipe catalogue.");
  const output = ts.transpileModule(
    `${source.slice(start, end)}\nglobalThis.__planRecipeRegistry = productionRecipes.map(recipe => ({ ...recipe, equipmentOptions: equipmentMethods(recipe) }));`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    recipeCuisine: recipeCuisineModule.recipeCuisine,
    cuisineOrder: recipeCuisineModule.cuisineOrder,
    cuisineLabels: recipeCuisineModule.cuisineLabels,
    matchesCuisine: recipeCuisineModule.matchesCuisine,
    filterByCuisine: recipeCuisineModule.filterByCuisine,
    availableCuisines: recipeCuisineModule.availableCuisines,
    carryCuisineFilter: recipeCuisineModule.carryCuisineFilter,
    runtimeRecipeCatalogJson,
    legacyRecipeImageDownloadSourcesJson,
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutrition.MEAL_SLOT_SHARES,
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
    PILOT_RAW_SOURCE_SLUGS: engine.PILOT_RAW_SOURCE_SLUGS,
    recipeToFamily: engine.recipeToFamily,
    deriveRecipeFamilyFromCatalog: engine.deriveRecipeFamilyFromCatalog,
    solveRecipeFamily: engine.solveRecipeFamily,
    solveRecipeBatch: engine.solveRecipeBatch,
    normalizeRawRecipeCandidate: engine.normalizeRawRecipeCandidate,
    auditRawCandidateAgainstFamily: engine.auditRawCandidateAgainstFamily,
    aggregateCookingAmounts: engine.aggregateCookingAmounts,
    nutritionForFamily: engine.nutritionForFamily,
    recipeEffortDifficulty: engine.recipeEffortDifficulty,
    recipeEffortLevel: engine.recipeEffortLevel,
    normalizeMealExecution: mealExecution.normalizeMealExecution,
  };
  vm.runInNewContext(output, sandbox, { filename: "app/page.tsx" });
  return sandbox.__planRecipeRegistry;
}

export async function buildPlanRecipeRegistry() {
  const recipes = await productionRecipes();
  const entries = recipes
    .map((recipe) => ({
      id: recipe.id,
      slot: recipe.slot,
      allergens: [...new Set(recipe.allergens)].sort(),
      storageDays: recipe.storageDays,
      freezable: recipe.freezable,
      equipmentOptions: recipe.equipmentOptions.map(({ id, requiredEquipment }) => ({ id, requiredEquipment })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("Client production recipes contain duplicated ids.");
  return { schemaVersion: 2, kitchenEquipmentIds, recipeCount: entries.length, recipes: entries };
}

export async function writePlanRecipeRegistry(outputPath = new URL("../data/plan-recipe-registry.json", import.meta.url)) {
  const registry = await buildPlanRecipeRegistry();
  await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? pathToFileURL(resolve(process.argv[outputIndex + 1])) : undefined;
  const registry = await writePlanRecipeRegistry(output);
  console.log(JSON.stringify({ recipes: registry.recipeCount }));
}
