import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateNutritionHistory } from "../scripts/migrate-nutrition-history.mjs";

const actual = { kcal: 510, protein: 42, fat: 18, carbs: 39 };
const occurrence = "person-1:2026-09-08:lunch";

function plan(overrides = {}) {
  return {
    people: [{ id: "person-1", includedSlots: ["lunch"] }],
    batches: [{ id: "batch-1", start: "2026-09-08", end: "2026-09-08", days: 1 }],
    selections: { "batch-1:lunch": "old-recipe" },
    mealExecution: { eaten: [occurrence] },
    ...overrides,
  };
}

function withDb(t, rows) {
  const directory = mkdtempSync(join(tmpdir(), "mise-history-migration-"));
  const db = new DatabaseSync(join(directory, "plans.sqlite"));
  db.exec("CREATE TABLE meal_plans (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO meal_plans (id, payload) VALUES (?, ?)");
  rows.forEach(([id, payload]) => insert.run(id, payload));
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return db;
}

const evaluator = ({ recipeId }) => ({ ...actual, kcal: recipeId === "old-recipe" ? 510 : 1 });
const read = (db, id) => JSON.parse(db.prepare("SELECT payload FROM meal_plans WHERE id = ?").get(id).payload);

test("dry run calculates legacy snapshots without changing SQLite", (t) => {
  const db = withDb(t, [["one", JSON.stringify(plan())]]);
  const result = migrateNutritionHistory({ db, evaluator, dryRun: true, capturedAt: 123 });
  assert.deepEqual(result, { changed: 1, skipped: 0, failed: 0 });
  assert.equal(read(db, "one").nutritionHistory, undefined);
});

test("apply writes a v2 legacy snapshot once and remains idempotent", (t) => {
  const db = withDb(t, [["one", JSON.stringify(plan())]]);
  assert.deepEqual(migrateNutritionHistory({ db, evaluator, dryRun: false, capturedAt: 123 }), {
    changed: 1, skipped: 0, failed: 0,
  });
  assert.deepEqual(read(db, "one").nutritionHistory, {
    [occurrence]: { recipeId: "old-recipe", actual, capturedAt: 123, calculationVersion: 2 },
  });
  assert.deepEqual(migrateNutritionHistory({ db, evaluator, dryRun: false, capturedAt: 999 }), {
    changed: 0, skipped: 1, failed: 0,
  });
  assert.equal(read(db, "one").nutritionHistory[occurrence].capturedAt, 123);
});

test("leaves malformed payloads, empty execution, and existing history unchanged", (t) => {
  const existing = { [occurrence]: { recipeId: "another", actual, capturedAt: 1, calculationVersion: 2 } };
  const db = withDb(t, [
    ["bad", "{not json"],
    ["empty", JSON.stringify(plan({ mealExecution: { eaten: [] } }))],
    ["existing", JSON.stringify(plan({ nutritionHistory: existing }))],
  ]);
  assert.deepEqual(migrateNutritionHistory({ db, evaluator, dryRun: false, capturedAt: 123 }), {
    changed: 0, skipped: 1, failed: 2,
  });
  assert.deepEqual(read(db, "existing").nutritionHistory, existing);
});

test("verify reports missing or mismatched recipe snapshots without writing", (t) => {
  const db = withDb(t, [["one", JSON.stringify(plan({ nutritionHistory: {
    [occurrence]: { recipeId: "new-recipe", actual, capturedAt: 1, calculationVersion: 2 },
  } }))]]);
  assert.deepEqual(migrateNutritionHistory({ db, evaluator, verify: true, capturedAt: 123 }), {
    changed: 0, skipped: 0, failed: 1,
  });
  assert.equal(read(db, "one").nutritionHistory[occurrence].recipeId, "new-recipe");
});

