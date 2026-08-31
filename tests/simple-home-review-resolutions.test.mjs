import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyResolutions,
  extractRecipes,
  renderResolvedReview,
  resolutions,
} from "../scripts/apply-simple-home-review-resolutions.mjs";

const reviewUrl = new URL("../public/review-tool/simple-home-high-protein-review.html", import.meta.url);
const html = await readFile(reviewUrl, "utf8");
const recipes = extractRecipes(html);
const recipe = (recipeId) => {
  const found = recipes.find((item) => item.id === recipeId);
  assert.ok(found, `recipe exists: ${recipeId}`);
  return found;
};

test("second review contains the 40 recipes still under consideration", () => {
  assert.equal(recipes.length, 40);
  assert.equal(recipes.filter((item) => item.kind === "new").length, 34);
  assert.equal(recipes.filter((item) => item.kind === "existing").length, 6);
  for (const recipeId of resolutions.rejectedRecipeIds) {
    assert.ok(!recipes.some((item) => item.id === recipeId), `${recipeId} remains rejected`);
  }
  assert.match(html, /40 карточек: 34 новых \+ 6 из базы/u);
  assert.match(html, /mise-simple-home-high-protein-review-v2/u);
});

test("all repeated owner notes are propagated across their recipe groups", () => {
  for (const { recipeId, proteinGrams } of resolutions.overnightOats) {
    const item = recipe(recipeId);
    const protein = item.ingredients.find((ingredient) => ingredient.name === "Протеиновый порошок");
    assert.equal(protein?.grams, proteinGrams, `${recipeId} lists measured protein`);
    assert.match(item.steps.join(" "), new RegExp(`${proteinGrams}\\s*г\\s+протеинового порошка`, "iu"));
    assert.match(item.adaptation, new RegExp(`${proteinGrams}\\s*г\\s+протеина`, "iu"));
  }

  for (const recipeId of resolutions.zeroSauceSandwichRecipeIds) {
    const item = recipe(recipeId);
    const sauce = item.ingredients.find((ingredient) => ingredient.name === "Низкокалорийный zero-соус");
    assert.equal(sauce?.grams, 15, `${recipeId} lists 15 g zero sauce`);
    assert.equal(sauce?.checkLabel, true, `${recipeId} requires a label check`);
    assert.match(item.steps.join(" "), /15\s*г\s+zero-соуса/iu);
  }

  for (const [recipeId, title] of Object.entries(resolutions.titleOverrides)) {
    assert.equal(recipe(recipeId).title, title);
  }
  assert.ok(recipes.every((item) => !/^Славн/iu.test(item.title)), "curated display titles no longer use 'Славный'");
});

test("individual recipe notes are resolved without hidden optional ingredients", () => {
  const casserole = recipe("goodfood-family-meals-chicken-veg-casserole");
  assert.doesNotMatch(casserole.steps.join(" "), /(?:^|\s)нут(?:\s|[,.!?;:]|$)|рисом/iu);

  const fishCakes = recipe("goodfood-family-meals-easy-fish-cakes");
  const cheddar = fishCakes.ingredients.find((ingredient) => ingredient.name === "Чеддер (обычный)");
  assert.equal(cheddar?.grams, 8);
  assert.equal(cheddar?.checkLabel, true);
  assert.match(fishCakes.steps.join(" "), /чеддером/iu);
  assert.doesNotMatch(fishCakes.steps.join(" "), /сливочного масла/iu);

  const buckwheat = recipe("new-home-buckwheat-legs");
  assert.match(buckwheat.title, /бёдрами/iu);
  assert.doesNotMatch(buckwheat.steps.join(" "), /ножки/iu);

  assert.equal(recipe("new-sandwich-boiled-chicken").ingredients[1].name, "Куриная грудка, варёная");
  assert.equal(recipe("new-sandwich-smoked-chicken").ingredients[1].name, "Копчёная курица без кожи");
  assert.equal(recipe("new-sandwich-turkey-ham").ingredients[1].name, "Ветчина из индейки");
  assert.equal(recipe("new-sandwich-balyk").ingredients[1].name, "Балык");

  for (const recipeId of [
    "foodru-oblomov-beef-veg",
    "foodru-oblomov-chashushuli",
    "foodru-oblomov-borscht",
    "foodru-oblomov-ginger-pork",
  ]) {
    assert.doesNotMatch(recipe(recipeId).steps.join(" "), /курица должна/iu);
  }
});

test("pepper gravy pair has a complete measured sauce and per-serving macros", () => {
  const expectations = {
    "foodru-oblomov-pepper-beef": { kcal: 409, protein: 43.4, fat: 18.2, carbs: 19.4 },
    "foodru-oblomov-pepper-chicken": { kcal: 375, protein: 47.6, fat: 10.9, carbs: 19.4 },
  };
  for (const [recipeId, macros] of Object.entries(expectations)) {
    const item = recipe(recipeId);
    assert.deepEqual(item.macros, macros);
    assert.equal(item.ingredients.find((ingredient) => ingredient.name === "Вода")?.grams, 250);
    assert.equal(item.ingredients.find((ingredient) => ingredient.name === "Чёрный перец горошком")?.grams, 1.3);
    assert.match(item.steps.join(" "), /250 мл воды/iu);
  }
  assert.doesNotMatch(recipe("foodru-oblomov-pepper-beef").steps.join(" "), /куриц/iu);
});

test("resolution generator is idempotent and every review image is local", async () => {
  assert.deepEqual(applyResolutions(recipes), recipes);
  assert.equal(renderResolvedReview(html), html);
  await Promise.all(
    recipes.map((item) => access(new URL(`../public${item.image}`, import.meta.url))),
  );
});
