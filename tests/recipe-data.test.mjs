import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

async function loadRecipeCatalog() {
  const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
  const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
  const cookingRuns = await loadTypeScriptModule(new URL("../domain/recipe-cooking-runs.ts", import.meta.url));
  const runtimeRecipeCatalogJson = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__catalog = { recipes, productionRecipes, isProductionReadyRecipe, recipeFamiliesById, recipeFamilyFor, canonicalIngredients, PILOT_RAW_SOURCE_SLUGS, portionFor, ingredientScaleFor, recipeCookingSession, solveRecipeFamily, solveRecipeBatch, materializeInstructions, aggregateCookingAmounts, normalizeRawRecipeCandidate, auditRawCandidateAgainstFamily, shareFor: (person, slot) => nutritionShareForSlots(person.includedSlots, slot), plannedTargetsFor, macroDifference, candidateRecipes, automaticAssignmentsFor, hardConflicts, dislikeMatches, validateHardExclusions, buildShopping, addMacros, macrosForCalories, recalculateDailyMacros, macroCalories };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {
    runtimeRecipeCatalogJson,
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutrition.MEAL_SLOT_SHARES,
    calculateMealPlanTargets: nutrition.calculateMealPlanTargets,
    capMacrosAtCalories: nutrition.capMacrosAtCalories,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
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
    planRecipeCookingRuns: cookingRuns.planRecipeCookingRuns,
    pooledCookingFatShare: cookingRuns.pooledCookingFatShare,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}

const { recipes, productionRecipes, isProductionReadyRecipe, recipeFamiliesById, recipeFamilyFor, canonicalIngredients, PILOT_RAW_SOURCE_SLUGS, portionFor, ingredientScaleFor, recipeCookingSession, solveRecipeFamily, solveRecipeBatch, materializeInstructions, aggregateCookingAmounts, normalizeRawRecipeCandidate, auditRawCandidateAgainstFamily, shareFor, plannedTargetsFor, macroDifference, candidateRecipes, hardConflicts, dislikeMatches, validateHardExclusions, buildShopping, addMacros, macrosForCalories, recalculateDailyMacros, macroCalories } = await loadRecipeCatalog();
const { validatePlanForPersistence } = await loadTypeScriptModule(
  new URL("../lib/plan-validation.ts", import.meta.url),
);
const recipe = (title) => {
  const found = recipes.find((item) => item.title === title);
  assert.ok(found, `recipe exists: ${title}`);
  return found;
};
const ingredientIds = (title) => recipe(title).ingredients.map((ingredient) => ingredient.id);

test("calorie profiles recalculate macros and keep their advertised energy shares", () => {
  const expectations = {
    balanced: [0.3, 0.3, 0.4],
    protein: [0.35, 0.3, 0.35],
    carbs: [0.25, 0.25, 0.5],
    fat: [0.3, 0.4, 0.3],
  };
  for (const [preset, [proteinShare, fatShare, carbShare]] of Object.entries(expectations)) {
    const result = macrosForCalories(2000, preset);
    assert.equal(result.kcal, 2000);
    assert.ok(Math.abs((result.protein * 4) / 2000 - proteinShare) < 0.005, `${preset} protein share`);
    assert.ok(Math.abs((result.fat * 9) / 2000 - fatShare) < 0.005, `${preset} fat share`);
    assert.ok(Math.abs((result.carbs * 4) / 2000 - carbShare) < 0.005, `${preset} carb share`);
    assert.ok(Math.abs(macroCalories(result) - result.kcal) <= 5, `${preset} stays near entered calories`);
  }
});

test("manual macro proportions scale when calories change", () => {
  const current = { kcal: 2000, protein: 125, fat: 100, carbs: 150 };
  const result = recalculateDailyMacros(2500, current, "custom");
  assert.equal(result.kcal, 2500);
  assert.equal(result.protein, 156);
  assert.equal(result.fat, 125);
  assert.equal(result.carbs, 187);
  assert.ok(Math.abs(macroCalories(result) - result.kcal) <= 5);
});

test("daily macro totals are rounded before they reach the week UI", () => {
  const total = addMacros([
    { kcal: 499.6, protein: 60.6, fat: 8.2, carbs: 45.2 },
    { kcal: 496.8, protein: 65.1, fat: 25.2, carbs: 2.1 },
  ]);
  assert.equal(JSON.stringify(total), JSON.stringify({
    kcal: 996,
    protein: 126,
    fat: 33,
    carbs: 47,
  }));
});

test("generated ingredients match the recipe title", () => {
  assert.equal(ingredientIds("Тунец с зелёной фасолью").filter((id) => id.includes("beans")).join(","), "green-beans");
  assert.ok(ingredientIds("Тунец с зелёной фасолью").includes("tuna"));
  assert.ok(ingredientIds("Кето-сырники").includes("cottage"));
  assert.ok(!ingredientIds("Кето-сырники").includes("cheese"));
  assert.ok(ingredientIds("Кето-брауни мини").includes("cocoa"));
  assert.ok(!ingredientIds("Кето-брауни мини").includes("turkey"));
  assert.ok(!ingredientIds("Кето-брауни мини").includes("spinach"));
  assert.ok(ingredientIds("Говяжьи котлеты с цветной капустой").includes("beef"));
  assert.ok(!ingredientIds("Говяжьи котлеты с цветной капустой").includes("chicken-thigh"));
  assert.ok(ingredientIds("Индейка в сливочном соусе").includes("cream"));
  assert.ok(ingredientIds("Домашний хумус с лепёшкой").includes("flatbread"));
});

test("Chile Lime Chicken lists every measured ingredient used by its procedure", () => {
  const dish = recipe("Курица с лаймом, золотым рисом и брокколи");
  const ingredients = new Map(dish.ingredients.map((item) => [item.id, item]));
  for (const id of ["turmeric", "garlic", "paprika", "oregano", "olive-oil"]) {
    const ingredient = ingredients.get(id);
    assert.ok(ingredient, `${id} is listed for shopping`);
    assert.ok(ingredient.quantity > 0, `${id} has a practical measured amount`);
    assert.ok(ingredient.group.length > 0, `${id} has a shopping group`);
  }
  assert.match(dish.steps.join(" "), /куркум.*чеснок/i);
  assert.match(dish.steps.join(" "), /паприк.*ореган.*масл/i);
});

test("ingredients and recipes expose structured allergen and label metadata", () => {
  for (const item of recipes) {
    assert.ok(Array.isArray(item.allergens), `${item.title} has recipe allergen tags`);
    for (const ingredient of item.ingredients) {
      assert.ok(Array.isArray(ingredient.allergens), `${ingredient.name} has allergen tags`);
      assert.equal(typeof ingredient.checkLabel, "boolean", `${ingredient.name} has label guidance`);
      for (const allergen of ingredient.allergens) assert.ok(item.allergens.includes(allergen));
    }
  }

  assert.ok(recipe("Тунец с зелёной фасолью").allergens.includes("fish"));
  assert.ok(recipe("Кето-сырники").allergens.includes("milk"));
  assert.ok(recipes.some((item) => item.ingredients.some((ingredient) => ingredient.id === "tofu" && ingredient.allergens.includes("soy"))));
  assert.ok(recipes.some((item) => item.ingredients.some((ingredient) => ingredient.id === "peanut-butter" && ingredient.allergens.includes("peanut") && ingredient.checkLabel)));
});

test("generated paleo and keto recipes keep their strict ingredient rules", () => {
  const generated = recipes.filter((item) => item.id.startsWith("gen-"));
  const paleoForbidden = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "bulgur", "pasta", "flatbread", "cottage", "cheese", "cream-cheese", "cream"]);
  const ketoForbidden = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "potato", "sweet-potato", "bulgur", "pasta", "flatbread"]);
  for (const item of generated) {
    assert.ok(item.ingredients.length >= 2, `${item.title} has at least two ingredients`);
    const forbidden = item.tags.includes("paleo") ? paleoForbidden : item.tags.includes("keto") ? ketoForbidden : null;
    if (forbidden) assert.ok(item.ingredients.every((ingredient) => !forbidden.has(ingredient.id)), `${item.title} follows ${item.tags[0]} rules`);
  }
});

