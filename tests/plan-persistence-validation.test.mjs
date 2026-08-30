import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const runtimeCatalog = JSON.parse(
  await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
);
const activeRuntimeRecipes = runtimeCatalog.recipes.filter(
  (recipe) =>
    recipe.recipeFamily.reviewStatus === "pilot" &&
    recipe.recipeFamily.ingredients.length >= 3,
);

function validPlan() {
  return {
    id: "plan-1", start: "2026-08-29", end: "2026-09-01", periodDays: 4, cookEveryDays: 2,
    menuStyle: "protein", mealSlots: ["lunch"],
    people: [{ id: "person-1", name: "Alex", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch"] }],
    batches: [{ id: "batch-1", index: 0, start: "2026-08-29", end: "2026-08-30", days: 2 }],
    selections: { "batch-1:lunch": "tmpm-28584" },
    selectionAssignments: { "batch-1:lunch": [{ recipeId: "tmpm-28584", personIds: ["person-1"] }] },
    shopping: [],
  };
}

test("plan persistence accepts the current audited recipe references", () => {
  assert.equal(validatePlanForPersistence(validPlan()).valid, true);
  for (const recipe of activeRuntimeRecipes) {
    const plan = validPlan();
    plan.selections["batch-1:lunch"] = recipe.id;
    plan.selectionAssignments["batch-1:lunch"][0].recipeId = recipe.id;
    assert.equal(validatePlanForPersistence(plan).valid, true, recipe.id);
  }
});

test("plan persistence enforces the product calorie range and linked macros", () => {
  for (const daily of [
    { kcal: 0, protein: -1, fat: -1, carbs: -1 },
    { kcal: 1199, protein: 90, fat: 50, carbs: 97 },
    { kcal: 5001, protein: 200, fat: 120, carbs: 780 },
    { kcal: 2000, protein: 500, fat: 300, carbs: 0 },
  ]) {
    const plan = validPlan();
    plan.people[0].daily = daily;
    const result = validatePlanForPersistence(plan);
    assert.equal(result.valid, false, JSON.stringify(daily));
    assert.equal(result.error, "plan has an invalid person");
  }

  const linked = validPlan();
  linked.people[0].daily = { kcal: 4700, protein: 500, fat: 300, carbs: 0 };
  assert.equal(validatePlanForPersistence(linked).valid, true);
});

test("plan persistence rejects malformed plans before they reach D1", () => {
  const plan = validPlan();
  plan.people[0].includedSlots = ["second-breakfast"];
  const result = validatePlanForPersistence(plan);
  assert.equal(result.valid, false);
  assert.equal(result.error, "plan has an invalid person");
  assert.equal(result.status, 400);
});

test("plan persistence rejects obsolete recipes in selections and assignments", () => {
  const selected = validPlan();
  selected.selections["batch-1:lunch"] = "removed-recipe";
  const selectedResult = validatePlanForPersistence(selected);
  assert.equal(selectedResult.valid, false);
  assert.equal(selectedResult.error, "plan references an unavailable recipe");
  assert.equal(selectedResult.status, 422);

  const assigned = validPlan();
  assigned.selectionAssignments["batch-1:lunch"][0].recipeId = "removed-recipe";
  const assignedResult = validatePlanForPersistence(assigned);
  assert.equal(assignedResult.valid, false);
  assert.equal(assignedResult.error, "plan references an unavailable recipe");
  assert.equal(assignedResult.status, 422);
});

test("the plans API validates before serializing or writing", async () => {
  const route = await readFile(new URL("../app/api/plans/route.ts", import.meta.url), "utf8");
  assert.match(route, /validatePlanForPersistence\(body\.plan\)/);
  assert.match(route, /error: "invalid JSON".*status: 400/s);
  assert.match(route, /if \(!validation\.valid\) return Response\.json\(\{ error: validation\.error \}, \{ status: validation\.status \}\)/);
});
