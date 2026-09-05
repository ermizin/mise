import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const recipeCuisineModule = await loadTypeScriptModule(new URL("../domain/recipe-cuisine.ts", import.meta.url));
const nutritionModule = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));

const pluralModule = await loadTypeScriptModule(new URL("../lib/plural.ts", import.meta.url));

export async function recipeCatalog() {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const runtimeRecipeCatalogJson = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const legacyRecipeImageDownloadSourcesJson = JSON.parse(
    await readFile(new URL("../data/legacy-recipe-image-download-sources.json", import.meta.url), "utf8"),
  );
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__catalog = { recipes, productionRecipes, recipeFamiliesById, recipeFamilyFor, portionFor, recipeCookingSession, portionComponents, allocationPeopleForDish, automaticAssignmentsFor, candidateRecipes, equipmentMethods, recipeSupportsEquipment, cookingMethodFor, recipeDisplaySteps, buildBatchCookingModel, normalizeKitchenEquipment, allMealSlots, recipesById, ingredientScaleFor };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {
    ...pluralModule,
    ingredientAmountLabel: (_ingredient, quantity) => String(quantity),
    procedureIngredientAmountLabel: (_ingredient, count) => String(count),
    recipeCuisine: recipeCuisineModule.recipeCuisine,
    cuisineOrder: recipeCuisineModule.cuisineOrder,
    cuisineLabels: recipeCuisineModule.cuisineLabels,
    matchesCuisine: recipeCuisineModule.matchesCuisine,
    filterByCuisine: recipeCuisineModule.filterByCuisine,
    availableCuisines: recipeCuisineModule.availableCuisines,
    carryCuisineFilter: recipeCuisineModule.carryCuisineFilter,
    runtimeRecipeCatalogJson,
    legacyRecipeImageDownloadSourcesJson,
    ACTIVITY_FACTORS: nutritionModule.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutritionModule.MEAL_SLOT_SHARES,
    calculateMealPlanTargets: nutritionModule.calculateMealPlanTargets,
    calculateNutritionTarget: nutritionModule.calculateNutritionTarget,
    normalizeNutritionTargetMode: nutritionModule.normalizeNutritionTargetMode,
    capMacrosAtCalories: nutritionModule.capMacrosAtCalories,
    nutritionMacroCalories: nutritionModule.macroCalories,
    nutritionMealProteinFloor: nutritionModule.mealProteinFloor,
    nutritionMacrosForCalories: nutritionModule.macrosForCalories,
    nutritionRecalculateDailyMacros: nutritionModule.recalculateDailyMacros,
    nutritionShareForSlots: nutritionModule.shareForSlots,
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
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}
