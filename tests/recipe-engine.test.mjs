import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const nutritionModule = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
const nutrition = (kcal, protein = 0, fat = 0, carbs = 0) => ({ kcal, protein, fat, carbs });

async function recipeCatalog() {
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
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__catalog = { recipes, productionRecipes, recipeFamiliesById, recipeFamilyFor, portionFor };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {
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

function legacyRecipe(overrides) {
  return {
    id: "src-bbq-burger-bowl",
    title: "Говяжий боул с картофелем, сыром и BBQ-соусом",
    slot: "dinner",
    time: 45,
    macros: nutrition(663, 49, 30, 49),
    ingredients: [
      { id: "beef-mince", name: "Говяжий фарш 85/15", quantity: 182, unit: "г" },
      { id: "potato", name: "Картофель", quantity: 182, unit: "г" },
      { id: "cabbage", name: "Капуста или кейл", quantity: 30, unit: "г" },
      { id: "tomato", name: "Томат", quantity: 20, unit: "г" },
      { id: "pickles", name: "Маринованные огурцы", quantity: 30, unit: "г" },
      { id: "cheese", name: "Полутвёрдый сыр", quantity: 17, unit: "г" },
      { id: "bbq-sauce", name: "BBQ-соус", quantity: 30, unit: "г" },
      { id: "olive-oil", name: "Оливковое масло", quantity: 9, unit: "г" },
    ],
    steps: ["Подготовьте ингредиенты."],
    storageDays: 3,
    freezable: true,
    provenance: {},
    storage: {},
    effort: {},
    localization: {},
    ...overrides,
  };
}

function ingredient(sourceIngredientId, canonicalIngredientId, amount, unit, role, scalable = true) {
  return {
    sourceIngredientId,
    canonicalIngredientId,
    baseAmount: amount,
    unit,
    role,
    minAmount: amount,
    preferredMin: amount,
    preferredMax: amount,
    maxAmount: amount,
    scalable,
    scalingPriority: 1,
    substitutions: [],
    optional: false,
  };
}

test("recipe difficulty follows all approved boundary cases", () => {
  const cases = [
    { activeMinutes: 15, cookware: 1, level: "low", difficulty: 1 },
    { activeMinutes: 16, cookware: 1, level: "medium", difficulty: 2 },
    { activeMinutes: 30, cookware: 1, level: "medium", difficulty: 2 },
    { activeMinutes: 31, cookware: 1, level: "high", difficulty: 3 },
    { activeMinutes: 45, cookware: 2, level: "medium", difficulty: 2 },
  ];

  for (const item of cases) {
    assert.equal(
      engine.recipeEffortLevel(item.activeMinutes, item.cookware),
      item.level,
    );
    assert.equal(
      engine.recipeEffortDifficulty(item.activeMinutes, item.cookware),
      item.difficulty,
    );
  }
});

test("recipe timeline reads explicit minutes from the instruction text", () => {
  assert.equal(
    engine.recipeInstructionMinutes(undefined, "Томите 20–25 минут до загустения."),
    25,
  );
  assert.equal(
    engine.recipeInstructionMinutes("8 минут", "Запекайте 20 минут."),
    8,
    "structured duration remains authoritative when it is present",
  );

  const steps = engine.recipeStepsFromInstructions([
    {
      id: "prepare",
      text: "Нарежьте овощи 4 минуты.",
      ingredientIds: [],
    },
    {
      id: "cook",
      text: "Томите 10–12 минут.",
      ingredientIds: [],
      dependsOn: ["prepare"],
    },
  ]);

  assert.deepEqual(
    steps.map(({ at, minutes }) => ({ at, minutes })),
    [
      { at: 0, minutes: 4 },
      { at: 4, minutes: 12 },
    ],
  );

  const estimated = engine.recipeStepsFromInstructions(
    [
      {
        id: "prepare",
        text: "Нарежьте овощи.",
        ingredientIds: [],
      },
      {
        id: "cook",
        text: "Доведите блюдо до готовности.",
        ingredientIds: [],
        dependsOn: ["prepare"],
      },
    ],
    { activeMinutes: 8, totalMinutes: 20 },
  );
  assert.ok(estimated.every((step) => step.minutes > 0));
  assert.ok(estimated.every((step) => step.estimated));
  assert.equal(estimated[1].at, estimated[0].minutes);
});

test("BBQ burger bowl with 85/15 mince is viable inside its working range", () => {
  const family = engine.recipeToFamily(legacyRecipe());
  assert.ok(family);

  const solved = engine.solveRecipeFamily(family, { targetCalories: 500 });
  assert.equal(solved.viable, true, solved.explanation.join(" "));
  assert.ok(solved.nutrition.kcal <= 500, `received ${solved.nutrition.kcal} kcal`);
  assert.ok(500 - solved.nutrition.kcal <= 12, `deficit is ${500 - solved.nutrition.kcal} kcal`);
});

test("carbohydrate and fat targets change the selected under-ceiling variant", async () => {
  const { recipeFamiliesById } = await recipeCatalog();
  const family = recipeFamiliesById["src-creamy-chicken-pasta"];
  assert.ok(family);

  const carbLed = engine.solveRecipeFamily(family, {
    targetCalories: 500,
    targetCarbs: 70,
    targetFat: 8,
  });
  const fatLed = engine.solveRecipeFamily(family, {
    targetCalories: 500,
    targetCarbs: 20,
    targetFat: 35,
  });

  assert.equal(carbLed.viable, true, carbLed.explanation.join(" "));
  assert.equal(fatLed.viable, true, fatLed.explanation.join(" "));
  assert.ok(carbLed.nutrition.kcal >= 450 && carbLed.nutrition.kcal <= 525);
  assert.ok(fatLed.nutrition.kcal >= 450 && fatLed.nutrition.kcal <= 525);
  assert.ok(carbLed.nutrition.carbs > fatLed.nutrition.carbs, `${carbLed.nutrition.carbs} vs ${fatLed.nutrition.carbs}`);
  assert.ok(fatLed.nutrition.fat >= carbLed.nutrition.fat, `${fatLed.nutrition.fat} vs ${carbLed.nutrition.fat}`);
});

test("synthetic macro tuning stays inside the asymmetric calorie corridor", () => {
  const family = {
    id: "macro-tuning",
    title: "Macro tuning",
    ingredients: [
      { ...ingredient("chicken", "chicken_raw", 120, "g", "protein", false) },
      { ...ingredient("oats", "oats_raw", 60, "g", "carb"), minAmount: 20, preferredMin: 40, preferredMax: 80, maxAmount: 120 },
      { ...ingredient("olive-oil", "olive_oil_processed", 12, "g", "fat"), minAmount: 2, preferredMin: 6, preferredMax: 18, maxAmount: 30 },
    ],
    minViableCalories: 250,
    maxViableCalories: 700,
    minimumProtein: 20,
  };
  const carbLed = engine.solveRecipeFamily(family, {
    targetCalories: 500,
    targetCarbs: 70,
    targetFat: 8,
  });
  const fatLed = engine.solveRecipeFamily(family, {
    targetCalories: 500,
    targetCarbs: 20,
    targetFat: 35,
  });

  assert.equal(carbLed.viable, true, carbLed.explanation.join(" "));
  assert.equal(fatLed.viable, true, fatLed.explanation.join(" "));
  assert.ok(carbLed.nutrition.kcal >= 450 && carbLed.nutrition.kcal <= 525);
  assert.ok(fatLed.nutrition.kcal >= 450 && fatLed.nutrition.kcal <= 525);
  assert.ok(carbLed.nutrition.carbs > fatLed.nutrition.carbs, `${carbLed.nutrition.carbs} vs ${fatLed.nutrition.carbs}`);
  assert.ok(fatLed.nutrition.fat >= carbLed.nutrition.fat, `${fatLed.nutrition.fat} vs ${carbLed.nutrition.fat}`);
});

test("structural counted ingredients advance by whole units", () => {
  const egg = engine.canonicalIngredients.egg_raw;
  const oats = engine.canonicalIngredients.oats_raw;
  const family = {
    id: "structural-eggs",
    title: "Egg-bound bake",
    ingredients: [
      { ...ingredient("egg", egg.id, 2, "piece", "protein"), minAmount: 1.4, preferredMin: 2, preferredMax: 2, maxAmount: 3 },
      { ...ingredient("oats", oats.id, 50, "g", "carb"), minAmount: 20, preferredMin: 40, preferredMax: 60, maxAmount: 100 },
    ],
    minViableCalories: 200,
    maxViableCalories: 600,
    minimumProtein: 0,
  };

  for (const targetCalories of [250, 300, 350, 400]) {
    const solved = engine.solveRecipeFamily(family, { targetCalories });
    assert.equal(solved.amounts.egg, Math.round(solved.amounts.egg), `target ${targetCalories}`);
  }
});

test("a geometry-locked family rejects an over-capacity combined batch and reports the required runs", () => {
  const beef = engine.canonicalIngredients.beef_mince_raw;
  const family = {
    id: "geometry-locked-bake",
    title: "Geometry-locked bake",
    ingredients: [ingredient("beef", beef.id, 100, "g", "protein", false)],
    minViableCalories: 210,
    maxViableCalories: 220,
    minimumProtein: 0,
    geometryLockedMax: 1,
  };

  const batch = engine.solveRecipeBatch(family, [
    { id: "one", targetCalories: 215 },
    { id: "two", targetCalories: 215 },
  ]);
  assert.equal(batch.viable, false);
  assert.equal(batch.reason, "geometry_capacity_exceeded");
  assert.equal(batch.geometryBatchCount, 2);
  assert.equal(JSON.stringify(batch.totals), "{}");
});

test("production Recipe Family coverage uses only explicitly safe catalog derivations", async (t) => {
  const { productionRecipes, recipeFamilyFor } = await recipeCatalog();
  const covered = productionRecipes.filter((recipe) => recipeFamilyFor(recipe));
  t.diagnostic(`${covered.length}/${productionRecipes.length}: ${covered.map((recipe) => recipe.id).join(", ")}`);
  t.diagnostic(`uncovered: ${productionRecipes.filter((recipe) => !recipeFamilyFor(recipe)).map((recipe) => `${recipe.id} (${recipe.ingredients.map((ingredient) => ingredient.id).join("/")})`).join("; ")}`);
  assert.equal(covered.length, productionRecipes.length);
  assert.ok(covered.length >= 200);
});

test("portionFor forwards carb and fat tuning to Recipe Family solving", async () => {
  const { recipes, portionFor } = await recipeCatalog();
  const recipe = recipes.find((item) => item.id === "src-creamy-chicken-pasta");
  assert.ok(recipe);
  const person = {
    id: "macro-targets",
    name: "Macro targets",
    daily: nutrition(2000, 150, 65, 204),
    includedSlots: ["lunch"],
    hardExclusions: [],
  };
  const carbLed = portionFor(person, "lunch", recipe, {
    protein: 1,
    fat: 0.8,
    carbs: 1.3,
  });
  const fatLed = portionFor(person, "lunch", recipe, {
    protein: 1,
    fat: 1.2,
    carbs: 0.7,
  });

  assert.equal(carbLed.engine, "recipe-family-v1");
  assert.equal(fatLed.engine, "recipe-family-v1");
  assert.ok(carbLed.actual.kcal >= carbLed.target.kcal * 0.9 && carbLed.actual.kcal <= carbLed.target.kcal * 1.05);
  assert.ok(fatLed.actual.kcal >= fatLed.target.kcal * 0.9 && fatLed.actual.kcal <= fatLed.target.kcal * 1.05);
  assert.ok(carbLed.actual.carbs > fatLed.actual.carbs);
  assert.ok(fatLed.actual.fat > carbLed.actual.fat);
});
