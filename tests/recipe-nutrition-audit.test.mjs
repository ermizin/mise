import assert from "node:assert/strict";
import test from "node:test";
import {
  NUTRITION_AUDIT_REASON,
  auditNutritionEntry,
  auditRecipeNutritionCorpus,
  convertIngredientToGrams,
} from "../scripts/audit-recipe-nutrition.mjs";
import { sourceAmount } from "../scripts/recipe-corpus-normalize.mjs";

const canonical = (overrides = {}) => ({
  id: "test_processed",
  nutritionPer100g: { kcal: 100, protein: 10, fat: 5, carbs: 8 },
  unit: { sensibleUnit: "g", gramsPerUnit: 1, roundTo: 1 },
  ...overrides,
});

test("nutrition audit converts explicit grams, ml by density, and declared pieces", () => {
  assert.deepEqual(convertIngredientToGrams({ amount: 125, unit: "g" }, canonical()), { ok: true, grams: 125 });
  assert.deepEqual(convertIngredientToGrams({ amount: 200, unit: "ml" }, canonical({ densityGPerMl: 1.03 })), { ok: true, grams: 206 });
  assert.deepEqual(
    convertIngredientToGrams({ amount: 2, unit: "piece" }, canonical({ unit: { sensibleUnit: "piece", gramsPerUnit: 50, roundTo: 0.1 } })),
    { ok: true, grams: 100 },
  );
  assert.deepEqual(
    convertIngredientToGrams({ amount: 12, unit: "piece" }, canonical({ unit: { sensibleUnit: "g", gramsPerUnit: 20, roundTo: 5 } })),
    { ok: true, grams: 240 },
  );
});

test("nutrition audit refuses incompatible units instead of inventing a conversion", () => {
  assert.equal(convertIngredientToGrams({ amount: 10, unit: "ml" }, canonical()).code, NUTRITION_AUDIT_REASON.ML_DENSITY_MISSING);
  assert.equal(convertIngredientToGrams({ amount: 1, unit: "piece" }, canonical()).code, NUTRITION_AUDIT_REASON.PIECE_WEIGHT_MISSING);
});

test("standard household measures use fixed conversions without an uncertainty warning", () => {
  assert.deepEqual(sourceAmount({ original: "2 tbsp olive oil" }), { amount: 30, unit: "ml", status: "standard_household" });
  assert.deepEqual(sourceAmount({ original: "1 tsp olive oil" }), { amount: 5, unit: "ml", status: "standard_household" });
  assert.deepEqual(sourceAmount({ original: "1/2 cup olive oil" }), { amount: 120, unit: "ml", status: "standard_household" });
  assert.deepEqual(sourceAmount({ original: "1 oz oats" }), { amount: 28.3495, unit: "g", status: "standard_household" });

  const report = auditNutritionEntry({
    id: "household-oil", title: "Household oil", sourceUrl: "https://example.test", servings: 1,
    macros: { kcal: 119, protein: 0, fat: 13.5, carbs: 0 },
    ingredients: [{ name: "olive oil", original: "1 tbsp olive oil" }],
  });
  assert.equal(report.verdict, "ready");
  assert.equal(report.calculationComplete, true);
  assert.ok(!report.reasons.some((item) => item.code === "estimated_household_measure"));
});

test("standard household volume still needs a verified ingredient density", () => {
  const report = auditNutritionEntry({
    id: "household-volume", title: "Household volume", sourceUrl: "https://example.test", servings: 1,
    macros: { kcal: 10, protein: 1, fat: 0, carbs: 1 },
    ingredients: [{ name: "asparagus", original: "1 tbsp asparagus" }],
  });
  assert.equal(report.calculatedNutrition, null);
  assert.equal(report.verdict, "blocked");
  assert.ok(report.reasons.some((item) => item.code === NUTRITION_AUDIT_REASON.ML_DENSITY_MISSING));
});

