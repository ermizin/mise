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
    changed: 0, skipped: 2, failed: 1,
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
