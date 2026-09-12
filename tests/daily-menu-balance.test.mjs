import assert from "node:assert/strict";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const app = await recipeCatalog();
const slots = Array.from(app.allMealSlots);
const batch = { id: "balance-batch", index: 0, start: "2026-09-10", end: "2026-09-10", days: 1 };

function person(id, daily, includedSlots) {
  return { id, name: id, daily, includedSlots, hardExclusions: [], dislikes: [] };
}

function lowestProteinRecipe(slot, eaters) {
  return app.candidateRecipes(slot, "protein", eaters, batch.days, { limit: "all" })
    .map((recipe) => ({ recipe, actual: app.recipeCookingSession(eaters, slot, recipe, batch.days).portions }))
    .filter((item) => item.actual.length === eaters.length)
    .sort((left, right) => {
      const protein = (item) => item.actual.reduce((sum, portion) => sum + portion.actual.protein, 0);
      return protein(left) - protein(right) || left.recipe.id.localeCompare(right.recipe.id);
    })[0].recipe;
}

function fullAndPartialPlan() {
  const people = [
    person("A", { kcal: 2200, protein: 180, fat: 70, carbs: 240 }, slots),
    person("B", { kcal: 1800, protein: 140, fat: 60, carbs: 195 }, ["lunch", "dinner"]),
  ];
  const selections = {};
  const selectionAssignments = {};
  for (const slot of slots) {
    const eaters = people.filter((item) => item.includedSlots.includes(slot));
    const recipe = lowestProteinRecipe(slot, eaters);
    const key = `${batch.id}:${slot}`;
    selections[key] = recipe.id;
    selectionAssignments[key] = [{ recipeId: recipe.id, personIds: eaters.map((item) => item.id) }];
  }
  const plan = {
    id: "daily-balance", start: batch.start, end: batch.end, periodDays: 1, cookEveryDays: 1,
    menuStyle: "protein", people, mealSlots: slots, batches: [batch], selections, selectionAssignments,
    shopping: [], tuning: {}, pinnedSelectionKeys: [`${batch.id}:breakfast`], cookedBatchIds: [],
    cookedWeights: {}, nutritionHistory: {}, mealExecution: { eaten: [] }, kitchenEquipment: undefined,
    recipeMethods: undefined,
  };
  plan.shopping = app.buildShopping(plan);
  return plan;
}

function deficit(summary) {
  return Math.max(0, summary.target - summary.after.protein);
}

function exactSessionMacros(plan, person) {
  return person.includedSlots.reduce((total, slot) => {
    const groups = plan.selectionAssignments[`${batch.id}:${slot}`];
    const group = groups.find((item) => item.personIds.includes(person.id));
    const eaters = plan.people.filter((item) => group.personIds.includes(item.id));
    const session = app.recipeCookingSession(eaters, slot, app.recipesById[group.recipeId], batch.days,
      (item) => plan.tuning?.[`${batch.id}:${slot}:${item.id}`]);
    const actual = session.portions[eaters.findIndex((item) => item.id === person.id)].actual;
    return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, value + actual[key]]));
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

test("balances a real five-slot menu for a full and a partial eater without moving calories between people", () => {
  const plan = fullAndPartialPlan();
  const before = structuredClone(plan);
  const first = app.proposeDailyProteinMenu(plan);
  const second = app.proposeDailyProteinMenu(plan);

  assert.ok(first.changes.length > 0, "the constructed low-protein baseline has a real released improvement");
  assert.equal(JSON.stringify(first), JSON.stringify(second), "bounded search is deterministic");
  assert.equal(JSON.stringify(plan), JSON.stringify(before), "proposal leaves the saved plan untouched");
  assert.ok(first.changes.every((change) => change.key !== `${batch.id}:breakfast`), "pinned meal stays pinned");

  for (const current of first.summaries) {
    const beforeShortfall = Math.max(0, current.target - current.before.protein);
    assert.ok(deficit(current) <= beforeShortfall + 0.000001, `${current.person.id} never loses protein progress`);
    assert.ok(current.after.kcal <= current.person.daily.kcal + 0.000001, `${current.person.id} stays under their own ceiling`);
    const exact = exactSessionMacros(first.plan, current.person);
    for (const key of ["kcal", "protein", "fat", "carbs"])
      assert.ok(Math.abs(exact[key] - current.after[key]) <= 0.000001, `${current.person.id}/${key} uses exact actual session macros`);
  }
  const a = first.summaries.find((summary) => summary.person.id === "A");
  const b = first.summaries.find((summary) => summary.person.id === "B");
  assert.ok(a.target > b.target, "B's target is only the fixed lunch+dinner share");
  assert.ok(Math.max(0, b.target - b.after.protein) <= Math.max(0, b.target - b.before.protein), "A's gain cannot conceal B's loss");
  assert.equal(JSON.stringify(first.plan.shopping), JSON.stringify(app.buildShopping(first.plan)), "shopping is regenerated from new physical sessions");
  for (const key of ["pinnedSelectionKeys", "cookedBatchIds", "cookedWeights", "nutritionHistory", "mealExecution"])
    assert.equal(JSON.stringify(first.plan[key]), JSON.stringify(before[key]), `${key} is preserved`);
});

test("recorded cooking, recorded eating, and a running batch block replacements", () => {
  const plan = fullAndPartialPlan();
  for (const locked of [
    { ...plan, cookedBatchIds: [batch.id] },
    { ...plan, nutritionHistory: { "A:2026-09-10:lunch": { recipeId: plan.selections[`${batch.id}:lunch`], actual: { kcal: 1, protein: 1, fat: 0, carbs: 0 }, capturedAt: 1, calculationVersion: 2 } } },
    { ...plan, mealExecution: { eaten: ["A:2026-09-10:lunch"] } },
  ]) {
    assert.equal(app.batchHasRecordedCooking(locked, batch), true);
    assert.equal(app.proposeDailyProteinMenu(locked).changes.length, 0);
  }
  assert.equal(app.proposeDailyProteinMenu(plan, { runningBatchIds: [batch.id] }).changes.length, 0);
});

test("daily protein assessment reads the selected occurrence date's immutable snapshot", () => {
  const recipe = app.recipesById["src-creamy-chicken-pasta"];
  const datedBatch = { ...batch, id: "dated", start: "2026-09-10", end: "2026-09-11", days: 2 };
  const plan = {
    id: "dated", people: [person("A", { kcal: 2200, protein: 150, fat: 70, carbs: 240 }, ["lunch"])], mealSlots: ["lunch"], batches: [datedBatch],
    selections: { "dated:lunch": recipe.id }, selectionAssignments: { "dated:lunch": [{ recipeId: recipe.id, personIds: ["A"] }] }, tuning: {},
    nutritionHistory: {
      "A:2026-09-10:lunch": { recipeId: recipe.id, actual: { kcal: 101, protein: 11, fat: 1, carbs: 1 }, capturedAt: 1, calculationVersion: 2 },
      "A:2026-09-11:lunch": { recipeId: recipe.id, actual: { kcal: 202, protein: 22, fat: 2, carbs: 2 }, capturedAt: 2, calculationVersion: 2 },
    },
  };
  assert.equal(app.dailyProteinAssessment(plan, datedBatch, plan.people[0], "2026-09-10").actual.protein, 11);
  assert.equal(app.dailyProteinAssessment(plan, datedBatch, plan.people[0], "2026-09-11").actual.protein, 22);
});
