import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const EPOCH = 1_700_000_000_000; const at = (seconds) => EPOCH + seconds * 1_000;
async function core() {
  const modules = {};
  for (const name of ["validate", "schedule", "replan"]) {
    const url = new URL(`domain/cooking/${name}.ts`, root), compiledModule = { exports: {} };
    vm.runInNewContext(ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module: compiledModule, exports: compiledModule.exports, require: (id) => modules[id] ?? createRequire(url)(id), Map, Set, Math, Object, Array, JSON, Number, Infinity }, { filename: url.pathname });
    modules[`./${name}`] = compiledModule.exports; modules[`./${name}.ts`] = compiledModule.exports;
  }
  return modules["./replan"];
}
const resourceUse = (resourceId, kind) => ({ resourceId, kind });
const op = (id, kind, { deps = [], duration = 10, background = false, rawMeat = false, resources = background ? [resourceUse("oven", "oven")] : [resourceUse("cook", "cook")] } = {}) => ({ id, recipeId: id[0], methodId: "original", dishKey: id[0], kind, title: id, dependsOn: deps, durationSeconds: duration, attention: background ? "background" : "required", resources, allocations: [], sourceStepIndexes: [0], rawMeat, ...(background ? { requiresCheckAtEnd: true } : {}) });
const session = (operations) => ({ id: "s", input: { kitchen: { resources: [{ id: "cook", kind: "cook" }, { id: "board", kind: "board" }, { id: "knife", kind: "knife" }, { id: "oven", kind: "oven" }] } }, diagnostics: [], operations });

test("suspended non-raw prep releases cook, retains tools, and continues after the due heat intervention", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const prep = op("prep", "prep", { duration: 120, resources: [resourceUse("cook", "cook"), resourceUse("board", "board"), resourceUse("knife", "knife")] });
  const heat = op("heat", "heat", { duration: 60, background: true });
  const check = op("check", "intervention", { deps: ["heat"], resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] });
  const input = session([prep, heat, check]); let state = initialCookingExecution(input);
  let result = applyCookingEvent(input, state, { id: "prep-start", type: "started", opId: "prep", occurredAt: at(0), endsAt: at(120) }, at(0)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  result = applyCookingEvent(input, state, { id: "suspend", type: "suspended", opId: "prep", occurredAt: at(20) }, at(20)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  assert.equal(state.statusByOperation.prep, "blocked"); assert.equal(state.remainingSecondsByOperation.prep, 100);
  result = applyCookingEvent(input, state, { id: "heat-start", type: "started", opId: "heat", occurredAt: at(20), endsAt: at(80) }, at(20)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  assert.equal(state.endsAtByOperation.heat, at(80), "suspending prep must not alter a background heat anchor");
  const boardAttempt = applyCookingEvent(input, state, { id: "board", type: "started", opId: "prep", occurredAt: at(30), endsAt: at(130) }, at(30)); assert.ok(boardAttempt.diagnostics.some((item) => item.code === "invalid_transition"));
  result = applyCookingEvent(input, state, { id: "heat-due", type: "needs_check", opId: "heat", occurredAt: at(80) }, at(80)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  result = applyCookingEvent(input, state, { id: "heat-complete", type: "completed", opId: "heat", occurredAt: at(80) }, at(80)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  result = applyCookingEvent(input, state, { id: "check-start", type: "started", opId: "check", occurredAt: at(80), endsAt: at(90) }, at(80)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  result = applyCookingEvent(input, state, { id: "check-complete", type: "completed", opId: "check", occurredAt: at(90) }, at(90)); assert.equal(result.diagnostics.length, 0); state = result.execution;
  result = applyCookingEvent(input, state, { id: "continue", type: "continued", opId: "prep", occurredAt: at(90) }, at(90)); assert.equal(result.diagnostics.length, 0);
  assert.equal(result.execution.statusByOperation.prep, "active"); assert.equal(result.execution.endsAtByOperation.prep, at(190));
});

test("raw prep cannot be suspended", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const raw = op("raw", "prep", { rawMeat: true, resources: [resourceUse("cook", "cook"), resourceUse("board", "board")] }); const input = session([raw]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "raw", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  const result = applyCookingEvent(input, state, { id: "suspend", type: "suspended", opId: "raw", occurredAt: at(2) }, at(2));
  assert.ok(result.diagnostics.some((item) => item.code === "invalid_transition")); assert.equal(result.execution.statusByOperation.raw, "active");
});

test("forecast will not schedule another prep onto tools held by a suspended prep", async () => {
  const { initialCookingExecution, applyCookingEvent, replanCookingSession } = await core();
  const prep = op("a-prep", "prep", { duration: 120, resources: [resourceUse("cook", "cook"), resourceUse("board", "board"), resourceUse("knife", "knife")] });
  const other = op("b-prep", "prep", { duration: 20, resources: [resourceUse("cook", "cook"), resourceUse("board", "board")] }); const input = session([prep, other]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-prep", occurredAt: at(0), endsAt: at(120) }, at(0)).execution;
  state = applyCookingEvent(input, state, { id: "suspend", type: "suspended", opId: "a-prep", occurredAt: at(20) }, at(20)).execution;
  const plan = replanCookingSession(input, state, at(20));
  assert.equal(plan.entries.some((entry) => entry.opId === "b-prep"), false, "board remains held until the prep is continued or resolved");
});


test("a heat timer cannot be made due before its anchor or release the cook for new prep while overdue", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const heat = op("heat", "heat", { duration: 60, background: true });
  const check = op("check", "intervention", { deps: ["heat"], resources: [resourceUse("cook", "cook"), resourceUse("oven", "oven")] });
  const prep = op("prep", "prep");
  const input = session([heat, check, prep]);
  const started = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "heat", occurredAt: at(0) }).execution;
  const early = applyCookingEvent(input, started, { id: "early", type: "needs_check", opId: "heat", occurredAt: at(1) });
  assert.ok(early.diagnostics.length);
  const due = applyCookingEvent(input, started, { id: "due", type: "needs_check", opId: "heat", occurredAt: at(60) });
  assert.equal(due.diagnostics.length, 0);
  const blockedPrep = applyCookingEvent(input, due.execution, { id: "new-prep", type: "started", opId: "prep", occurredAt: at(65) });
  assert.ok(blockedPrep.diagnostics.some(item => item.code === "resource_conflict"));
});

test("an estimated preparation can be explicitly completed early without inventing a food check", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const input = session([op("prep", "prep", { duration: 120 })]);
  const started = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "prep", occurredAt: at(0) }).execution;
  assert.ok(applyCookingEvent(input, started, { id: "due", type: "needs_check", opId: "prep", occurredAt: at(130) }).diagnostics.length);
  const confirmed = applyCookingEvent(input, started, { id: "done", type: "completed", opId: "prep", occurredAt: at(30) });
  assert.equal(confirmed.diagnostics.length, 0);
  assert.equal(confirmed.execution.events.at(-1).occurredAt, at(30));
});