test("parsed recipes keep auditable source and adaptation metadata", () => {
  const parsed = recipes.filter((item) => item.provenance.kind === "parsed");
  assert.ok(parsed.length >= 210);
  for (const item of parsed) {
    assert.match(item.provenance.sourceUrl, /^https:\/\//);
    assert.ok(item.provenance.sourceTitle.length > 0);
    assert.ok(item.provenance.sourceQuery.length > 0);
  }
});

test("source photos and localization notes are attached to imported recipes", () => {
  const withPhotos = recipes.filter((item) => item.provenance.kind === "parsed" && item.provenance.imageUrl);
  assert.ok(withPhotos.length > 0);
  assert.ok(withPhotos.length < recipes.filter((item) => item.provenance.kind === "parsed").length, "photos remain optional");
  assert.ok(withPhotos.every((item) => item.provenance.imageAlt && item.provenance.sourceUrl));
  for (const id of ["src-taco-mac", "src-teriyaki-tray", "src-halal-chicken"]) {
    const item = recipes.find((candidate) => candidate.id === id);
    assert.ok(item);
    assert.equal(item.localization.fit, "adapted");
    assert.ok(item.localization.note.length > 0);
  }
});

test("runtime catalog cards do not hotlink third-party recipe photos", async () => {
  const runtimeCatalog = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const runtimeIds = new Set(runtimeCatalog.recipes.map((item) => item.id));
  const runtimeRecipes = recipes.filter((item) => runtimeIds.has(item.id));
  assert.equal(runtimeRecipes.length, runtimeIds.size);
  assert.ok(runtimeRecipes.length >= 200);
  assert.ok(runtimeRecipes.every((item) => item.provenance.imageUrl === undefined));
});

test("production fat-sensitive ingredients expose an honest fat note", () => {
  const fatSensitiveIds = new Set([
    "beef", "beef-mince", "pork-mince", "tuna", "salmon", "milk", "cottage", "cream",
    "yogurt", "butter", "kefir", "cream-cheese", "cheese", "parmesan", "feta",
    "mozzarella",
  ]);
  const ingredients = productionRecipes.flatMap((item) => item.ingredients)
    .filter((item) => fatSensitiveIds.has(item.id));
  assert.ok(ingredients.length > 0);
  assert.ok(ingredients.every((item) => item.fatNote?.length > 0));
  assert.ok(ingredients.filter((item) => item.id === "milk").every((item) => item.name === "Молоко 2%" && item.fatNote === "2%"));
  const cheeses = ingredients.filter((item) => ["cream-cheese", "cheese", "parmesan", "feta", "mozzarella"].includes(item.id));
  assert.ok(cheeses.length > 0);
  assert.ok(cheeses.every((item) => ["regular", "light", "either"].includes(item.cheeseVariant)));
  assert.ok(cheeses.every((item) => /^(?:обычный|обычная|лёгкий|лёгкая)/u.test(item.fatNote)));
  assert.ok(cheeses.some((item) => item.cheeseVariant === "either" && /КБЖУ рассчитаны для обычного/u.test(item.fatNote)));
  assert.ok(cheeses.some((item) => item.cheeseVariant === "regular" && item.fatNote === "обычный"));
  const yogurts = ingredients.filter((item) => item.id === "yogurt");
  assert.ok(yogurts.length > 0);
  assert.ok(yogurts.every((item) => item.fatNote === "≈2% по расчётному профилю" && item.checkLabel === false));
  assert.equal(canonicalIngredients.cream_processed.nutritionPer100g.fat, 10);
  assert.equal(canonicalIngredients.cream_processed.reference.dataType, "brand_label");
  assert.equal(canonicalIngredients.cheese_processed.canonicalName, "Полутвёрдый сыр (обычный)");
  assert.equal(canonicalIngredients.yogurt_processed.canonicalName, "Греческий йогурт 2%");
});

test("frozen berry recipes name the berry explicitly", () => {
  const frozenBerryIngredients = recipes.flatMap((item) => item.ingredients)
    .filter((item) => item.id === "berries" && /заморож/iu.test(item.name));
  assert.equal(frozenBerryIngredients.length, 2);
  assert.ok(frozenBerryIngredients.every((item) => item.name === "Замороженная черника"));
  assert.equal(canonicalIngredients.berries_raw.canonicalName, "Черника");
  assert.match(canonicalIngredients.berries_raw.reference.description, /Blueberries/u);
  assert.ok(recipes.some((item) => item.id === "src-protein-oats" && /черник/u.test(item.title)));
  assert.ok(recipes.some((item) => item.id === "src-frozen-yogurt" && /черник/u.test(item.title)));
});

test("editorial promotion fixes unit-sized macros and obvious slot mistakes", () => {
  const nuggets = recipes.find((item) => item.id === "src-chicken-nuggets");
  const rolls = recipes.find((item) => item.id === "src-breakfast-rolls");
  const granola = recipes.find((item) => item.id === "src-cinnamon-granola");
  const massOats = recipes.find((item) => item.id === "src-banana-oat-bake");
  assert.equal(nuggets.macros.kcal, 178);
  assert.equal(nuggets.macros.protein, 20.4);
  assert.equal(rolls.macros.kcal, 447);
  assert.equal(granola.slot, "snack2");
  assert.match(granola.storage.ambient, /сухой герметичной банке/i);
  assert.equal(massOats.macros.kcal, 490);
  assert.ok([nuggets, rolls, granola, massOats].every((item) => item.provenance.kind === "parsed" && item.provenance.adaptation));
});

test("new Meal Prep Manual recipes keep reviewed portions, localization and storage", () => {
  const ids = [
    "src-sausage-pepper-pasta",
    "src-honey-lime-steak",
    "src-chile-lime-chicken",
    "src-light-stroganoff",
    "src-sriracha-lime-chicken",
    "src-bbq-burger-bowl",
    "src-red-pepper-chicken-dip",
    "src-beefy-cheese-potatoes",
  ];
  const promoted = ids.map((id) => recipes.find((item) => item.id === id));
  assert.ok(promoted.every(Boolean));
  assert.ok(promoted.every((item) => item.provenance.kind === "parsed" && item.provenance.imageUrl && item.provenance.adaptation));

  const stroganoff = promoted.find((item) => item.id === "src-light-stroganoff");
  assert.equal(stroganoff.macros.kcal, 507);
  assert.equal(stroganoff.macros.protein, 40);
  assert.match(stroganoff.provenance.adaptation, /пополам/i);

  const dip = promoted.find((item) => item.id === "src-red-pepper-chicken-dip");
  assert.equal(dip.macros.kcal, 218);
  assert.equal(dip.freezable, false);
  assert.match(dip.storage.refrigerator, /3 суток/i);
});

test("every recipe has bounded flexibility, effort and storage guidance", () => {
  for (const item of recipes) {
    for (const range of Object.values(item.flex)) {
      assert.ok(range[0] > 0 && range[0] <= 1);
      assert.ok(range[1] >= 1 && range[1] <= 1.5);
    }
    assert.ok(["low", "high"].includes(item.effort.level));
    assert.ok(item.effort.knifeActions >= 0);
    assert.ok(item.effort.cookware >= 1);
    assert.ok(item.effort.activeActions >= 1);
    assert.ok(item.effort.activeMinutes > 0 && item.effort.activeMinutes <= item.time);
    assert.ok(item.storage.refrigerator.length > 0);
    assert.ok(item.storage.freezer.length > 0);
    assert.ok(item.storage.freezeParts.length > 0);
    assert.ok(item.storage.thaw.length > 0);
    if (item.freezable) {
      assert.ok(item.storage.freezerDays > 0);
    } else {
      assert.match(item.storage.freezer, /не замораживать/i);
      assert.match(item.storage.thaw, /не предусмотрена/i);
    }
  }
});

test("every active recipe has complete actionable instructions and container guidance", () => {
  assert.ok(productionRecipes.length >= 200, "the complete active catalog is checked");
  assert.equal(new Set(recipes.map((item) => item.id)).size, recipes.length, "recipe ids stay unique");

  for (const item of productionRecipes) {
    assert.ok(item.ingredients.length >= 2, `${item.title} has ingredients`);
    assert.ok(item.ingredients.every((ingredient) => ingredient.quantity > 0 && ingredient.unit.length > 0), `${item.title} has ingredient amounts`);
    assert.ok(item.steps.length >= 3, `${item.title} has a usable sequence`);
    assert.match(item.steps[0], /на одну базовую порцию отмерьте/i, `${item.title} starts with measured ingredients`);
    for (const ingredient of item.ingredients) {
      assert.ok(item.steps[0].includes(ingredient.name), `${item.title} instruction names ${ingredient.name}`);
      assert.ok(item.steps[0].includes(String(ingredient.quantity)), `${item.title} instruction gives an amount for ${ingredient.name}`);
    }
    assert.ok(item.steps.every((step) => step.length >= 20), `${item.title} steps are explanatory`);
    assert.ok(item.packing.portion.length >= 40, `${item.title} explains the practical container layout`);
    assert.ok(item.packing.label.includes(item.title) && /дата/i.test(item.packing.label), `${item.title} has a useful label template`);
  }
});

test("the plans API accepts every recipe exposed by the production catalog", () => {
  for (const item of productionRecipes) {
    const batchId = "batch-1";
    const personId = "person-1";
    const slot = item.slot;
    const plan = {
      id: `qa-${item.id}`,
      start: "2026-08-30",
      end: "2026-08-30",
      periodDays: 1,
      cookEveryDays: 1,
      menuStyle: "protein",
      mealSlots: [slot],
      people: [{
        id: personId,
        name: "QA",
        daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 },
        includedSlots: [slot],
      }],
      batches: [{ id: batchId, index: 0, start: "2026-08-30", end: "2026-08-30", days: 1 }],
      selections: { [`${batchId}:${slot}`]: item.id },
      selectionAssignments: { [`${batchId}:${slot}`]: [{ recipeId: item.id, personIds: [personId] }] },
      shopping: [],
    };
    assert.equal(validatePlanForPersistence(plan).valid, true, item.id);
  }
});