test("single-product editorial amounts use documented standard averages", () => {
  const measured = (original, name = original) => sourceAmount({ original, name });
  assert.deepEqual(measured("thumb-sized piece ginger", "ginger"), { amount: 25, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("knob butter", "butter"), { amount: 15, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("large knob of butter", "butter"), { amount: 25, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("good squeeze of lemon juice", "lemon juice"), { amount: 15, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("squeeze lemon juice", "lemon juice"), { amount: 10, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("splash of milk", "milk"), { amount: 30, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("drop of olive oil", "olive oil"), { amount: 5, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("juice of 2 lemons", "lemon juice"), { amount: 60, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("juice 1½-2 lemons", "lemon juice"), { amount: 50, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("large glass red wine", "red wine"), { amount: 250, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("flour for dusting", "flour"), { amount: 30, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("olive oil for frying", "olive oil"), { amount: 30, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("olive oil for drizzling", "olive oil"), { amount: 15, unit: "ml", status: "standard_average" });
  assert.deepEqual(measured("ketchup, optional", "ketchup"), { amount: 40, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("a large handful of parsley", "parsley"), { amount: 30, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("a small pack spinach", "spinach"), { amount: 200, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("big handful rocket", "rocket"), { amount: 60, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("large pack grated cheese", "cheese"), { amount: 100, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("handful sweetcorn", "sweetcorn"), { amount: 100, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("handful peas", "peas"), { amount: 75, unit: "g", status: "standard_average" });
  assert.deepEqual(measured("handful peanuts", "peanuts"), { amount: 30, unit: "g", status: "standard_average" });
});

test("averages do not guess servings from combined garnish lines or bare staples", () => {
  assert.equal(sourceAmount({ original: "cooked basmati rice, lime wedges and naan, to serve", name: "cooked basmati rice lime wedges and naan" }), undefined);
  assert.equal(sourceAmount({ original: "jasmine rice", name: "jasmine rice" }), undefined);
  assert.equal(sourceAmount({ original: "handful of corn and peas", name: "corn and peas" }), undefined);
});

test("counted vegetables use the canonical average piece mass", () => {
  const report = auditNutritionEntry({
    id: "counted-broccoli", title: "Counted broccoli", sourceUrl: "https://example.test", servings: 1,
    macros: { kcal: 119, protein: 9.9, fat: 1.3, carbs: 23.2 },
    ingredients: [{ name: "broccoli", original: "1 broccoli" }],
  });
  assert.equal(report.calculationComplete, true);
  assert.equal(report.verdict, "ready");
  assert.deepEqual(report.calculatedNutrition, { kcal: 119, protein: 9.9, fat: 1.3, carbs: 23.2 });
});

test("counted ingredients with a known average mass are fully calculated", () => {
  const report = auditNutritionEntry({
    id: "counted-eggs", title: "Counted eggs", sourceUrl: "https://example.test", servings: 1,
    macros: { kcal: 143, protein: 12.6, fat: 9.5, carbs: 0.7 },
    ingredients: [{ name: "eggs", original: "2 eggs" }],
  });
  assert.equal(report.calculationComplete, true);
  assert.equal(report.verdict, "ready");
  assert.deepEqual(report.calculatedNutrition, { kcal: 143, protein: 12.6, fat: 9.5, carbs: 0.7 });
});

test("incomplete ingredient mappings make the card blocked and suppress a partial calculation", () => {
  const report = auditNutritionEntry({
    id: "incomplete", title: "Incomplete", sourceUrl: "https://example.test", servings: 1,
    macros: { kcal: 100, protein: 10, fat: 5, carbs: 8 },
    ingredients: [{ name: "unmapped protein powder", amountMetric: "30", unitMetric: "g", original: "30 g unmapped protein powder" }],
  });
  assert.equal(report.calculatedNutrition, null);
  assert.equal(report.verdict, "blocked");
  assert.ok(report.reasons.some((item) => item.code === NUTRITION_AUDIT_REASON.UNRESOLVED_INGREDIENT));
});

test("nutrition deltas distinguish a reasonable source match from a bad mismatch", () => {
  const recipe = (macros) => ({
    id: `egg-${macros.kcal}`, title: "Eggs", sourceUrl: "https://example.test", servings: 1, macros,
    ingredients: [{ name: "eggs", amountMetric: "100", unitMetric: "g", original: "100 g eggs" }],
  });
  const within = auditNutritionEntry(recipe({ kcal: 143, protein: 12.6, fat: 9.5, carbs: 0.7 }));
  assert.equal(within.verdict, "ready");
  assert.ok(within.reasons.some((item) => item.code === NUTRITION_AUDIT_REASON.DELTA_WITHIN_TOLERANCE));
  const outside = auditNutritionEntry(recipe({ kcal: 350, protein: 35, fat: 2, carbs: 60 }));
  assert.equal(outside.verdict, "review_required");
  assert.ok(outside.reasons.some((item) => item.code === NUTRITION_AUDIT_REASON.DELTA_OUTSIDE_TOLERANCE));
});

test("nutrition audit emits one machine verdict for every scraped recipe", async () => {
  const report = await auditRecipeNutritionCorpus();
  assert.equal(report.total, 221);
  assert.equal(report.cards.length, report.total);
  assert.equal(new Set(report.cards.map((card) => card.id)).size, report.total);
  assert.equal(report.counts.ready + report.counts.review_required + report.counts.blocked, report.total);
  assert.equal(report.reasonCounts.ml_density_missing ?? 0, 0, "all current household-volume ingredients use an explicit standard density");
  for (const card of report.cards.filter((item) => item.verdict === "ready")) {
    assert.equal(card.calculationComplete, true);
    assert.ok(card.comparison);
  }
  assert.deepEqual(
    report.cards.filter((item) => item.verdict === "blocked").map((item) => item.id).sort(),
    [
      "goodfood-lemon-parmesan-vinaigrette",
      "goodfood-peperonata",
      "goodfood-pickled-red-cabbage-salad",
      "goodfood-yellow-coconut-curry-sauce",
    ],
  );
});
