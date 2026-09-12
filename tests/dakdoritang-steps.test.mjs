import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(
  await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
);
const recipe = catalog.recipes.find((item) => item.id === "tmpm-18557");

test("dakdoritang has a complete, ordered cooking procedure", () => {
  assert.ok(recipe, "dakdoritang remains in the runtime catalog");
  assert.equal(recipe.title, "Корейское куриное рагу дакдоритан");
  assert.ok(recipe.instructions.length >= 9, "the recipe is not collapsed into one paragraph");

  const procedure = recipe.instructions.map((step) => step.text).join(" ");
  const checkpoints = [
    /Нарежьте сельдерей/u,
    /смешайте соевый соус/u,
    /обжаривайте 5–7 минут/u,
    /подрумянивайте 3–4 минуты/u,
    /томите рагу.*20 минут/u,
    /Проверьте мягкость картофеля/u,
    /Разложите готовый рис и рагу/u,
  ];
  let cursor = -1;
  for (const checkpoint of checkpoints) {
    const next = procedure.search(checkpoint);
    assert.ok(next > cursor, `${checkpoint} appears in cooking order`);
    cursor = next;
  }

  assert.ok(recipe.instructions.some((step) => step.minutes === 20 && !step.hands));
  assert.ok(recipe.instructions.every((step, index) => index === 0 || step.at >= recipe.instructions[index - 1].at));
});

test("dakdoritang Mise steps retain dependencies and ingredient links", () => {
  const steps = recipe.recipeFamily.miseInstructions;
  assert.ok(steps.length >= 10);
  assert.equal(steps[0].id, "step-measure");

  const earlier = new Set();
  const usedIngredients = new Set();
  for (const step of steps) {
    assert.ok(step.dependsOn.every((dependency) => earlier.has(dependency)), `${step.id} only depends on earlier steps`);
    step.ingredientIds.forEach((ingredientId) => usedIngredients.add(ingredientId));
    earlier.add(step.id);
  }
  for (let index = 1; index <= 15; index += 1) {
    assert.ok(usedIngredients.has(`source-ingredient-${index}`), `ingredient ${index} is linked to the procedure`);
  }
});
