import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);

async function loadTs(path, dependencies = {}) {
  const url = new URL(path, root);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true },
  }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports, Response, Request, require: (id) => dependencies[id] ?? createRequire(url)(id) };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}

function validPlan() {
  return {
    id: "plan-1", start: "2026-09-01", end: "2026-09-01", periodDays: 1, cookEveryDays: 1,
    menuStyle: "protein", mealSlots: ["lunch"],
    people: [{ id: "person-1", name: "Alex", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch"], hardExclusions: ["fish"] }],
    batches: [{ id: "batch-1", index: 0, start: "2026-09-01", end: "2026-09-01", days: 1 }],
    selections: { "batch-1:lunch": "goodfood-tuna-pasta-bake" },
    selectionAssignments: { "batch-1:lunch": [{ recipeId: "goodfood-tuna-pasta-bake", personIds: ["person-1"] }] },
    shopping: [],
  };
}

test("POST rejects a hard-exclusion plan before D1 insert", async () => {
  const [validation, nutrition] = await Promise.all([
    loadTs("lib/plan-validation.ts"),
    loadTs("domain/nutrition.ts"),
  ]);
  const writes = [];
  const route = await loadTs("app/api/plans/route.ts", {
    "drizzle-orm": { and() {}, desc() {}, eq() {} },
    "../../../db": { getDb: () => ({ insert: () => ({ values: (value) => { writes.push(value); return { onConflictDoUpdate: async () => {} }; } }) }) },
    "../../../db/schema": { mealPlans: {}, pushJobs: {}, pushPreferences: {}, pushSubscriptions: {} },
    "../../../lib/plan-validation": validation,
    "../../../domain/nutrition": nutrition,
  });
  const response = await route.POST(new Request("https://mise.invalid/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mise-client": "12345678-1234-1234-1234-123456789abc" },
    body: JSON.stringify({ plan: validPlan() }),
  }));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "plan violates a hard exclusion" });
  assert.equal(writes.length, 0);
});
