import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertRuntimeCatalogMinimum,
  buildRecipeRuntimeCatalog,
} from "../scripts/build-recipe-runtime-catalog.mjs";

const catalog = await buildRecipeRuntimeCatalog();

test("runtime projection is complete for every recipe it admits", () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.constraints.mediaRequired, "verified_local_source_image");
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
    assert.equal(recipe.provenance.preview.kind, "source_preview");
    assert.match(recipe.provenance.preview.imageUrl, /^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u);
    assert.match(recipe.provenance.preview.sourceImageUrl, /^https:\/\//u);
    assert.equal(recipe.provenance.preview.usage, "local-source-copy-with-attribution");
    assert.ok(recipe.provenance.preview.attribution);
    assert.match(recipe.provenance.preview.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(recipe.visualFallback.emoji);
    assert.ok(recipe.recipeFamily, "an audited RecipeFamily is a runtime gate");
    assert.equal(recipe.recipeFamily.image.imageUrl, recipe.provenance.preview.imageUrl);
    assert.equal(recipe.effort.parallelProcesses, 1, "the current card is an honest one-cook sequence");
    assert.ok([1, 2, 3].includes(recipe.effort.difficulty));
    const expectedDifficulty =
      recipe.effort.activeMinutes <= 15 && recipe.effort.cookware <= 1
        ? 1
        : recipe.effort.activeMinutes <= 30 && recipe.effort.cookware <= 3
          ? 2
          : 3;
    assert.equal(recipe.effort.difficulty, expectedDifficulty);
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

test("cheese and pasta stay in grams while liquid broth uses millilitres", () => {
  const expectedUnits = new Map([
    ["cheese_processed", "g"],
    ["parmesan_processed", "g"],
    ["pasta_raw", "g"],
    ["broth_processed", "ml"],
    ["vegetable_broth_processed", "ml"],
  ]);
  for (const recipe of catalog.recipes) {
    for (const ingredient of recipe.shoppingIngredients) {
      const expectedUnit = expectedUnits.get(ingredient.canonicalIngredientId);
      if (!expectedUnit) continue;
      const familyIngredient = recipe.recipeFamily.ingredients.find(
        (item) => item.sourceIngredientId === ingredient.sourceIngredientId,
      );
      assert.equal(familyIngredient?.unit, expectedUnit, `${recipe.id}: ${ingredient.nameRu}`);
      assert.equal(ingredient.averagePieceWeightGrams, undefined, `${recipe.id}: no fake piece mass`);
      assert.equal(ingredient.pieceEstimate, undefined, `${recipe.id}: no fake piece estimate`);
    }
  }
});

test("owner product decisions are visible in production recipe ingredients", () => {
  for (const id of ["tmpm-28247", "tmpm-22884"]) {
    const recipe = catalog.recipes.find((item) => item.id === id);
    assert.ok(recipe, `${id} remains in the runtime catalog`);
    assert.ok(recipe.shoppingIngredients.some((ingredient) => ingredient.canonicalIngredientId === "mirin_processed" && /3:1/u.test(ingredient.nameRu)));
    assert.ok(recipe.steps.some((step) => /несколько капель рисового уксуса/iu.test(step)));
  }
  const waffle = catalog.recipes.find((item) => item.id === "tmpm-26414");
  assert.ok(waffle);
  assert.ok(waffle.shoppingIngredients.some((ingredient) => /12,5 г сывороточного протеина.*12,5 г казеина.*20 г овсяной муки.*10 г кукурузного крахмала.*1 г разрыхлителя/iu.test(ingredient.nameRu)));
  assert.ok(waffle.steps.some((step) => /заранее смешайте 12,5 г сывороточного протеина/iu.test(step)));
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

test("every release build refreshes the audited wizard catalog", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const refreshCommand =
    "node scripts/build-recipe-runtime-catalog.mjs --output data/recipe-runtime-catalog.json --require-minimum 200";
  assert.equal(packageJson.scripts.prebuild, refreshCommand);
  assert.equal(packageJson.scripts["recipes:runtime:refresh"], refreshCommand);
});