const invalidOccurrences = [
  ["malformed key", { mealExecution: { eaten: [occurrence, "broken"] } }],
  ["non-string key", { mealExecution: { eaten: [occurrence, null] } }],
  ["malformed eaten list", { mealExecution: { eaten: occurrence } }],
  ["missing person", { mealExecution: { eaten: ["missing:2026-09-08:lunch"] } }],
  ["invalid date", { mealExecution: { eaten: ["person-1:2026-02-30:lunch"] } }],
  ["day outside batch", { mealExecution: { eaten: ["person-1:2026-09-09:lunch"] } }],
  ["unknown slot", { mealExecution: { eaten: ["person-1:2026-09-08:supper"] } }],
  ["excluded person slot", { mealExecution: { eaten: ["person-1:2026-09-08:dinner"] } }],
  ["excluded plan slot", { mealSlots: ["dinner"] }],
  ["missing assignment", { selections: {} }],
  ["unassigned person", { selections: {}, selectionAssignments: { "batch-1:lunch": [{ recipeId: "old-recipe", personIds: ["missing"] }] } }],
  ["invalid existing snapshot", { nutritionHistory: { [occurrence]: { recipeId: "old-recipe", actual, calculationVersion: 2 } } }],
];
for (const [label, overrides] of invalidOccurrences) {
  for (const [mode, options] of [["dry-run", { dryRun: true }], ["apply", {}], ["verify", { verify: true }]]) {
    test(`${mode} rejects ${label} without modifying any payload`, (t) => {
      const payload = JSON.stringify(plan(overrides));
      const good = JSON.stringify(plan({ nutritionHistory: {
        [occurrence]: { recipeId: "old-recipe", actual, capturedAt: 123, calculationVersion: 2 },
      } }));
      const db = withDb(t, [["good", good], ["bad", payload]]);
      const before = db.prepare("SELECT * FROM meal_plans ORDER BY id").all();
      const result = migrateNutritionHistory({ db, evaluator, ...options, capturedAt: 123 });
      assert.ok(result.failed > 0);
      assert.deepEqual(db.prepare("SELECT * FROM meal_plans ORDER BY id").all(), before);
    });
  }
}

test("apply rolls back earlier valid rows when a later occurrence fails", (t) => {
  const db = withDb(t, [["first", JSON.stringify(plan())], ["bad", JSON.stringify(plan({ selections: {} }))]]);
  const before = db.prepare("SELECT * FROM meal_plans ORDER BY id").all();
  assert.deepEqual(migrateNutritionHistory({ db, evaluator }), { changed: 0, skipped: 0, failed: 1 });
  assert.deepEqual(db.prepare("SELECT * FROM meal_plans ORDER BY id").all(), before);
});

test("duplicate eaten occurrences require only one verified snapshot", (t) => {
  const db = withDb(t, [["one", JSON.stringify(plan({ mealExecution: { eaten: [occurrence, occurrence] } }))]]);
  let evaluations = 0;
  const evaluate = source => { evaluations++; return evaluator(source); };
  assert.deepEqual(migrateNutritionHistory({ db, evaluator: evaluate }), { changed: 1, skipped: 0, failed: 0 });
  assert.equal(evaluations, 1);
  assert.deepEqual(migrateNutritionHistory({ db, evaluator: evaluate, verify: true }), { changed: 0, skipped: 1, failed: 0 });
});

test("verify rejects a missing snapshot for a resolvable eaten occurrence", (t) => {
  const payload = JSON.stringify(plan());
  const db = withDb(t, [["one", payload]]);
  assert.deepEqual(migrateNutritionHistory({ db, evaluator, verify: true }), { changed: 0, skipped: 0, failed: 1 });
  assert.equal(db.prepare("SELECT payload FROM meal_plans").get().payload, payload);
});

for (const [mode, options] of [["dry-run", { dryRun: true }], ["apply", {}], ["verify", { verify: true }]]) {
  test(`${mode} rejects an unavailable legacy recipe without writing`, (t) => {
    const payload = JSON.stringify(plan({ selections: { "batch-1:lunch": "missing-recipe" } }));
    const db = withDb(t, [["one", payload]]);
    const unavailable = () => { throw new Error("legacy portion is unavailable"); };
    assert.deepEqual(migrateNutritionHistory({ db, evaluator: unavailable, ...options }), { changed: 0, skipped: 0, failed: 1 });
    assert.equal(db.prepare("SELECT payload FROM meal_plans").get().payload, payload);
  });
}
