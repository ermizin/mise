import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

async function loadRecipeCatalog() {
  const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__catalog = { recipes, portionFor, ingredientScaleFor, shareFor: (person, slot) => nutritionShareForSlots(person.includedSlots, slot), plannedTargetsFor, macroDifference, candidateRecipes, macrosForCalories, recalculateDailyMacros, macroCalories };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    calculateMealPlanTargets: nutrition.calculateMealPlanTargets,
    capMacrosAtCalories: nutrition.capMacrosAtCalories,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}

const { recipes, portionFor, ingredientScaleFor, shareFor, plannedTargetsFor, macroDifference, candidateRecipes, macrosForCalories, recalculateDailyMacros, macroCalories } = await loadRecipeCatalog();
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
  assert.equal(parsed.length, 39);
  for (const item of parsed) {
    assert.match(item.provenance.sourceUrl, /^https:\/\//);
    assert.ok(item.provenance.sourceTitle.length > 0);
    assert.ok(item.provenance.sourceQuery.length > 0);
  }
});

test("source photos and localization notes are attached to imported recipes", () => {
  const withPhotos = recipes.filter((item) => item.provenance.kind === "parsed" && item.provenance.imageUrl);
  assert.equal(withPhotos.length, 29);
  assert.ok(withPhotos.every((item) => item.provenance.imageAlt && item.provenance.sourceUrl));
  for (const id of ["src-taco-mac", "src-teriyaki-tray", "src-halal-chicken"]) {
    const item = recipes.find((candidate) => candidate.id === id);
    assert.ok(item);
    assert.equal(item.localization.fit, "adapted");
    assert.ok(item.localization.note.length > 0);
  }
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
  assert.ok(recipes.length >= 150, "the complete active catalog is checked");
  assert.equal(new Set(recipes.map((item) => item.id)).size, recipes.length, "recipe ids stay unique");

  for (const item of recipes) {
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

test("template cooking copy is no longer used by active recipes", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "Подготовьте и нарежьте все ингредиенты.",
    "Приготовьте основу и белковую часть до готовности.",
    "Соедините блюдо, попробуйте и скорректируйте специи.",
  ]) assert.ok(!source.includes(phrase), `removed template phrase: ${phrase}`);
});

test("flex controls clamp values and scale ingredient groups independently", () => {
  const item = recipes.find((candidate) => candidate.id === "src-chicken-buckwheat");
  assert.ok(item);
  const person = { id: "test", name: "Тест", daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 }, includedSlots: ["breakfast", "lunch", "dinner"] };
  const portion = portionFor(person, "lunch", item, { protein: 9, fat: 0.01, carbs: 9 });
  assert.equal(portion.ratios.protein, item.flex.protein[1]);
  assert.equal(portion.ratios.fat, item.flex.fat[0]);
  assert.equal(portion.ratios.carbs, item.flex.carbs[1]);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "chicken"), portion), portion.factor * portion.ratios.protein);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "buckwheat"), portion), portion.factor * portion.ratios.carbs);
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

test("keeps the approved ingredients and excludes pasta salads from the first pool", () => {
  const allIds = new Set(recipes.flatMap((item) => item.ingredients.map((ingredient) => ingredient.id)));
  for (const id of ["quinoa", "chia", "coconut-milk", "tofu", "sweet-potato"]) assert.ok(allIds.has(id), `${id} remains available`);
  assert.ok(recipes.every((item) => !/салат.*(?:паст|макарон)|(?:паст|макарон).*салат/i.test(item.title)));
});

test("catalog shows every matching recipe while the plan builder keeps five choices", () => {
  const catalog = candidateRecipes("lunch", "protein", [], 1, { origin: "generated", limit: "all" });
  const builder = candidateRecipes("lunch", "protein", [], 1, { origin: "generated" });
  assert.ok(catalog.length > 5);
  assert.equal(builder.length, 5);
});