test("template cooking copy is no longer used by active recipes", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "Подготовьте и нарежьте все ингредиенты.",
    "Приготовьте основу и белковую часть до готовности.",
    "Соедините блюдо, попробуйте и скорректируйте специи.",
  ]) assert.ok(!source.includes(phrase), `removed template phrase: ${phrase}`);
});

test("legacy flex controls remain available for recipes outside the pilot migration", () => {
  const item = recipes.find((candidate) => candidate.id === "korean-bowl");
  assert.ok(item);
  const person = { id: "test", name: "Тест", daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 }, includedSlots: ["breakfast", "lunch", "dinner"] };
  const portion = portionFor(person, "lunch", item, { protein: 9, fat: 0.01, carbs: 9 });
  assert.equal(portion.ratios.protein, item.flex.protein[1]);
  assert.equal(portion.ratios.fat, item.flex.fat[0]);
  assert.equal(portion.ratios.carbs, item.flex.carbs[1]);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "chicken"), portion), portion.factor * portion.ratios.protein);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "rice"), portion), portion.factor * portion.ratios.carbs);
});

test("planned positions keep fixed shares and expose the daily remainder", () => {
  const daily = { kcal: 2100, protein: 150, fat: 70, carbs: 210 };
  for (const [slot, expected] of [["breakfast", 0.25], ["lunch", 0.3], ["dinner", 0.25], ["snack1", 0.1], ["snack2", 0.1]]) {
    const person = { id: "single", name: "Тест", daily, includedSlots: [slot] };
    assert.equal(shareFor(person, slot), expected);
  }
  const breakfastOnly = { id: "partial", name: "Тест", daily, includedSlots: ["breakfast"] };
  assert.equal(shareFor(breakfastOnly, "breakfast"), 0.25);

  const fullDay = { id: "full", name: "Тест", daily, includedSlots: ["breakfast", "snack1", "lunch", "snack2", "dinner"] };
  const fullDayTargets = plannedTargetsFor(fullDay);
  assert.equal(fullDayTargets.kcal, daily.kcal);
  assert.ok(macroCalories(fullDayTargets) <= daily.kcal);
  for (const key of ["protein", "fat", "carbs"]) assert.ok(Math.abs(fullDayTargets[key] - daily[key]) <= 5, `${key} stays within rounding tolerance`);

  const partialDay = { id: "partial-day", name: "Тест", daily: { kcal: 2000, protein: 140, fat: 70, carbs: 210 }, includedSlots: ["breakfast", "dinner"] };
  assert.equal(macroDifference(partialDay.daily, plannedTargetsFor(partialDay)).kcal, 1000);

  const allPositions = { ...fullDay, includedSlots: ["breakfast", "lunch", "dinner", "snack1", "snack2"] };
  assert.equal(plannedTargetsFor(allPositions).kcal, 2100);
  assert.equal(macroDifference(daily, plannedTargetsFor(allPositions)).kcal, 0);

  const duplicateLunch = { ...partialDay, includedSlots: ["lunch", "lunch"] };
  assert.equal(plannedTargetsFor(duplicateLunch).kcal, 600);
});

test("keeps ingredient variety and admits pasta salads only through the production gate", () => {
  const allIds = new Set(recipes.flatMap((item) => item.ingredients.map((ingredient) => ingredient.id)));
  for (const id of ["quinoa", "chia", "coconut-milk", "tofu", "sweet-potato"]) assert.ok(allIds.has(id), `${id} remains available`);
  const pastaSalads = productionRecipes.filter((item) =>
    /салат.*(?:паст|макарон)|(?:паст|макарон).*салат/i.test(item.title),
  );
  assert.ok(pastaSalads.every(isProductionReadyRecipe));
});

test("catalog shows every matching recipe while the plan builder keeps five choices", () => {
  const catalog = candidateRecipes("lunch", "protein", [], 1, { origin: "parsed", limit: "all" });
  const builder = candidateRecipes("lunch", "protein", [], 1, { origin: "parsed" });
  assert.ok(catalog.length > 0);
  assert.equal(builder.length, Math.min(5, catalog.length));
  assert.equal(
    JSON.stringify(builder.map((item) => item.id)),
    JSON.stringify(catalog.slice(0, 5).map((item) => item.id)),
  );
});

