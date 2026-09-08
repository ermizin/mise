import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const historyApi = await loadTypeScriptModule(
  new URL("../domain/nutrition-history.ts", import.meta.url),
);
const plain = (value) => JSON.parse(JSON.stringify(value));

const actual = { kcal: 510, protein: 42, fat: 18, carbs: 39 };
const snapshot = {
  recipeId: "chicken-rice",
  actual,
  capturedAt: 1_800_000_000_000,
  calculationVersion: 2,
};

test("normalizes only complete finite nonnegative v2 nutrition snapshots", () => {
  assert.deepEqual(plain(historyApi.normalizeNutritionHistory({ lunch: snapshot })), {
    lunch: snapshot,
  });
  assert.deepEqual(plain(historyApi.normalizeNutritionHistory({
    lunch: snapshot,
    badCalories: { ...snapshot, actual: { ...actual, kcal: -1 } },
    oldVersion: { ...snapshot, calculationVersion: 1 },
    malformed: null,
  })), { lunch: snapshot });
});

test("preserves the first snapshot immutably and never overwrites historical nutrition", () => {
  const initial = { lunch: snapshot };
  const next = historyApi.preserveNutritionSnapshot(
    initial,
    "lunch",
    "replacement-recipe",
    { kcal: 1, protein: 1, fat: 1, carbs: 1 },
    1_900_000_000_000,
  );
  assert.notEqual(next, initial);
  assert.deepEqual(plain(next), initial);

  const inserted = historyApi.preserveNutritionSnapshot({}, "dinner", "fish", actual, snapshot.capturedAt);
  assert.deepEqual(plain(inserted.dinner), { ...snapshot, recipeId: "fish" });
});

test("rejects invalid captures without adding a partial historical entry", () => {
  assert.deepEqual(
    plain(historyApi.preserveNutritionSnapshot({}, "lunch", "recipe", { ...actual, protein: Number.NaN }, snapshot.capturedAt)),
    {},
  );
  assert.deepEqual(
    plain(historyApi.preserveNutritionSnapshot({}, "", "recipe", actual, snapshot.capturedAt)),
    {},
  );
});

test("returns a snapshot only for the recipe that originally produced it", () => {
  const history = { lunch: snapshot };
  assert.deepEqual(plain(historyApi.getNutritionSnapshot(history, "lunch", "chicken-rice")), snapshot);
  assert.equal(historyApi.getNutritionSnapshot(history, "lunch", "changed-recipe"), null);
  assert.equal(historyApi.getNutritionSnapshot(history, "missing", "chicken-rice"), null);
});
