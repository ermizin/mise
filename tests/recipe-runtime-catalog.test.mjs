import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertRuntimeCatalogMinimum,
  buildRecipeRuntimeCatalog,
} from "../scripts/build-recipe-runtime-catalog.mjs";

const catalog = await buildRecipeRuntimeCatalog();

test("runtime projection is complete for every recipe it admits", () => {
  assert.ok(catalog.recipes.length > 0, "current audit should yield some runtime recipes");
  assert.equal(new Set(catalog.recipes.map((recipe) => recipe.id)).size, catalog.recipes.length);
  for (const recipe of catalog.recipes) {
    assert.match(recipe.title, /[А-Яа-яЁё]/u);
    assert.ok(recipe.steps.length > 0);
    assert.ok(recipe.shoppingIngredients.length > 0);
    assert.ok(recipe.shoppingIngredients.every((ingredient) => ingredient.quantityGrams > 0));
    assert.ok(recipe.shoppingIngredients.every((ingredient) => ingredient.nameRu && ingredient.group));
    assert.ok(recipe.menuTags.length > 0 && recipe.menuTags.every((tag) => ["protein", "budget"].includes(tag)));
    assert.equal(recipe.costTier.basis, "relative_editorial_ingredient_complexity_not_rubles");
    assert.equal(recipe.servingMass.status, "estimated_not_verified_cooked_yield");
    assert.ok(recipe.provenance.sourceUrl);
    assert.ok(recipe.visualFallback.emoji);
    assert.ok(recipe.recipeFamily, "an audited RecipeFamily is a runtime gate");
    const familyIngredientIds = new Set(recipe.recipeFamily.ingredients.map((ingredient) => ingredient.sourceIngredientId));
    assert.ok(recipe.shoppingIngredients.every((ingredient) => familyIngredientIds.has(ingredient.sourceIngredientId)));
  }
});

test("every source ingredient is accounted for or blocks projection", () => {
  for (const recipe of catalog.recipes) {
    const accounted = new Set([
      ...recipe.shoppingIngredients.map((ingredient) => ingredient.sourceIngredientIndex),
      ...recipe.procedureIngredients.map((ingredient) => ingredient.sourceIngredientIndex),
    ]);
    const maxIndex = Math.max(...accounted);
    assert.deepEqual([...accounted].sort((a, b) => a - b), Array.from({ length: maxIndex }, (_, index) => index + 1));
  }
  assert.ok(catalog.failures.every((failure) => failure.code && failure.id));
});

test("the 200-recipe release gate is enforceable without hard-coding today's count", () => {
  if (catalog.recipes.length >= 200) {
    assert.doesNotThrow(() => assertRuntimeCatalogMinimum(catalog, 200));
  } else {
    assert.throws(() => assertRuntimeCatalogMinimum(catalog, 200), /minimum is 200/);
  }
  assert.throws(
    () => assertRuntimeCatalogMinimum({ recipes: Array.from({ length: 199 }) }, 200),
    /minimum is 200/,
  );
  assert.doesNotThrow(() => assertRuntimeCatalogMinimum({ recipes: Array.from({ length: 200 }) }, 200));
});

test("checked-in runtime catalog is the exact hard-gated projection", async () => {
  const stored = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(stored, catalog);
  assert.ok(stored.recipes.every((recipe) => recipe.recipeFamily?.ingredients?.length));
});
