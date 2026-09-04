import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { validatePlanForPersistence } = await loadTypeScriptModule(
  new URL("../lib/plan-validation.ts", import.meta.url),
);

function validPlan() {
  return {
    id: "plan-1", start: "2026-09-01", end: "2026-09-01", periodDays: 1, cookEveryDays: 1,
    menuStyle: "protein", mealSlots: ["lunch"],
    people: [{ id: "person-1", name: "Alex", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch"] }],
    batches: [{ id: "batch-1", index: 0, start: "2026-09-01", end: "2026-09-01", days: 1 }],
    selections: { "batch-1:lunch": "tmpm-28584" },
    selectionAssignments: { "batch-1:lunch": [{ recipeId: "tmpm-28584", personIds: ["person-1"] }] },
    shopping: [],
  };
}

test("legacy selection-only plans retain their all-eaters fallback", () => {
  const plan = validPlan();
  delete plan.selectionAssignments;
  assert.equal(JSON.stringify(validatePlanForPersistence(plan)), JSON.stringify({ valid: true }));
});

test("persistence rejects incomplete assignment coverage", () => {
  const plan = validPlan();
  plan.selections = {};
  plan.selectionAssignments = {};
  assert.equal(JSON.stringify(validatePlanForPersistence(plan)), JSON.stringify({
    valid: false, error: "plan has incomplete recipe assignments", status: 422,
  }));
});

test("explicit assignments are saved only when complete, unique, and valid", () => {
  const incomplete = validPlan();
  incomplete.people.push({ id: "person-2", name: "Sam", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch"] });
  assert.equal(validatePlanForPersistence(incomplete).error, "plan has incomplete recipe assignments");

  const duplicate = validPlan();
  duplicate.selectionAssignments["batch-1:lunch"][0].personIds = ["person-1", "person-1"];
  assert.equal(validatePlanForPersistence(duplicate).error, "plan has invalid recipe assignments");

  const duplicateRecipe = validPlan();
  duplicateRecipe.selectionAssignments["batch-1:lunch"].push({ recipeId: "tmpm-28584", personIds: ["person-1"] });
  assert.equal(validatePlanForPersistence(duplicateRecipe).error, "plan has invalid recipe assignments");

  const malformed = validPlan();
  malformed.selectionAssignments["batch-1:lunch"] = [{ recipeId: "removed-recipe", personIds: ["person-1"] }];
  assert.equal(validatePlanForPersistence(malformed).error, "plan references an unavailable recipe");
});

test("a shorter final cooking batch remains valid", () => {
  const plan = validPlan();
  plan.end = "2026-09-03";
  plan.periodDays = 3;
  plan.cookEveryDays = 2;
  plan.batches = [
    { id: "batch-1", index: 0, start: "2026-09-01", end: "2026-09-02", days: 2 },
    { id: "batch-2", index: 1, start: "2026-09-03", end: "2026-09-03", days: 1 },
  ];
  plan.selections["batch-1:lunch"] = "tmpm-28584";
  plan.selectionAssignments["batch-1:lunch"][0].recipeId = "tmpm-28584";
  plan.selections["batch-2:lunch"] = "tmpm-28584";
  plan.selectionAssignments["batch-2:lunch"] = [{ recipeId: "tmpm-28584", personIds: ["person-1"] }];
  assert.equal(validatePlanForPersistence(plan).valid, true);
});

test("persistence repeats hard exclusion checks for effective assignments", () => {
  const plan = validPlan();
  plan.people[0].hardExclusions = ["fish"];
  plan.selections["batch-1:lunch"] = "goodfood-tuna-pasta-bake";
  plan.selectionAssignments["batch-1:lunch"][0].recipeId = "goodfood-tuna-pasta-bake";
  assert.equal(JSON.stringify(validatePlanForPersistence(plan)), JSON.stringify({
    valid: false, error: "plan violates a hard exclusion", status: 422,
  }));
});

test("persistence rejects unavailable, wrong-slot, and unsafe storage selections", () => {
  const unavailable = validPlan();
  unavailable.selections["batch-1:lunch"] = "src-taco-mac";
  assert.equal(validatePlanForPersistence(unavailable).status, 422);

  const wrongSlot = validPlan();
  wrongSlot.selections["batch-1:lunch"] = "tmpm-28584";
  wrongSlot.selectionAssignments["batch-1:lunch"][0].recipeId = "tmpm-28584";
  wrongSlot.mealSlots = ["breakfast"];
  wrongSlot.people[0].includedSlots = ["breakfast"];
  wrongSlot.selections = { "batch-1:breakfast": "tmpm-28584" };
  wrongSlot.selectionAssignments = { "batch-1:breakfast": [{ recipeId: "tmpm-28584", personIds: ["person-1"] }] };
  assert.equal(validatePlanForPersistence(wrongSlot).status, 422);

  const storage = validPlan();
  storage.start = "2026-09-01";
  storage.end = "2026-09-04";
  storage.periodDays = 4;
  storage.cookEveryDays = 4;
  storage.batches[0].end = "2026-09-04";
  storage.batches[0].days = 4;
  storage.selections["batch-1:lunch"] = "goodfood-tuna-pasta-bake";
  storage.selectionAssignments["batch-1:lunch"][0].recipeId = "goodfood-tuna-pasta-bake";
  assert.equal(validatePlanForPersistence(storage).status, 422);
});
