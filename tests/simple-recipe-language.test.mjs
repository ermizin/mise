import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = JSON.parse(
  await readFile(new URL("../data/simple-recipes.json", import.meta.url), "utf8"),
);
const allSteps = source.recipes.flatMap((recipe) => recipe.steps);

test("simple recipe instructions keep calculated-amount phrases grammatically complete", () => {
  const invalidPhrases = [
    "с рассчитанное количество",
    "в рассчитанное количество",
    "булгура рассчитанное количество воды",
  ];

  for (const phrase of invalidPhrases) {
    assert.ok(!allSteps.some((step) => step.includes(phrase)), `no instruction contains: ${phrase}`);
  }

  assert.ok(
    source.recipes.find((recipe) => recipe.id === "simple-parsed-main-chicken-vegetables-bulgur")
      .steps[0]
      .includes("булгура рассчитанным количеством воды"),
  );
});
