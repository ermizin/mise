import assert from "node:assert/strict";
import test from "node:test";
import {
  NUTRITION_AUDIT_REASON,
  auditNutritionEntry,
  auditRecipeNutritionCorpus,
  convertIngredientToGrams,
} from "../scripts/audit-recipe-nutrition.mjs";

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
});

test("nutrition audit refuses incompatible units instead of inventing a conversion", () => {
  assert.equal(convertIngredientToGrams({ amount: 10, unit: "ml" }, canonical()).code, NUTRITION_AUDIT_REASON.ML_DENSITY_MISSING);
  assert.equal(convertIngredientToGrams({ amount: 1, unit: "piece" }, canonical()).code, NUTRITION_AUDIT_REASON.PIECE_WEIGHT_MISSING);
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
  assert.equal(report.total, 217);
  assert.equal(report.cards.length, 217);
  assert.equal(new Set(report.cards.map((card) => card.id)).size, 217);
  assert.equal(report.counts.ready + report.counts.review_required + report.counts.blocked, 217);
  for (const card of report.cards.filter((item) => item.verdict === "ready")) {
    assert.equal(card.calculationComplete, true);
    assert.ok(card.comparison);
    assert.equal(card.comparison.outside.length, 0);
  }
});
