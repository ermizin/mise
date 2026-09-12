import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import manifest from "../data/cooking-operations.json" with { type: "json" };

test("reviewed cooking manifest validates against the runtime recipe source", () => {
  assert.match(execFileSync(process.execPath, ["scripts/validate-cooking-operations.mjs"], { encoding: "utf8" }), /validated 3/);
});

test("pilot entries retain an explicit trace for every mapped ingredient and a raw-meat wash", () => {
  for (const recipe of manifest.recipes) {
    assert.ok(recipe.ingredientTrace.length);
    assert.ok(recipe.reviewEvidence.length);
  }
  const rawRecipe = manifest.recipes.find((recipe) => recipe.operations.some((operation) => operation.rawMeat));
  assert.ok(rawRecipe.operations.some((operation) => operation.kind === "wash"));
});