test("hard exclusions cannot be bypassed while dislikes stay reversible", () => {
  const basePerson = {
    id: "eater",
    name: "Тест",
    daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 },
    includedSlots: ["lunch"],
  };
  const hardPerson = { ...basePerson, hardExclusions: ["fish"] };
  const hardSafe = candidateRecipes("lunch", "protein", [hardPerson], 1, { limit: "all" });
  assert.ok(hardSafe.length > 0);
  assert.ok(hardSafe.every((item) => !item.allergens.includes("fish")));

  const softPerson = { ...basePerson, dislikes: ["broccoli"] };
  const preferred = candidateRecipes("lunch", "protein", [softPerson], 1, { limit: "all" });
  const allAllowed = candidateRecipes("lunch", "protein", [softPerson], 1, { limit: "all", includeDisliked: true });
  assert.ok(preferred.every((item) => dislikeMatches(item, softPerson).length === 0));
  assert.ok(allAllowed.some((item) => dislikeMatches(item, softPerson).length > 0));
  assert.ok(allAllowed.length > preferred.length);
});

test("plan validation catches an existing selection that conflicts with a person", () => {
  const tuna = recipe("Тунец с зелёной фасолью");
  const person = {
    id: "allergic",
    name: "Тест",
    daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 },
    includedSlots: [tuna.slot],
    hardExclusions: ["fish"],
  };
  assert.deepEqual([...hardConflicts(tuna, person)], ["fish"]);
  const batch = { id: "batch-0", index: 0, start: "2026-08-28", end: "2026-08-28", days: 1 };
  const conflicts = validateHardExclusions({
    batches: [batch],
    mealSlots: [tuna.slot],
    people: [person],
    selections: { [`${batch.id}:${tuna.slot}`]: tuna.id },
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].person.id, person.id);
  assert.equal(conflicts[0].recipe.id, tuna.id);
});

test("a personal assignment isolates an incompatible eater and feeds shopping", () => {
  const tuna = recipe("Тунец с зелёной фасолью");
  const allergic = {
    id: "allergic",
    name: "Аллергия на рыбу",
    daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 },
    includedSlots: [tuna.slot],
    hardExclusions: ["fish"],
  };
  const other = {
    ...allergic,
    id: "other",
    name: "Без ограничений",
    hardExclusions: [],
  };
  const safe = candidateRecipes(tuna.slot, "protein", [allergic], 1, {
    limit: "all",
  }).find((item) => item.id !== tuna.id);
  assert.ok(safe, "the incompatible eater has a safe personal dish");
  const batch = {
    id: "batch-0",
    index: 0,
    start: "2026-08-28",
    end: "2026-08-28",
    days: 1,
  };
  const key = `${batch.id}:${tuna.slot}`;
  const personalPlan = {
    batches: [batch],
    mealSlots: [tuna.slot],
    people: [allergic, other],
    selections: { [key]: tuna.id },
    selectionAssignments: {
      [key]: [
        { recipeId: safe.id, personIds: [allergic.id] },
        { recipeId: tuna.id, personIds: [other.id] },
      ],
    },
  };
  assert.deepEqual([...validateHardExclusions(personalPlan)], []);
  const shopping = buildShopping(personalPlan);
  assert.ok(shopping.length > 0);
  assert.ok(
    safe.ingredients.some((ingredient) =>
      shopping.some((item) => item.id === ingredient.id),
    ),
    "shopping includes the personal dish",
  );
  assert.ok(
    tuna.ingredients.some((ingredient) =>
      shopping.some((item) => item.id === ingredient.id),
    ),
    "shopping includes the shared-slot counterpart",
  );
  assert.deepEqual(
    [...buildShopping({ ...personalPlan, mealSlots: [] })],
    [],
    "a removed slot cannot leak stale selections back into shopping",
  );
});

test("shopping only shows an approximate piece count for ingredients supplied as pieces", () => {
  const shoppingFor = (item) => {
    const person = {
      id: "shopper",
      name: "Покупатель",
      daily: { kcal: 2200, protein: 150, fat: 75, carbs: 231 },
      includedSlots: [item.slot],
    };
    const batch = {
      id: "batch-shopping",
      index: 0,
      start: "2026-08-30",
      end: "2026-08-30",
      days: 1,
    };
    const key = `${batch.id}:${item.slot}`;
    return buildShopping({
      batches: [batch],
      mealSlots: [item.slot],
      people: [person],
      selections: { [key]: item.id },
      selectionAssignments: {
        [key]: [{ recipeId: item.id, personIds: [person.id] }],
      },
    });
  };

  const pasta = recipes.find((item) => item.id === "tmpm-28083");
  assert.ok(pasta);
  const pastaLine = shoppingFor(pasta).find((item) => item.id === "pasta_raw");
  assert.ok(pastaLine);
  assert.equal(pastaLine.unit, "г");
  assert.equal(pastaLine.pieceEstimate, undefined, "dry pasta is not counted as pieces");

  const pieceRecipe = recipes.find((item) => item.id === "src-chile-lime-chicken");
  assert.ok(pieceRecipe);
  const limeLine = shoppingFor(pieceRecipe).find((item) => /лайм|лимон/iu.test(item.name));
  assert.ok(limeLine);
  assert.equal(limeLine.unit, "г");
  assert.ok(limeLine.pieceEstimate >= 1, "a source piece is shown as grams plus an approximate count");
});

test("Recipe Engine v1 migrates 18 existing reviewed recipes without replacing the legacy catalog", () => {
  assert.equal(Object.keys(recipeFamiliesById).length, 18);
  assert.equal(Object.values(recipeFamiliesById).filter((family) => family.reviewStatus === "pilot").length, 10);
  assert.equal(Object.values(recipeFamiliesById).filter((family) => family.reviewStatus === "review_required").length, 8);
  assert.ok(recipes.length > Object.keys(recipeFamiliesById).length);
  for (const family of Object.values(recipeFamiliesById)) {
    assert.equal(family.id.startsWith("src-"), true, `${family.title} reuses an existing recipe`);
    assert.equal(family.provenance.kind, "parsed", `${family.title} preserves provenance`);
    assert.ok(family.image.sourceUrl, `${family.title} preserves source photo metadata`);
    assert.ok(family.ingredients.every((ingredient) => ingredient.canonicalIngredientId && ingredient.role), `${family.title} uses canonical ingredients and roles`);
    assert.equal(new Set(family.ingredients.map((ingredient) => ingredient.sourceIngredientId)).size, family.ingredients.length, `${family.title} has one editorial role per ingredient`);
    assert.ok(family.miseInstructions[0].ingredientIds.length === family.ingredients.length, `${family.title} parameterizes its ingredient step`);
    assert.ok(family.editorialAudit.ingredientMapping.reviewedAt, `${family.title} keeps ingredient mapping audit`);
    assert.equal(family.editorialAudit.ingredientMapping.sourceIngredientCount > 0, true, `${family.title} records source coverage`);
    assert.ok(family.editorialAudit.nutrition.reviewedAt && family.editorialAudit.nutrition.note, `${family.title} keeps scoped nutrition evidence`);
    assert.ok(Object.values(family.legacyEditorialNutrition).every(Number.isFinite), `${family.title} preserves historical editorial macros`);
    if (!family.editorialAudit.nutrition.comparableToMise) {
      assert.equal(family.editorialAudit.nutrition.quantitativeCoverage, "incomplete");
      assert.equal(family.comparisonNutrition, null, `${family.title} does not compare incompatible nutrition bases`);
      assert.equal(family.nutritionDelta, null, `${family.title} does not invent a nutrition delta`);
      assert.equal(family.nutritionDeltaKcal, null, `${family.title} keeps the numeric delta empty`);
      assert.equal(family.reviewStatus, "review_required", `${family.title} remains blocked until adapted nutrition is reviewed`);
      continue;
    }
    assert.equal(family.editorialAudit.nutrition.quantitativeCoverage, "verified", `${family.title} gates comparison on quantitative coverage`);
    assert.ok(family.sourceNutrition && family.comparisonNutrition, `${family.title} keeps source and comparison nutrition separately`);
    assert.ok(Number.isFinite(family.nutritionDeltaKcal), `${family.title} keeps source vs Mise nutrition QA`);
    assert.ok(Object.values(family.nutritionDelta).every(Number.isFinite), `${family.title} keeps full macro deltas`);
    const thresholds = {
      kcal: Math.max(50, family.comparisonNutrition.kcal * 0.1),
      protein: Math.max(5, family.comparisonNutrition.protein * 0.15),
      fat: Math.max(4, family.comparisonNutrition.fat * 0.2),
      carbs: Math.max(8, family.comparisonNutrition.carbs * 0.15),
    };
    const expectedStatus = Object.keys(thresholds).some((key) => Math.abs(family.nutritionDelta[key]) > thresholds[key]) ? "review_required" : "pilot";
    assert.equal(family.reviewStatus, expectedStatus, `${family.title} exposes its editorial nutrition status`);
  }
});

