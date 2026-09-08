import assert from "node:assert/strict";
import test from "node:test";

import { expandedInstructionDraft } from "../scripts/build-recipe-runtime-catalog.mjs";

test("runtime keeps composite editorial instructions and their source structure intact", () => {
  const steps = [
    {
      id: "editorial-step-1",
      text: "В форме смешайте овощи с соусом. Запекайте в духовке при 190°C 20 минут до золотистой корочки.",
      ingredientIds: ["source-ingredient-1", "source-ingredient-2"],
      action: "bake",
      duration: "20 мин",
      equipment: ["baking_dish", "oven"],
      dependsOn: ["editorial-step-2"],
    },
    {
      id: "editorial-step-2",
      text: "Подготовьте соус.",
      ingredientIds: ["source-ingredient-2"],
      action: "mix",
      dependsOn: [],
    },
  ];

  const result = expandedInstructionDraft(steps);

  assert.deepEqual(result, steps);
  assert.notEqual(result[0], steps[0]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "editorial-step-1");
  assert.deepEqual(result[0].dependsOn, ["editorial-step-2"]);
  assert.equal(result[0].duration, "20 мин");
  assert.deepEqual(result[0].equipment, ["baking_dish", "oven"]);
});

test("runtime does not fabricate a packing instruction for a single editorial step", () => {
  const steps = [{
    id: "editorial-step-1",
    text: "Смешайте ингредиенты и охладите.",
    ingredientIds: ["source-ingredient-1"],
    action: "chill",
    dependsOn: [],
  }];

  assert.deepEqual(expandedInstructionDraft(steps), steps);
});
