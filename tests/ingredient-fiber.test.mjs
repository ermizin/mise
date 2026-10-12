import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const { canonicalIngredients, fiberForFamily, FIBER_CHECKED_AT } = engine;
const source = await readFile(new URL("../domain/recipe-engine.ts", import.meta.url), "utf8");

test("every canonical ingredient carries a finite, sourced fiber value", () => {
  const all = Object.values(canonicalIngredients);
  assert.equal(all.length, 230);
  assert.equal(FIBER_CHECKED_AT, "2026-10-12");
  for (const ingredient of all) {
    assert.ok(Number.isFinite(ingredient.fiberPer100g) && ingredient.fiberPer100g >= 0, `${ingredient.id} has fiber`);
    assert.ok(ingredient.fiberReference.record, `${ingredient.id} names the fiber record`);
    if (ingredient.fiberReference.record === "label" || ingredient.fiberReference.record !== ingredient.reference.recordId)
      assert.ok(ingredient.fiberReference.note.length > 10, `${ingredient.id} explains a proxy or label value`);
  }
});

test("fiber sits inside USDA carbohydrates by difference, so it never exceeds them", () => {
  // Кокосовая паста считается по европейской этикетке, где углеводы указаны
  // без клетчатки; остальные профили — USDA «by difference».
  const labelCarbsWithoutFiber = new Set(["creamed_coconut_processed"]);
  for (const ingredient of Object.values(canonicalIngredients)) {
    if (labelCarbsWithoutFiber.has(ingredient.id)) continue;
    assert.ok(
      ingredient.fiberPer100g <= ingredient.nutritionPer100g.carbs + 0.05,
      `${ingredient.id}: fiber ${ingredient.fiberPer100g} > carbs ${ingredient.nutritionPer100g.carbs}`,
    );
  }
});

test("fiber values match the USDA records for the everyday products", () => {
  const expected = {
    broccoli_raw: 2.6,
    carrot_raw: 2.8,
    cabbage_raw: 2.5,
    buckwheat_raw: 10.3,
    oats_raw: 10.6,
    lentils_raw: 10.7,
    potato_raw: 2.1,
    pumpkin_raw: 2,
    chicken_raw: 0,
    cottage_processed: 0,
    egg_raw: 0,
  };
  for (const [id, grams] of Object.entries(expected)) {
    const ingredient = canonicalIngredients[id];
    assert.ok(ingredient, `${id} exists`);
    assert.equal(ingredient.fiberPer100g, grams, id);
  }
});

test("a family's fiber follows the actual amounts and the measuring unit", () => {
  const family = {
    ingredients: [
      { sourceIngredientId: "a", canonicalIngredientId: "oats_raw", unit: "g", baseAmount: 50 },
      { sourceIngredientId: "b", canonicalIngredientId: "carrot_raw", unit: "piece", baseAmount: 1 },
      { sourceIngredientId: "c", canonicalIngredientId: "chicken_raw", unit: "g", baseAmount: 150 },
    ],
  };
  const carrotGrams = canonicalIngredients.carrot_raw.unit.gramsPerUnit;
  assert.equal(fiberForFamily(family), Math.round((10.6 * 0.5 + 2.8 * carrotGrams / 100) * 10) / 10);
  assert.equal(fiberForFamily(family, { a: 100, b: 0, c: 150 }), 10.6);
});

test("fiber stays outside the four-macro Nutrition shape", () => {
  // Солвер, сгенерированные каталоги и сохранённые планы остаются на КБЖУ.
  assert.match(source, /export type Nutrition = \{\s*kcal: number;\s*protein: number;\s*fat: number;\s*carbs: number;\s*\};/);
  assert.match(source, /return \{ kcal: round\(result\.kcal\), protein: round\(result\.protein\), fat: round\(result\.fat\), carbs: round\(result\.carbs\) \};/);
});
