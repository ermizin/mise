import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const execution = await loadTypeScriptModule(
  new URL("../domain/meal-execution.ts", import.meta.url),
);

const plan = {
  start: "2026-08-01",
  end: "2026-08-07",
  people: [
    { id: "me", includedSlots: ["breakfast", "lunch"] },
    { id: "sasha", includedSlots: ["lunch"] },
  ],
  batches: [
    { id: "first", start: "2026-08-01", end: "2026-08-03" },
    { id: "second", start: "2026-08-04", end: "2026-08-07" },
  ],
  selections: {
    "first:breakfast": "oats",
    "first:lunch": "chicken",
    "second:breakfast": "eggs",
    "second:lunch": "turkey",
  },
};

const base = { personId: "me", date: "2026-08-02", slot: "lunch" };
const key = execution.mealOccurrenceKey(base.personId, base.date, base.slot);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("normalization gives legacy plans an empty, safe execution model", () => {
  assert.deepEqual(plain(execution.normalizeMealExecution(plan, undefined)), {
    eaten: [],
  });
  assert.equal(key, "me:2026-08-02:lunch");
});

test("base eating is valid, reversible and idempotent", () => {
  const eaten = execution.toggleBaseEaten(plan, undefined, base);
  assert.deepEqual(plain(eaten.eaten), [key]);
  assert.deepEqual(plain(execution.toggleBaseEaten(plan, eaten, base).eaten), []);
  assert.deepEqual(
    plain(execution.toggleBaseEaten(plan, undefined, {
      personId: "sasha",
      date: "2026-08-02",
      slot: "breakfast",
    })),
    { eaten: [] },
  );
});

test("normalization rejects invalid and duplicate records and drops legacy moves", () => {
  const normalized = execution.normalizeMealExecution(plan, {
    eaten: [key, key, "me:2026-08-33:lunch", "unknown:2026-08-02:lunch"],
    moves: [{ id: "legacy-move" }],
  });
  assert.deepEqual(plain(normalized), { eaten: [key] });
  assert.equal("moveOccurrence" in execution, false);
  assert.equal("toggleMovedEaten" in execution, false);
});

test("personal assignments validate a real occurrence", () => {
  const personalPlan = {
    ...plan,
    selectionAssignments: {
      "first:lunch": [
        { recipeId: "chicken", personIds: ["me"] },
        { recipeId: "tofu", personIds: ["sasha"] },
      ],
    },
  };
  const sasha = { personId: "sasha", date: "2026-08-02", slot: "lunch" };
  assert.deepEqual(
    plain(execution.toggleBaseEaten(personalPlan, undefined, sasha)),
    { eaten: ["sasha:2026-08-02:lunch"] },
  );
});

test("reconciliation prunes eaten meals removed by a plan change", () => {
  const eaten = execution.toggleBaseEaten(plan, undefined, base);
  const shorterPlan = {
    ...plan,
    end: "2026-08-01",
    batches: [{ id: "first", start: "2026-08-01", end: "2026-08-01" }],
  };
  assert.deepEqual(
    plain(execution.reconcileMealExecution(shorterPlan, eaten)),
    { eaten: [] },
  );
});
