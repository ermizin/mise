import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);
async function core() {
  const modules = {};
  for (const name of ["validate", "schedule"]) {
    const url = new URL(`domain/cooking/${name}.ts`, root), compiledModule = { exports: {} };
    vm.runInNewContext(ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module: compiledModule, exports: compiledModule.exports, require: (id) => modules[id] ?? createRequire(url)(id), Map, Set, Math, Object, Array, JSON, Number, Infinity }, { filename: url.pathname });
    modules[`./${name}`] = compiledModule.exports; modules[`./${name}.ts`] = compiledModule.exports;
  }
  return { ...modules["./validate"], ...modules["./schedule"] };
}
const resourceUse = (resourceId, kind) => ({ resourceId, kind });
const op = (id, kind, { deps = [], duration = 10, background = false, resources = background ? [resourceUse("oven", "oven")] : [resourceUse("cook", "cook")], recipeId = id.split("-")[0], holds, checkDeadlineSeconds } = {}) => ({ id, recipeId, methodId: "original", dishKey: recipeId, kind, title: id, dependsOn: deps, durationSeconds: duration, attention: background ? "background" : "required", resources, allocations: [], sourceStepIndexes: [0], ...(background ? { requiresCheckAtEnd: true } : {}), ...(holds ? { resourceHolds: holds } : {}), ...(checkDeadlineSeconds !== undefined ? { checkDeadlineSeconds } : {}) });
const session = (operations, supplied = true) => ({ id: "s", diagnostics: [], input: supplied ? { kitchen: { resources: [...new Map(operations.flatMap((item) => item.resources).map((item) => [item.resourceId, { id: item.resourceId, kind: item.kind }])).values()] } } : {}, operations });
const entry = (schedule, id) => schedule.entries.find((item) => item.opId === id);

test("one pot stays leased through unload while the cook preps the second dish during heating", async () => {
  const { scheduleCookingSession, validateCookingSchedule } = await core();
  const aStart = op("a-start", "start_heat", { duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("pot", "pot"), resourceUse("burner", "burner")], holds: [ { resourceId: "pot", kind: "pot", releaseAfterOpId: "a-unload" }, { resourceId: "burner", kind: "burner", releaseAfterOpId: "a-unload" } ] });
  const aHeat = op("a-heat", "heat", { deps: ["a-start"], duration: 100, background: true, resources: [resourceUse("pot", "pot"), resourceUse("burner", "burner")] });
  const aCheck = op("a-check", "intervention", { deps: ["a-heat"], duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("pot", "pot"), resourceUse("burner", "burner")] });
  const aUnload = op("a-unload", "unload", { deps: ["a-check"], duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("pot", "pot")] });
  const bPrep = op("b-prep", "prep", { duration: 30, resources: [resourceUse("cook", "cook"), resourceUse("board", "board")] });
  const bStart = op("b-start", "start_heat", { deps: ["b-prep"], duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("pot", "pot"), resourceUse("burner", "burner")] });
  const result = scheduleCookingSession(session([aStart, aHeat, aCheck, aUnload, bPrep, bStart]));
  assert.equal(result.mode, "optimized");
  assert.ok(entry(result, "b-prep").startAt >= entry(result, "a-heat").startAt);
  assert.ok(entry(result, "b-prep").endAt <= entry(result, "a-heat").endAt);
  assert.ok(entry(result, "b-start").startAt >= entry(result, "a-unload").endAt);
  assert.equal(validateCookingSchedule(session([aStart, aHeat, aCheck, aUnload, bPrep, bStart]), result).length, 0);
});

test("an oven resource is exclusive even when two heating chains would otherwise run in parallel", async () => {
  const { scheduleCookingSession } = await core();
  const chain = (prefix) => [op(`${prefix}-start`, "start_heat", { duration: 5, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven"), resourceUse(`${prefix}-tray`, "tray")] }), op(`${prefix}-heat`, "heat", { deps: [`${prefix}-start`], duration: 40, background: true, resources: [resourceUse("oven", "oven"), resourceUse(`${prefix}-tray`, "tray")] }), op(`${prefix}-check`, "intervention", { deps: [`${prefix}-heat`], duration: 5, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven"), resourceUse(`${prefix}-tray`, "tray")] })];
  const result = scheduleCookingSession(session([...chain("a"), ...chain("b")]));
  const a = entry(result, "a-heat"), b = entry(result, "b-heat");
  assert.ok(a.endAt <= b.startAt || b.endAt <= a.startAt);
});

