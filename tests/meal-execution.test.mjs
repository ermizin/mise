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
    moves: [],
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
    { eaten: [], moves: [] },
  );
});

test("normalization rejects invalid and duplicate execution records", () => {
  const validMove = {
    id: "move-1",
    ...base,
    fromDate: base.date,
    toDate: "2026-08-03",
    recipeId: "chicken",
    sourceBatchId: "first",
    createdAt: "2026-08-01T10:00:00.000Z",
  };
  const normalized = execution.normalizeMealExecution(plan, {
    eaten: [key, key, "me:2026-08-33:lunch", "unknown:2026-08-02:lunch"],
    moves: [
      validMove,
      { ...validMove, id: "move-2" },
      { ...validMove, id: "move-3", toDate: "2026-08-02" },
      { ...validMove, id: "move-4", recipeId: "wrong" },
    ],
  });
  assert.deepEqual(plain(normalized.eaten), []);
  assert.equal(normalized.moves.length, 1);
  assert.equal(normalized.moves[0].id, "move-1");
});

test("moving an eaten base portion transfers its state to the move", () => {
  const moved = execution.moveOccurrence(
    plan,
    { eaten: [key], moves: [] },
    {
      kind: "base",
      id: "move-1",
      ...base,
      toDate: "2026-08-03",
      createdAt: "2026-08-01T10:00:00.000Z",
    },
  );
  assert.deepEqual(plain(moved.eaten), []);
  assert.deepEqual(plain(moved.moves), [
    {
      id: "move-1",
      personId: "me",
      fromDate: "2026-08-02",
      toDate: "2026-08-03",
      slot: "lunch",
      recipeId: "chicken",
      sourceBatchId: "first",
      createdAt: "2026-08-01T10:00:00.000Z",
      wasEaten: true,
    },
  ]);
  assert.deepEqual(plain(execution.toggleBaseEaten(plan, moved, base)), plain(moved));
});

test("a personal slot resolves the recipe assigned to that person", () => {
  const personalPlan = {
    ...plan,
    selectionAssignments: {
      "first:lunch": [
        { recipeId: "chicken", personIds: ["me"] },
        { recipeId: "tofu", personIds: ["sasha"] },
      ],
    },
  };
  const moved = execution.moveOccurrence(personalPlan, undefined, {
    kind: "base",
    id: "personal-move",
    personId: "sasha",
    date: "2026-08-02",
    slot: "lunch",
    toDate: "2026-08-03",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(moved.moves.length, 1);
  assert.equal(moved.moves[0].recipeId, "tofu");
  assert.equal(moved.moves[0].sourceBatchId, "first");
});

test("an interrupted assignments rollout keeps the legacy recipe", () => {
  const transitionalPlan = {
    ...plan,
    selectionAssignments: { "first:lunch": [] },
  };
  const moved = execution.moveOccurrence(transitionalPlan, undefined, {
    kind: "base",
    id: "legacy-fallback",
    ...base,
    toDate: "2026-08-03",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(moved.moves.length, 1);
  assert.equal(moved.moves[0].recipeId, "chicken");
});

test("retargeting an existing move changes only its target, and moved eating is reversible", () => {
  const moved = execution.moveOccurrence(plan, undefined, {
    kind: "base",
    id: "move-1",
    ...base,
    toDate: "2026-08-03",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  const retargeted = execution.moveOccurrence(plan, moved, {
    kind: "moved",
    id: "move-1",
    toDate: "2026-08-06",
  });
  assert.equal(retargeted.moves[0].toDate, "2026-08-06");
  assert.equal(retargeted.moves[0].fromDate, "2026-08-02");
  assert.equal(retargeted.moves[0].recipeId, "chicken");
  const eaten = execution.toggleMovedEaten(plan, retargeted, "move-1");
  assert.equal(eaten.moves[0].wasEaten, true);
  assert.equal(execution.toggleMovedEaten(plan, eaten, "move-1").moves[0].wasEaten, false);
});

test("moves must target a later date inside the plan and reconcile after plan changes", () => {
  const untouched = execution.moveOccurrence(plan, undefined, {
    kind: "base",
    id: "bad",
    ...base,
    toDate: "2026-08-02",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  assert.deepEqual(plain(untouched), { eaten: [], moves: [] });
  const moved = execution.moveOccurrence(plan, undefined, {
    kind: "base",
    id: "move-1",
    ...base,
    toDate: "2026-08-03",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  const shorterPlan = { ...plan, end: "2026-08-02", batches: [{ id: "first", start: "2026-08-01", end: "2026-08-02" }] };
  assert.deepEqual(plain(execution.reconcileMealExecution(shorterPlan, moved)), {
    eaten: [],
    moves: [],
  });
});

test("storage policy rejects unsafe non-freezable moves, prunes persisted ones and permits freezable recipes", () => {
  const withStorage = {
    ...plan,
    recipeStorage: {
      chicken: { storageDays: 2, freezable: false },
      turkey: { storageDays: 2, freezable: true },
    },
  };
  const unsafe = execution.moveOccurrence(withStorage, undefined, {
    kind: "base",
    id: "unsafe",
    ...base,
    toDate: "2026-08-03",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  assert.deepEqual(plain(unsafe), { eaten: [], moves: [] });
  assert.deepEqual(
    plain(execution.normalizeMealExecution(withStorage, {
      eaten: [],
      moves: [{
        id: "persisted-unsafe",
        personId: "me",
        fromDate: "2026-08-02",
        toDate: "2026-08-03",
        slot: "lunch",
        recipeId: "chicken",
        sourceBatchId: "first",
        createdAt: "2026-08-01T10:00:00.000Z",
      }],
    })),
    { eaten: [], moves: [] },
  );
  const freezable = execution.moveOccurrence(withStorage, undefined, {
    kind: "base",
    id: "freezable",
    personId: "me",
    date: "2026-08-04",
    slot: "lunch",
    toDate: "2026-08-07",
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(freezable.moves.length, 1);
  assert.equal(freezable.moves[0].recipeId, "turkey");
});
