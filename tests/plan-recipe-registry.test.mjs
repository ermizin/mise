import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanRecipeRegistry } from "../scripts/build-plan-recipe-registry.mjs";

const checkedIn = JSON.parse(
  await readFile(new URL("../data/plan-recipe-registry.json", import.meta.url), "utf8"),
);
const simpleSource = JSON.parse(
  await readFile(new URL("../data/simple-recipes.json", import.meta.url), "utf8"),
);

test("server recipe registry exactly follows the client production predicate", async () => {
  const rebuilt = await buildPlanRecipeRegistry();
  assert.equal(JSON.stringify(checkedIn), JSON.stringify(rebuilt));
  assert.equal(checkedIn.recipeCount, 260);
  assert.equal(checkedIn.recipes.length, checkedIn.recipeCount);
  const sourceSimpleIds = new Set(simpleSource.recipes.map((recipe) => recipe.id));
  const registrySimpleIds = checkedIn.recipes
    .map((recipe) => recipe.id)
    .filter((id) => sourceSimpleIds.has(id));
  assert.equal(sourceSimpleIds.size, 50, "simple source contains fifty recipes");
  assert.equal(registrySimpleIds.length, 50, "registry includes every simple recipe");
  assert.equal(
    checkedIn.recipes.some((recipe) => recipe.id === "src-taco-mac"),
    false,
    "review-required legacy cards cannot be saved through the server",
  );
});