test("two mandatory checks are reserved at different future cook times", async () => {
  const { scheduleCookingSession, validateCookingSchedule } = await core();
  const chain = (prefix, oven) => [op(`${prefix}-start`, "start_heat", { duration: 5, resources: [resourceUse("cook", "cook"), resourceUse(oven, "oven")] }), op(`${prefix}-heat`, "heat", { deps: [`${prefix}-start`], duration: 30, background: true, resources: [resourceUse(oven, "oven")] }), op(`${prefix}-check`, "intervention", { deps: [`${prefix}-heat`], duration: 8, resources: [resourceUse("cook", "cook"), resourceUse(oven, "oven")] })];
  const input = session([...chain("a", "oven-a"), ...chain("b", "oven-b")]); const result = scheduleCookingSession(input);
  const a = entry(result, "a-check"), b = entry(result, "b-check");
  assert.ok(a.endAt <= b.startAt || b.endAt <= a.startAt);
  assert.equal(validateCookingSchedule(input, result).length, 0);
});

test("background waiting leaves the cook free and source durations are unchanged at comfortable pace", async () => {
  const { scheduleCookingSession } = await core();
  const start = op("a-start", "start_heat", { duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] });
  const heat = op("a-heat", "heat", { deps: ["a-start"], duration: 100, background: true, resources: [resourceUse("oven", "oven")] });
  const check = op("a-check", "intervention", { deps: ["a-heat"], duration: 10, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] });
  const prep = op("b-prep", "prep", { duration: 20, resources: [resourceUse("cook", "cook"), resourceUse("board", "board")] });
  const input = { ...session([start, heat, check, prep]), input: { kitchen: session([start, heat, check, prep]).input.kitchen, pace: "comfortable" } };
  const before = JSON.stringify(input);
  const result = scheduleCookingSession(input);
  assert.equal(entry(result, "a-heat").endAt - entry(result, "a-heat").startAt, 100);
  assert.ok(entry(result, "b-prep").startAt >= entry(result, "a-heat").startAt && entry(result, "b-prep").endAt <= entry(result, "a-heat").endAt);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(scheduleCookingSession(input).entries), JSON.stringify(result.entries));
});

test("validator rejects malformed graphs and never lets a dropped operation pass", async () => {
  const { validateCookingGraph, validateCookingSchedule } = await core();
  const bad = op("bad", "prep", { duration: Number.NaN, resources: [resourceUse("cook", "cook"), resourceUse("ghost", "pot")] });
  const cycle = op("cycle", "portion", { deps: ["cycle"], resources: [resourceUse("cook", "cook")] });
  const input = { ...session([bad, cycle]), input: { kitchen: { resources: [{ id: "cook", kind: "cook" }] } } };
  assert.ok(validateCookingGraph(input).some((item) => item.code === "invalid_operation_duration"));
  assert.ok(validateCookingGraph(input).some((item) => item.code === "resource_unavailable"));
  assert.ok(validateCookingGraph(input).some((item) => item.code === "dependency_cycle"));
  assert.ok(validateCookingSchedule(input, { mode: "optimized", entries: [{ opId: "bad", startAt: 0, endAt: 0 }], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: false, diagnostics: [] }).some((item) => item.code === "missing_operation"));
});

test("tiny exhaustive oracle confirms the best of both oven-chain orders", async () => {
  const { scheduleCookingSession } = await core();
  const chain = (prefix, heatDuration) => [op(`${prefix}-start`, "start_heat", { duration: 2, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] }), op(`${prefix}-heat`, "heat", { deps: [`${prefix}-start`], duration: heatDuration, background: true, resources: [resourceUse("oven", "oven")] }), op(`${prefix}-check`, "intervention", { deps: [`${prefix}-heat`], duration: 3, resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] })];
  const input = session([...chain("a", 7), ...chain("b", 11)]), result = scheduleCookingSession(input);
  const orders = [[7, 11], [11, 7]];
  const oracle = Math.min(...orders.map(([first, second]) => (2 + first + 3) + (2 + second + 3)));
  assert.equal(result.optimizedMakespan, oracle);
  assert.ok(result.optimizedMakespan <= result.baselineMakespan);
});