test("every canonical ingredient used by the 18 pilot families has an auditable nutrition reference", () => {
  const used = new Set(Object.values(recipeFamiliesById).flatMap((family) => family.ingredients.map((ingredient) => ingredient.canonicalIngredientId)));
  for (const id of used) {
    const ingredient = canonicalIngredients[id];
    assert.ok(ingredient, `${id} is present in the canonical registry`);
    assert.ok(ingredient.reference.provider && ingredient.reference.checkedAt && ingredient.reference.sourceUrl, `${id} has source metadata`);
    assert.ok(ingredient.reference.recordId && ingredient.reference.description && ingredient.reference.dataType, `${id} identifies the exact reference profile`);
    assert.ok(Object.values(ingredient.nutritionPer100g).every(Number.isFinite), `${id} has finite KБЖУ`);
  }
});

test("the seven source-audited adaptations resolve every legacy source ingredient explicitly", () => {
  const curatedFamilies = Object.values(recipeFamiliesById).filter((family) => family.editorialAudit.ingredientMapping.source === "curated_source_audit");
  assert.equal(curatedFamilies.length, 7);
  assert.equal(curatedFamilies.reduce((sum, family) => sum + family.editorialAudit.ingredientMapping.sourceIngredientCount, 0), 55);
  let hasUnavailableSourceAmount = false;
  for (const family of curatedFamilies) {
    const audit = family.editorialAudit.ingredientMapping;
    assert.equal(audit.decisions.length, audit.sourceIngredientCount, `${family.title} covers every source component`);
    assert.equal(audit.decisions.some((decision) => decision.disposition === "unresolved"), false, `${family.title} has no ambiguous source component`);
    assert.equal(family.editorialAudit.nutrition.quantitativeCoverage, "incomplete", `${family.title} cannot be declared comparable before its missing source quantities are resolved`);
    const familyCanonicalIds = new Set(family.ingredients.map((ingredient) => ingredient.canonicalIngredientId));
    const auditedCanonicalIds = new Set(audit.decisions.flatMap((decision) => decision.canonicalIngredientIds));
    assert.equal([...familyCanonicalIds].every((id) => auditedCanonicalIds.has(id)), true, `${family.title} links every adapted ingredient back to source audit`);
    for (const decision of audit.decisions) {
      assert.ok(decision.reason, `${family.title}: ${decision.sourceName} has an editorial reason`);
      if (decision.disposition !== "retained" && decision.disposition !== "replaced") continue;
      assert.ok(decision.canonicalIngredientIds.length > 0, `${family.title}: ${decision.sourceName} points to the adaptation`);
      assert.equal(decision.miseAmounts.length > 0, true, `${family.title}: ${decision.sourceName} records the adapted amount and unit`);
      assert.equal(decision.miseAmounts.every((amount) => Number.isFinite(amount.amount) && amount.unit), true);
      if (decision.amountStatus === "source_amount_unavailable") hasUnavailableSourceAmount = true;
      if (decision.amountStatus === "quantified") assert.ok(Number.isFinite(decision.sourceAmount) && decision.sourceUnit);
      for (const id of decision.canonicalIngredientIds) {
        assert.ok(familyCanonicalIds.has(id), `${family.title}: ${decision.sourceName} target is present in Recipe Family`);
        assert.ok(canonicalIngredients[id]?.reference?.sourceUrl, `${family.title}: ${decision.sourceName} target has nutrition evidence`);
      }
    }
  }
  assert.equal(hasUnavailableSourceAmount, true, "legacy source gaps stay explicit instead of being treated as comparable");
  assert.equal(recipeFamiliesById["src-cottage-bake"].editorialAudit.nutrition.scope, "per_100g_raw");
  assert.equal(recipeFamiliesById["src-protein-oats"].sourceNutrition.kcal, 349);
  assert.equal(recipeFamiliesById["src-chicken-bean-bowl"].sourceNutrition.kcal, 378);
  assert.equal(recipeFamiliesById["src-salmon-rice-veg"].sourceNutrition, null);
  assert.equal(curatedFamilies.every((family) => family.reviewStatus === "review_required"), true);
});

test("missing caloric and allergenic source components are explicit in the pilot families", () => {
  const expected = {
    "src-turkey-meatballs": ["egg", "olive-oil"],
    "src-taco-mac": ["broth", "olive-oil"],
    "src-teriyaki-tray": ["olive-oil", "brown-sugar", "vinegar", "garlic"],
    "src-halal-chicken": ["butter", "olive-oil", "lemon", "vinegar"],
    "src-crispy-beef-noodles": ["olive-oil", "honey", "oyster-sauce", "garlic"],
    "src-mediterranean-wrap": ["olive-oil", "lemon", "vinegar"],
    "src-creamy-chicken-pasta": ["olive-oil", "lemon", "bouillon"],
    "src-light-stroganoff": ["mustard", "worcestershire", "starch"],
    "src-bbq-burger-bowl": ["olive-oil"],
  };
  for (const [familyId, ids] of Object.entries(expected)) {
    const actual = new Set(recipeFamiliesById[familyId].ingredients.map((ingredient) => ingredient.sourceIngredientId));
    for (const id of ids) assert.ok(actual.has(id), `${familyId} includes ${id}`);
  }
  const crispy = recipes.find((item) => item.id === "src-crispy-beef-noodles");
  assert.ok(crispy.allergens.includes("molluscs"));
  assert.ok(crispy.allergens.includes("soy"));
  assert.ok(crispy.allergens.includes("gluten"));
  const bouillon = canonicalIngredients.bouillon_processed;
  assert.ok(bouillon.allergens.includes("soy"));
  assert.ok(bouillon.allergens.includes("gluten"));
});

