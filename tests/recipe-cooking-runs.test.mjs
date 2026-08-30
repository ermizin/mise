import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { planRecipeCookingRuns, pooledCookingFatShare } = await loadTypeScriptModule(
  new URL("../domain/recipe-cooking-runs.ts", import.meta.url),
);

const family = (geometryLockedMax) => ({
  geometryLockedMax,
  ingredients: [
    { sourceIngredientId: "protein", baseAmount: 100, role: "protein" },
    { sourceIngredientId: "carb", baseAmount: 50, role: "carb" },
    { sourceIngredientId: "oil", baseAmount: 8, role: "fat_cooking" },
  ],
});

const portion = (id, protein = 100, carb = 50) => ({
  id,
  amounts: { protein, carb, oil: 999 },
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("an unconstrained family keeps one physical run across all requested days", () => {
  const result = planRecipeCookingRuns(family(undefined), [portion("alex"), portion("sam")], 3);
  assert.equal(result.viable, true);
  assert.equal(result.runCount, 1);
  assert.deepEqual(plain(result.runs[0].portions.map(({ day, id }) => [day, id])), [
    [0, "alex"], [0, "sam"], [1, "alex"], [1, "sam"], [2, "alex"], [2, "sam"],
  ]);
  assert.deepEqual(plain(result.totals), { protein: 600, carb: 300, oil: 8 });
});

test("a five-serving cap splits six base servings into two runs", () => {
  const result = planRecipeCookingRuns(family(5), Array.from({ length: 6 }, (_, index) => portion(`p${index}`)), 1);
  assert.equal(result.viable, true);
  assert.equal(result.runCount, 2);
  assert.equal(result.runs[0].portions.length, 5);
  assert.equal(result.runs[1].portions.length, 1);
  assert.deepEqual(plain(result.runs.map((run) => run.totals.protein)), [500, 100]);
});

test("a pooled 5+1 split promises exactly the fat used by both runs", () => {
  const result = planRecipeCookingRuns(
    family(5),
    Array.from({ length: 6 }, (_, index) => portion(`p${index}`)),
    1,
  );
  const perContainerFat =
    family(5).ingredients.find((ingredient) => ingredient.role === "fat_cooking").baseAmount *
    pooledCookingFatShare(result.runCount, 6);
  assert.equal(result.runCount, 2);
  assert.equal(perContainerFat * 6, result.totals.oil);
});

test("packing is stable day-major then person-major", () => {
  const result = planRecipeCookingRuns(family(2), [portion("alex"), portion("sam")], 3);
  assert.deepEqual(plain(result.runs.map((run) => run.portions.map(({ day, id }) => `${day}:${id}`))), [
    ["0:alex", "0:sam"], ["1:alex", "1:sam"], ["2:alex", "2:sam"],
  ]);
});

test("cooking fat is counted once for every physical run and totals are their sum", () => {
  const result = planRecipeCookingRuns(family(2), [portion("alex"), portion("sam")], 3);
  assert.equal(result.runCount, 3);
  assert.deepEqual(plain(result.runs.map((run) => run.totals.oil)), [8, 8, 8]);
  assert.deepEqual(plain(result.totals), { protein: 600, carb: 300, oil: 24 });
  assert.deepEqual(
    plain(result.totals),
    result.runs.reduce((total, run) => {
      for (const [id, amount] of Object.entries(run.totals)) total[id] = (total[id] ?? 0) + amount;
      return total;
    }, {}),
  );
});

test("one oversize serving is rejected rather than overflowing a cookware cap", () => {
  const result = planRecipeCookingRuns(family(5), [portion("alex", 501)], 1);
  assert.equal(result.viable, false);
  assert.equal(result.reason, "geometry_capacity_exceeded");
  assert.deepEqual(plain(result.runs), []);
  assert.deepEqual(plain(result.totals), {});
});
