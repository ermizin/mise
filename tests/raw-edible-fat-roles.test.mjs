import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));

const edibleIngredients = [
  ["tmpm-28584", "source-ingredient-2", "butter_processed", "editorial-step-2-part-1"],
  ["tmpm-28504", "source-ingredient-3", "butter_processed", "editorial-step-2-part-1"],
  ["tmpm-26872", "source-ingredient-13", "butter_processed", "editorial-step-1-part-2"],
  ["tmpm-26660", "source-ingredient-11", "butter_processed", "editorial-step-2-part-3"],
  ["tmpm-26441", "source-ingredient-7", "peanut_butter_processed", "editorial-step-1-part-2"],
  ["tmpm-26441", "source-ingredient-9", "sesame_oil_processed", "editorial-step-1-part-2"],
  ["tmpm-25290", "source-ingredient-9", "butter_processed", "editorial-step-1-part-3"],
  ["tmpm-25290", "source-ingredient-12", "peanut_butter_processed", "editorial-step-2-part-2"],
  ["tmpm-24949", "source-ingredient-2", "peanut_butter_processed", "editorial-step-2-part-1"],
  ["tmpm-24949", "source-ingredient-7", "sesame_oil_processed", "editorial-step-2-part-1"],
  ["tmpm-23797", "source-ingredient-20", "butter_processed", "editorial-step-1-part-3"],
  ["tmpm-23797", "source-ingredient-21", "peanut_butter_processed", "editorial-step-1-part-3"],
  ["tmpm-23545", "source-ingredient-6", "butter_processed", "editorial-step-1-part-2"],
  ["tmpm-23501", "source-ingredient-14", "sesame_oil_processed", "editorial-step-1-part-3"],
  ["tmpm-23462", "source-ingredient-6", "butter_processed", "editorial-step-1-part-2"],
  ["tmpm-23316", "source-ingredient-6", "butter_processed", "editorial-step-1-part-2"],
  ["tmpm-22922", "source-ingredient-7", "butter_processed", "editorial-step-1-part-3"],
  ["tmpm-22531", "source-ingredient-4", "peanut_butter_processed", "editorial-step-1-part-4"],
  ["tmpm-22531", "source-ingredient-11", "peanut_butter_processed", "editorial-step-1-part-4"],
  ["tmpm-22428", "source-ingredient-12", "butter_processed", "editorial-step-1-part-1"],
  ["tmpm-22144", "source-ingredient-12", "peanut_butter_processed", "editorial-step-1-part-4"],
  ["tmpm-21976", "source-ingredient-7", "butter_processed", "editorial-step-1-part-2"],
  ["tmpm-16850", "source-ingredient-6", "sesame_oil_processed", "editorial-step-1-part-2"],
  ["tmpm-16046", "source-ingredient-6", "butter_processed", "editorial-step-1-part-3"],
  ["goodfood-satay-sweet-potato-curry", "source-ingredient-6", "peanut_butter_processed", "editorial-step-1-part-2"],
  ["goodfood-vegan-breakfast-muffins", "source-ingredient-8", "peanut_butter_processed", "editorial-step-1-part-3"],
  ["goodfood-chicken-sweet-potato-peanut-stew", "source-ingredient-8", "peanut_butter_processed", "editorial-step-2-part-1"],
  ["goodfood-prawn-rice-mango-jar-salad", "source-ingredient-8", "sesame_oil_processed", "editorial-step-2-part-1"],
  ["goodfood-veggie-nuggets-with-summer-slaw", "source-ingredient-6", "peanut_butter_processed", "editorial-step-1-part-3"],
  ["goodfood-veggie-shepherds-pie-sweet-potato-mash", "source-ingredient-10", "butter_processed", "editorial-step-1-part-3"],
  ["goodfood-tuna-pasta-bake", "source-ingredient-2", "butter_processed", "editorial-step-1-part-3"],
  ["goodfood-courgette-tomato-soup", "source-ingredient-1", "butter_processed", "editorial-step-1-part-1"],
  ["goodfood-creamy-chicken-sweetcorn-soup", "source-ingredient-8", "butter_processed", "editorial-step-1-part-1"],
  ["goodfood-family-meals-easy-beef-stew-sweet-potato-topping", "source-ingredient-12", "butter_processed", "editorial-step-3-part-1"],
  ["goodfood-beef-red-wine-potato-pie", "source-ingredient-12", "butter_processed", "editorial-step-3-part-1"],
  ["goodfood-beef-red-wine-potato-pie", "source-ingredient-15", "butter_processed", "editorial-step-3-part-2"],
  ["goodfood-roasted-tomato-pancetta-picnic-quiches", "source-ingredient-2", "butter_processed", "editorial-step-2-part-1"],
  ["new-home-cutlets-mash", "source-ingredient-7", "butter_processed", "editorial-step-3-part-1"],
  ["foodru-oblomov-meatballs", "source-ingredient-15", "butter_processed", "editorial-step-3-part-1"],
  ["foodru-oblomov-pepper-beef", "source-ingredient-4", "butter_processed", "editorial-step-3-part-1"],
  ["foodru-oblomov-pepper-chicken", "source-ingredient-4", "butter_processed", "editorial-step-3-part-1"],
  ["foodru-oblomov-seabass", "source-ingredient-4", "butter_processed", "editorial-step-2-part-1"],
];

