import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recipeCatalog } from "./recipe-session-fixture.mjs";

const contract = JSON.parse(
  await readFile(new URL("../data/recipe-portion-components.json", import.meta.url), "utf8"),
);
const catalog = await recipeCatalog();

test("portion component contract names only current recipes with explicit instruction evidence", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.ok(contract.recipes.length > 0 && contract.recipes.length < 30);
  assert.equal(new Set(contract.recipes.map((entry) => entry.recipeId)).size, contract.recipes.length);

  for (const entry of contract.recipes) {
    const recipe = catalog.recipesById[entry.recipeId];
    assert.ok(recipe, `${entry.recipeId}: current recipe is required`);
    assert.equal(recipe.title, entry.title);
    assert.ok(recipe.steps.some((step) => step.includes(entry.evidence)), `${entry.recipeId}: evidence must be in current instructions`);
    assert.ok(entry.components.length >= 2);
    assert.equal(new Set(entry.components.map((component) => component.id)).size, entry.components.length);

    const ingredientIds = new Set(recipe.ingredients.map((ingredient) => ingredient.id));
    const assigned = entry.components.flatMap((component) => component.ingredientIds);
    assert.ok(assigned.every((id) => ingredientIds.has(id)), `${entry.recipeId}: component uses a source ingredient id`);
    assert.equal(new Set(assigned).size, assigned.length, `${entry.recipeId}: an ingredient belongs to one physical component`);
    assert.deepEqual(new Set(assigned), ingredientIds, `${entry.recipeId}: every ingredient stays with one physical component`);
  }
});

test("the known one-pot chicken rice card is explicitly rejected from component allocation", () => {
  const rejected = contract.rejected.find((entry) => entry.recipeId === "src-chicken-rice-veg");
  assert.ok(rejected);
  const recipe = catalog.recipesById[rejected.recipeId];
  assert.ok(recipe.steps.some((step) => step.includes(rejected.evidence)));
  assert.equal(contract.recipes.some((entry) => entry.recipeId === rejected.recipeId), false);
});
