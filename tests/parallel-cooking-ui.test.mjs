import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = new URL("..", import.meta.url);

async function setupRules() {
  const source = await readFile(new URL("app/parallel-cooking.tsx", root), "utf8");
  const start = source.indexOf("const labels:");
  const end = source.indexOf("export function ParallelCookingView");
  assert.ok(start >= 0 && end > start, "the setup rules stay outside the React renderer");
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__rules = { candidateRequiredResourceKinds, candidateSelectableResourceKinds, candidateRisk, labels };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { Object, Array, Set, Boolean };
  context.globalThis = context;
  vm.runInNewContext(output, context);
  return context.__rules;
}

test("background confirmation asks for the physical resource implied by the source category", async () => {
  const rules = await setupRules();
  assert.deepEqual([...rules.candidateRequiredResourceKinds("oven", ["oven", "baking_dish"])], ["oven", "baking_dish"]);
  assert.deepEqual([...rules.candidateRequiredResourceKinds("boil", ["pot", "stove"])].sort(), ["burner", "pot"]);
  assert.deepEqual([...rules.candidateRequiredResourceKinds("cold_wait", [])], ["fridge"]);
  assert.deepEqual([...rules.candidateSelectableResourceKinds("cold_wait", [])], ["fridge", "bowl"]);
  assert.match(rules.candidateRisk("oven"), /ручной проверки/u);
  assert.match(rules.candidateRisk("cold_wait"), /Холодильник/u);
  assert.equal(rules.labels.pressure_cooker, "Скороварки");
  assert.equal(rules.labels.air_fryer, "Аэрогрили");
});

test("all-catalog setup uses descriptors and only candidate actions can become background", async () => {
  const source = await readFile(new URL("app/parallel-cooking.tsx", root), "utf8");
  assert.match(source, /cookingSourceDescriptor\(dish\.recipeId, dish\.methodId\)/);
  assert.match(source, /cookingPlanSnapshotMatches/);
  assert.match(source, /!cookingPlanSnapshotMatches\(saved\.planSnapshotSignature, props\.plan, props\.batchId, props\.dishes\)/);
  assert.match(source, /sourceChanged=\{!cookingPlanSnapshotMatches\(setup\.planSnapshotSignature, props\.plan, props\.batchId, props\.dishes\)\}/);
  assert.match(source, /method\.actions\.filter\(action => action\.backgroundCandidate\)/);
  assert.match(source, /allBatchFits/);
  assert.match(source, /const restored = await client\.refreshFromServer\(\)/);
  assert.match(source, /restored\.received && !client\.snapshot\(\)\.session/);
  assert.match(source, /function beginGuidedHeat\(operation: CookingOperation\)/);
  assert.match(source, /client\.enqueueBatch\(\[/);
  assert.match(source, /type: "completed", opId: operation\.id, occurredAt: at/);
  assert.match(source, /type: "started", opId: heat\.id, occurredAt: at, endsAt: at \+ heat\.durationSeconds \* 1000/);
  assert.match(source, /Сначала проверьте блюдо с истёкшим таймером/);
  assert.match(source, /Таймер начнётся только после этой постановки, по времени из исходной инструкции/);
  assert.doesNotMatch(source, /if \(!supported\) return/);
  assert.doesNotMatch(source, /setOrdinary\(/);
});