test("raw candidate adapter preserves 217 source pages as 221 derived cards and legacy editorial statuses", async () => {
  const datasets = await Promise.all([
    readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/goodfood-candidates.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const drafts = datasets.flatMap((dataset) => dataset.candidates.map((candidate) => normalizeRawRecipeCandidate(candidate, { publisher: dataset.source, accessedAt: dataset.importedAt })));
  assert.equal(drafts.length, 221);
  assert.equal(drafts.filter((draft) => draft.editorial.reviewStatus === "promoted").length, 28);
  assert.equal(drafts.filter((draft) => draft.editorial.reviewStatus === "pending").length, 193);
  assert.ok(drafts.every((draft) => draft.sourceUrl && draft.imageUrl && draft.sourceIngredients.length > 0));
  assert.ok(drafts.every((draft) => Object.values(draft.sourceNutrition).every(Number.isFinite)));
  assert.ok(drafts.every((draft) => draft.legacy.editorialStatus === draft.editorial.legacyStatus));

  const pilotDrafts = drafts.filter((draft) => PILOT_RAW_SOURCE_SLUGS.some((slug) => draft.sourceUrl.includes(slug)));
  assert.equal(pilotDrafts.length, 11, "all pilot families backed by the raw corpus are selected without adding raw cards");
  const allDispositions = [];
  for (const draft of pilotDrafts) {
    assert.equal(draft.ingredientMappings.length, draft.sourceIngredients.length, `${draft.sourceTitle} has a decision for every source ingredient`);
    assert.equal(draft.ingredientMappings.some((mapping) => mapping.status === "unresolved"), false, `${draft.sourceTitle} has 100% canonical resolution`);
    assert.notEqual(draft.normalizationStatus, "ingredient_review_required", `${draft.sourceTitle} leaves ingredient review`);
    const family = Object.values(recipeFamiliesById).find((item) => item.provenance.sourceUrl === draft.sourceUrl);
    assert.ok(family, `${draft.sourceTitle} is linked to its pilot Recipe Family`);
    assert.equal(family.editorialAudit.ingredientMapping.source, "raw_candidate");
    assert.ok(
      family.editorialAudit.ingredientMapping.sourceIngredientCount >= draft.sourceIngredients.length,
      `${draft.sourceTitle} records all normalized source ingredients while dispositions retain full source coverage`,
    );
    assert.equal(JSON.stringify(family.sourceNutrition), JSON.stringify(draft.sourceNutrition), `${draft.sourceTitle} preserves publisher nutrition instead of legacy edits`);
    assert.equal(family.editorialAudit.nutrition.sourceServings, draft.servings, `${draft.sourceTitle} preserves source serving basis`);
    const dispositions = auditRawCandidateAgainstFamily(draft, family);
    assert.equal(dispositions.length, draft.sourceIngredients.length, `${draft.sourceTitle} resolves every source ingredient against the adaptation`);
    assert.equal(dispositions.some((decision) => decision.disposition === "unresolved"), false, `${draft.sourceTitle} has no silent source-to-adaptation gap`);
    assert.equal(family.editorialAudit.nutrition.quantitativeCoverage, "verified", `${draft.sourceTitle} exposes a verified quantitative gate`);
    const quantitativeDecisions = dispositions.filter((decision) => decision.disposition === "retained" || decision.disposition === "replaced");
    assert.ok(quantitativeDecisions.length > 0);
    assert.equal(quantitativeDecisions.every((decision) => decision.amountStatus === "quantified"), true, `${draft.sourceTitle} keeps source and Mise amounts for every retained or replaced component`);
    assert.equal(quantitativeDecisions.every((decision) => Number.isFinite(decision.sourceAmountPerServing) && Number.isFinite(decision.sourceAmountForMiseServing) && decision.sourceUnit && decision.miseAmounts.length > 0), true, `${draft.sourceTitle} has amount, unit and serving-conversion coverage before nutrition comparison`);
    allDispositions.push(...dispositions.map((decision) => ({ ...decision, familyId: family.id })));
  }
  const rawPepper = pilotDrafts.flatMap((draft) => draft.ingredientMappings).filter((mapping) => mapping.sourceName.toLowerCase() === "pepper");
  assert.ok(rawPepper.length >= 5);
  assert.ok(rawPepper.every((mapping) => mapping.status === "ignored_microcomponent"), "black pepper is not mapped to sweet bell pepper");
  const syntheticPepper = normalizeRawRecipeCandidate({
    id: "synthetic-black-pepper",
    sourceTitle: "Synthetic mapping regression",
    sourceUrl: "https://example.invalid/synthetic-black-pepper",
    sourceIngredients: [{ id: "pepper", name: "black pepper" }],
    sourceNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  }, { publisher: "test", accessedAt: "2026-08-29" });
  assert.equal(syntheticPepper.ingredientMappings[0].status, "ignored_microcomponent", "an untrusted raw id cannot override the source name");
  const trustedPepper = normalizeRawRecipeCandidate({
    id: "synthetic-canonical-pepper",
    sourceTitle: "Synthetic canonical mapping",
    sourceUrl: "https://example.invalid/synthetic-canonical-pepper",
    sourceIngredients: [{ id: "pepper_raw", name: "black pepper" }],
    sourceNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  }, { publisher: "test", accessedAt: "2026-08-29" });
  assert.equal(trustedPepper.ingredientMappings[0].canonicalIngredientId, "pepper_raw", "only an exact canonical id is trusted over the source name");
  const teriyaki = pilotDrafts.find((draft) => draft.sourceTitle === "Sheet Pan Teriyaki Chicken and Vegetables");
  assert.equal(
    teriyaki.ingredientMappings.some(
      (mapping) => mapping.sourceName.toLowerCase() === "mirin",
    ),
    false,
    "the owner-reviewed mirin replacement is stored as measured vinegar and sugar",
  );
  assert.equal(
    teriyaki.ingredientMappings.filter(
      (mapping) =>
        mapping.status === "mapped" &&
        ["brown_sugar_processed", "vinegar_processed"].includes(
          mapping.canonicalIngredientId,
        ),
    ).length,
    4,
  );
  const omittedFoods = allDispositions.filter((decision) => decision.disposition === "omitted_by_adaptation");
  assert.equal(omittedFoods.length, 9, "all real source foods omitted from raw-backed adaptations are explicit");
  assert.ok(omittedFoods.some((decision) => decision.familyId === "src-mediterranean-wrap" && decision.sourceName.toLowerCase() === "ginger"));
  assert.ok(omittedFoods.some((decision) => decision.familyId === "src-honey-lime-steak" && decision.sourceName.toLowerCase() === "jalapeño"));
  for (const decision of allDispositions) {
    for (const id of decision.canonicalIngredientIds) {
      assert.ok(canonicalIngredients[id]?.reference?.sourceUrl, `${decision.familyId}: ${decision.sourceName} has an auditable canonical reference`);
    }
  }
  const rawMappingCounts = pilotDrafts.flatMap((draft) => draft.ingredientMappings).reduce((counts, mapping) => {
    counts[mapping.status] = (counts[mapping.status] ?? 0) + 1;
    return counts;
  }, {});
  assert.equal(rawMappingCounts.mapped, 130);
  assert.equal((rawMappingCounts.ignored_noncaloric ?? 0) + (rawMappingCounts.ignored_microcomponent ?? 0), 68);
  assert.ok(rawMappingCounts.ignored_noncaloric > 0);
  assert.ok(rawMappingCounts.ignored_microcomponent > 0);
  assert.equal(rawMappingCounts.replaced ?? 0, 0);
  assert.equal(rawMappingCounts.unresolved ?? 0, 0);
  assert.equal(recipeFamiliesById["src-halal-chicken"].comparisonNutrition.kcal, 773, "halal chicken compares against the unedited raw source value");
  assert.equal(recipeFamiliesById["src-red-pepper-chicken-dip"].comparisonNutrition.kcal, 218, "dip records that one Mise portion equals two source portions");
  assert.equal(recipeFamiliesById["src-light-stroganoff"].comparisonNutrition.kcal, 506.5, "stroganoff records that one Mise portion equals half a source portion");
  const dipChicken = allDispositions.find((decision) => decision.familyId === "src-red-pepper-chicken-dip" && decision.sourceName === "boneless skinless chicken breast");
  assert.equal(dipChicken.sourceAmountForMiseServing, 90.8, "dip ingredient ledger applies the 2× source-serving ratio");
  const stroganoffBeef = allDispositions.find((decision) => decision.familyId === "src-light-stroganoff" && decision.sourceName === "top round roast");
  assert.equal(stroganoffBeef.sourceAmountForMiseServing, 113.5, "stroganoff ingredient ledger applies the 0.5× source-serving ratio");
});

test("review-required families stay out of automatic menu candidates", () => {
  const breakfastIds = candidateRecipes("breakfast", "protein", [], 1, { limit: "all" }).map((item) => item.id);
  const lunchIds = candidateRecipes("lunch", "protein", [], 1, { limit: "all" }).map((item) => item.id);
  assert.equal(breakfastIds.includes("src-cottage-bake"), false);
  assert.equal(lunchIds.includes("src-taco-mac"), true);
});

test("release menu candidates exclude hidden keto, paleo and vegan diet cards", () => {
  const hiddenDiet = (item) =>
    item.tags.some((tag) => tag === "keto" || tag === "paleo") ||
    /(?:vegan|веган|keto|кето|paleo|палео)/iu.test(item.title);
  const hiddenProductionCards = productionRecipes.filter(hiddenDiet);
  assert.ok(hiddenProductionCards.length >= 4, "the regression fixture includes hidden diet cards");

  for (const style of ["protein", "budget"])
    for (const slot of ["breakfast", "snack1", "lunch", "snack2", "dinner"]) {
      const candidates = candidateRecipes(slot, style, [], 1, { limit: "all" });
      assert.ok(candidates.length > 0, `${style}/${slot} keeps release candidates`);
      assert.equal(
        candidates.some(hiddenDiet),
        false,
        `${style}/${slot} does not leak a hidden diet card`,
      );
    }
});

test("production catalog contains only explicitly reviewed complete recipes", () => {
  const blockedIds = Object.values(recipeFamiliesById)
    .filter((family) => family.reviewStatus === "review_required")
    .map((family) => family.id)
    .sort();
  const visibleIds = new Set(productionRecipes.map((item) => item.id));

  assert.equal(blockedIds.length, 8);
  const expectedReadyIds = recipes
    .filter(
      (item) =>
        (item.provenance.kind === "parsed" ||
          item.provenance.editoriallyApproved === true) &&
        item.ingredients.length >= 3 &&
        recipeFamilyFor(item)?.reviewStatus === "pilot",
    )
    .map((item) => item.id)
    .sort();

  assert.equal(productionRecipes.length, expectedReadyIds.length);
  assert.ok(productionRecipes.length >= 200);
  assert.equal(JSON.stringify([...visibleIds].sort()), JSON.stringify(expectedReadyIds));
  assert.ok(blockedIds.every((id) => !visibleIds.has(id)));
  assert.ok(
    productionRecipes.every(
      (item) =>
        item.provenance.kind === "parsed" ||
        item.provenance.editoriallyApproved === true,
    ),
    "generated placeholders require explicit editorial approval",
  );
  assert.ok(productionRecipes.every((item) => item.ingredients.length >= 3));
  assert.ok(productionRecipes.every(isProductionReadyRecipe));

  for (const slot of ["breakfast", "snack1", "lunch", "snack2", "dinner"])
    for (const style of ["protein", "budget", "paleo", "keto"])
      assert.ok(
        candidateRecipes(slot, style, [], 1, { limit: "all" }).every((item) =>
          visibleIds.has(item.id),
        ),
        `${style}/${slot} candidates stay inside the production catalog`,
      );
});

test("pilot solver reaches viable 450, 600 and 750 kcal targets without absurd ingredient amounts", () => {
  for (const family of Object.values(recipeFamiliesById)) {
    for (const targetCalories of [450, 600, 750]) {
      if (targetCalories < family.minViableCalories || targetCalories > family.maxViableCalories) continue;
      const solved = solveRecipeFamily(family, { targetCalories });
      assert.equal(solved.viable, true, `${family.title} solves ${targetCalories}: ${solved.explanation.join(" ")}`);
      assert.ok(Math.abs(solved.nutrition.kcal - targetCalories) <= Math.max(12, targetCalories * 0.025), `${family.title} stays near ${targetCalories}`);
      assert.ok(solved.nutrition.protein >= family.minimumProtein - 0.2, `${family.title} keeps minimum protein`);
      for (const ingredient of family.ingredients) {
        const amount = solved.amounts[ingredient.sourceIngredientId];
        assert.ok(amount >= ingredient.minAmount - 0.51 && amount <= ingredient.maxAmount + 0.51, `${family.title}: ${ingredient.sourceIngredientId} stays bounded`);
        if (ingredient.role === "protein" && ingredient.unit !== "piece") assert.ok(amount >= 45, `${family.title}: protein does not collapse`);
        if (ingredient.role === "vegetable") assert.ok(amount > 0, `${family.title}: vegetables remain`);
        if (ingredient.unit !== "piece" && ingredient.scalable) assert.equal(amount, Math.round(amount), `${family.title}: scalable gram amounts are practical`);
        if (!ingredient.scalable) assert.equal(amount, ingredient.baseAmount, `${family.title}: fixed ingredients keep their editorial amount`);
      }
    }
  }
});

test("audited pan and form fats stay fixed across personal calorie targets", () => {
  const cookingFats = Object.values(recipeFamiliesById)
    .flatMap((family) => family.ingredients
      .filter((ingredient) => ingredient.role === "fat_cooking")
      .map((ingredient) => ({ family, ingredient })));

  assert.deepEqual(
    cookingFats.map(({ family, ingredient }) => `${family.id}:${ingredient.sourceIngredientId}`).sort(),
    [
      "src-chicken-bean-bowl:olive-oil",
      "src-cottage-bake:butter",
      "src-crispy-beef-noodles:olive-oil",
      "src-honey-lime-steak:olive-oil",
      "src-sausage-pepper-pasta:olive-oil",
      "src-taco-mac:olive-oil",
      "src-turkey-meatballs:olive-oil",
    ],
    "only audited pan and form fats are fixed; marinade and coating fats remain edible recipe components",
  );
  for (const { family, ingredient } of cookingFats) {
    assert.equal(ingredient.scalable, false, `${family.title}: ${ingredient.sourceIngredientId} is fixed`);
    assert.equal(ingredient.minAmount, ingredient.baseAmount);
    assert.equal(ingredient.preferredMin, ingredient.baseAmount);
    assert.equal(ingredient.preferredMax, ingredient.baseAmount);
    assert.equal(ingredient.maxAmount, ingredient.baseAmount);
    for (const targetCalories of [450, 600, 750]) {
      if (targetCalories < family.minViableCalories || targetCalories > family.maxViableCalories) continue;
      const solved = solveRecipeFamily(family, { targetCalories });
      assert.equal(
        solved.amounts[ingredient.sourceIngredientId],
        ingredient.baseAmount,
        `${family.title}: ${ingredient.sourceIngredientId} stays fixed at ${targetCalories} kcal`,
      );
    }
  }
});

test("a shared batch uses pan and form fat once, then allocates it across portions", () => {
  const family = recipeFamiliesById["src-chicken-bean-bowl"];
  const cookingFat = family.ingredients.find((ingredient) => ingredient.role === "fat_cooking");
  assert.ok(cookingFat);

  const batch = solveRecipeBatch(family, [
    { id: "higher", targetCalories: 600 },
    { id: "lower", targetCalories: 450 },
  ]);

  assert.equal(batch.viable, true);
  assert.equal(batch.sharedCookingTotals[cookingFat.sourceIngredientId], cookingFat.baseAmount);
  assert.equal(batch.totals[cookingFat.sourceIngredientId], cookingFat.baseAmount);
  assert.equal(
    Math.round(
      batch.packing.reduce(
        (sum, portion) => sum + portion.ingredientAmounts[cookingFat.sourceIngredientId],
        0,
      ) * 10,
    ) / 10,
    cookingFat.baseAmount,
  );
  assert.ok(Math.abs(batch.packing[0].calories - 600) <= 15);
  assert.ok(Math.abs(batch.packing[1].calories - 450) <= 12);

  const empty = solveRecipeBatch(family, []);
  assert.equal(empty.viable, true);
  assert.equal(JSON.stringify(empty.totals), "{}");
  assert.equal(JSON.stringify(empty.sharedCookingTotals), "{}");

  const invalid = solveRecipeBatch(family, [{ id: "invalid", targetCalories: 0 }]);
  assert.equal(invalid.viable, false);
  assert.equal(JSON.stringify(invalid.totals), "{}");
  assert.equal(JSON.stringify(invalid.sharedCookingTotals), "{}");
});

test("solver exposes not-viable and hard-exclusion outcomes instead of deforming a dish", () => {
  const family = recipeFamiliesById["src-teriyaki-tray"];
  const high = solveRecipeFamily(family, { targetCalories: 750 });
  assert.ok(high.amounts["sweet-potato"] >= 45, "a high-calorie tray keeps its second carb component");
  assert.ok(high.amounts.broccoli >= 90, "a high-calorie tray does not remove vegetables");
  const tooSmall = solveRecipeFamily(family, { targetCalories: 300 });
  assert.equal(tooSmall.viable, false);
  assert.equal(tooSmall.reason, "outside_calorie_range");
  const allergen = solveRecipeFamily(recipeFamiliesById["src-salmon-rice-veg"], { targetCalories: 600, hardExclusions: ["fish"] });
  assert.equal(allergen.viable, false);
  assert.equal(allergen.reason, "hard_exclusion");
  const bouillonAllergen = solveRecipeFamily(recipeFamiliesById["src-creamy-chicken-pasta"], { targetCalories: 600, hardExclusions: ["soy"] });
  assert.equal(bouillonAllergen.viable, false);
  assert.equal(bouillonAllergen.reason, "hard_exclusion");
});

test("two-person solver sums 600 and 450 kcal portions into one batch and parameterizes instructions", () => {
  const family = recipeFamiliesById["src-teriyaki-tray"];
  const batch = solveRecipeBatch(family, [
    { id: "person-a", targetCalories: 600 },
    { id: "person-b", targetCalories: 450 },
  ]);
  assert.equal(batch.viable, true);
  assert.equal(batch.portions.length, 2);
  for (const ingredient of family.ingredients) {
    const id = ingredient.sourceIngredientId;
    assert.equal(batch.totals[id], Math.round((batch.portions[0].variant.amounts[id] + batch.portions[1].variant.amounts[id]) * 10) / 10);
  }
  const displayNames = Object.fromEntries(
    family.ingredients.map((ingredient) => [ingredient.sourceIngredientId, `Покупательское имя ${ingredient.sourceIngredientId}`]),
  );
  const steps = materializeInstructions(family, batch.totals, displayNames);
  assert.equal(steps.length, family.miseInstructions.length);
  assert.match(steps[0], /Покупательское имя chicken-thigh/i);
  assert.match(steps[0], /г/);
  assert.equal(family.miseInstructions[0].action, "measure");
  assert.equal(family.miseInstructions.length, recipes.find((item) => item.id === family.id).steps.length);
  assert.equal(
    family.miseInstructions.filter((step) => step.action !== "measure").length,
    recipes.find((item) => item.id === family.id).steps.length - 1,
  );
  assert.equal(
    family.miseInstructions[1].text,
    recipes.find((item) => item.id === family.id).steps[1],
  );
});

test("cooking amounts count pan fat once and all other ingredients for every day", () => {
  const family = recipeFamiliesById["src-cottage-bake"];
  const onePortion = Object.fromEntries(
    family.ingredients.map((ingredient) => [ingredient.sourceIngredientId, ingredient.baseAmount]),
  );
  const totals = aggregateCookingAmounts(family.ingredients, [onePortion, onePortion], 3);
  for (const ingredient of family.ingredients) {
    const expected = ingredient.role === "fat_cooking"
      ? ingredient.baseAmount
      : ingredient.baseAmount * 2 * 3;
    assert.equal(totals[ingredient.sourceIngredientId], expected);
  }
});

test("recipe view and shopping helper use solved family amounts for a multi-day batch", () => {
  const item = recipes.find((candidate) => candidate.id === "src-taco-mac");
  const family = recipeFamiliesById[item.id];
  const people = [
    { id: "a", name: "А", daily: { kcal: 2000, protein: 150, fat: 65, carbs: 210 }, includedSlots: ["lunch"] },
    { id: "b", name: "Б", daily: { kcal: 1600, protein: 120, fat: 55, carbs: 165 }, includedSlots: ["lunch"] },
  ];
  const session = recipeCookingSession(people, "lunch", item, 3);
  assert.equal(session.viable, true);
  const portions = session.portions;
  assert.ok(portions.every((portion) => portion.engine === "recipe-family-v1"));
  const amounts = session.runPlan.totals;
  for (const ingredient of family.ingredients) {
    const expected = ingredient.role === "fat_cooking"
      ? ingredient.baseAmount * session.runCount
      : Math.round(portions.reduce((sum, portion) => sum + portion.solvedAmounts[ingredient.sourceIngredientId], 0) * 3 * 10) / 10;
    assert.equal(amounts[ingredient.sourceIngredientId], expected);
  }
});

test("portion adapter uses Recipe Engine for migrated recipes and legacy math elsewhere", () => {
  const person = { id: "engine", name: "Тест", daily: { kcal: 2000, protein: 140, fat: 65, carbs: 220 }, includedSlots: ["lunch"] };
  const migrated = portionFor(person, "lunch", recipe("Курица с рисом и овощами"));
  const legacy = portionFor(person, "lunch", recipe("Куриный боул по-корейски"));
  assert.equal(migrated.engine, "recipe-family-v1");
  assert.equal(legacy.engine, "legacy");
  assert.ok(migrated.solvedAmounts.chicken > 0);
});