function familyFor(recipeId) {
  const recipe = catalog.recipes.find((item) => item.id === recipeId);
  assert.ok(recipe, `${recipeId} is released`);
  return recipe.recipeFamily;
}

test("audited edible fats retain their recipe-specific instruction and scale with the food", () => {
  for (const [recipeId, sourceIngredientId, canonicalIngredientId, instructionId] of edibleIngredients) {
    const family = familyFor(recipeId);
    const ingredient = family.ingredients.find((item) => item.sourceIngredientId === sourceIngredientId);
    assert.equal(ingredient?.canonicalIngredientId, canonicalIngredientId, `${recipeId}/${sourceIngredientId}`);
    assert.equal(ingredient?.role, "fat", `${recipeId}/${sourceIngredientId}`);
    assert.ok(family.miseInstructions.some((step) => step.id === instructionId), `${recipeId}/${instructionId}`);
  }
});

test("unreviewed pan-fat records preserve the one-session policy", () => {
  for (const [recipeId, sourceIngredientId] of [
    ["tmpm-28572", "source-ingredient-3"],
    ["tmpm-26996", "source-ingredient-10"],
    ["tmpm-17591", "source-ingredient-12"],
    ["foodru-oblomov-chashushuli", "source-ingredient-6"],
  ]) {
    const ingredient = familyFor(recipeId).ingredients.find((item) => item.sourceIngredientId === sourceIngredientId);
    assert.equal(ingredient?.role, "fat_cooking", `${recipeId}/${sourceIngredientId}`);
  }
});

test("edible sauce and mash fats are multiplied for every portion, pan oil is not", () => {
  for (const [recipeId, edibleId, panId] of [
    ["tmpm-24949", "source-ingredient-7", undefined],
    ["new-home-cutlets-mash", "source-ingredient-7", "source-ingredient-15"],
  ]) {
    const family = familyFor(recipeId);
    const amounts = Object.fromEntries(family.ingredients.map((ingredient) => [ingredient.sourceIngredientId, ingredient.baseAmount]));
    const cooking = engine.aggregateCookingAmounts(family.ingredients, [amounts, amounts, amounts]);
    const edible = family.ingredients.find((ingredient) => ingredient.sourceIngredientId === edibleId);
    assert.equal(cooking[edibleId], Math.round(edible.baseAmount * 3 * 10) / 10, `${recipeId} edible fat scales`);
    if (panId) {
      const pan = family.ingredients.find((ingredient) => ingredient.sourceIngredientId === panId);
      assert.equal(pan.role, "fat_cooking", `${recipeId} pan oil remains fixed`);
      assert.equal(cooking[panId], pan.baseAmount, `${recipeId} pan oil is one-session`);
    }
  }
});
