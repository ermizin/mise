import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const EPOCH = 1_700_000_000_000;
const at = (seconds) => EPOCH + seconds * 1_000;
async function core() { const modules = {}; for (const name of ["validate", "schedule", "replan"]) { const url = new URL(`domain/cooking/${name}.ts`, root), module = { exports: {} }; vm.runInNewContext(ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require: (id) => modules[id] ?? createRequire(url)(id), Map, Math, Set, Object, Array, JSON, Number, Infinity }, { filename: url.pathname });
 modules[`./${name}`] = module.exports; modules[`./${name}.ts`] = module.exports; } return modules["./replan"]; }
const use = (resourceId, kind) => ({ resourceId, kind });
const op = (id, kind, { deps = [], duration = 10, background = false, resources = background ? [use("oven", "oven")] : [use("cook", "cook")], holds } = {}) => ({ id, recipeId: id[0], methodId: "original", dishKey: id[0], kind, title: id, dependsOn: deps, durationSeconds: duration, attention: background ? "background" : "required", resources, allocations: [], sourceStepIndexes: [0], ...(background ? { requiresCheckAtEnd: true } : {}), ...(holds ? { resourceHolds: holds } : {}) });
const session = (operations) => ({ id: "s", input: {}, diagnostics: [], operations });
const entry = (schedule, id) => schedule.entries.find((item) => item.opId === id);

test("replan keeps an active interval fixed while delayed prep is newly placed in passive heating time", async () => {
  const { initialCookingExecution, applyCookingEvent, replanCookingSession } = await core();
  const heat = op("a-heat", "heat", { duration: 100, background: true, resources: [use("oven", "oven")] });
  const check = op("a-check", "intervention", { deps: ["a-heat"], duration: 10, resources: [use("cook", "cook"), use("oven", "oven")] });
  const prep = op("b-prep", "prep", { duration: 20, resources: [use("cook", "cook"), use("board", "board")] });
  const input = session([heat, check, prep]);
  const active = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(100) }, at(0)).execution;
  const result = replanCookingSession(input, active, at(30));
  assert.equal(result.diagnostics.length, 0);
  assert.equal(entry(result, "a-heat").startAt, at(0)); assert.equal(entry(result, "a-heat").endAt, at(100));
  assert.ok(entry(result, "b-prep").startAt >= at(30) && entry(result, "b-prep").endAt <= at(100));
});

test("a pending cook action can start during a passive heat but not through its reserved check", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const heat = op("a-heat", "heat", { duration: 30, background: true, resources: [use("oven", "oven")] });
  const check = op("a-check", "intervention", { deps: ["a-heat"], duration: 10, resources: [use("cook", "cook"), use("oven", "oven")] });
  const prep = op("b-prep", "prep", { duration: 10, resources: [use("cook", "cook")] });
  const input = session([heat, check, prep]); let state = initialCookingExecution(input);
  state = applyCookingEvent(input, state, { id: "heat", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(30) }, at(0)).execution;
  const allowed = applyCookingEvent(input, state, { id: "prep", type: "started", opId: "b-prep", occurredAt: at(5), endsAt: at(15) }, at(5));
  assert.equal(allowed.diagnostics.length, 0);
  const blocked = applyCookingEvent(input, state, { id: "late", type: "started", opId: "b-prep", occurredAt: at(25), endsAt: at(35) }, at(25));
  assert.ok(blocked.diagnostics.some((item) => item.code === "resource_conflict"));
});

test("duplicate event IDs are idempotent only with the exact original payload", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const input = session([op("a-prep", "prep")]); const event = { id: "same", type: "started", opId: "a-prep", occurredAt: at(0), endsAt: at(10) };
  const first = applyCookingEvent(input, initialCookingExecution(input), event, at(0));
  assert.equal(applyCookingEvent(input, first.execution, event, at(1)).diagnostics.length, 0);
  assert.ok(applyCookingEvent(input, first.execution, { ...event, endsAt: at(11) }, at(1)).diagnostics.some((item) => item.code === "event_id_conflict"));
});

test("one cook cannot start two overlapping active actions", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const input = session([op("a-prep", "prep", { duration: 20 }), op("b-prep", "prep", { duration: 10 })]);
  const active = applyCookingEvent(input, initialCookingExecution(input), { id: "a", type: "started", opId: "a-prep", occurredAt: at(0), endsAt: at(20) }, at(0)).execution;
  assert.ok(applyCookingEvent(input, active, { id: "b", type: "started", opId: "b-prep", occurredAt: at(5), endsAt: at(15) }, at(5)).diagnostics.some((item) => item.code === "resource_conflict"));
});

test("expiry changes a heat to needs_check without silently completing it", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const heat = op("a-heat", "heat", { duration: 10, background: true }); const check = op("a-check", "intervention", { deps: ["a-heat"] }); const input = session([heat, check]);
  const active = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  const paused = applyCookingEvent(input, active, { id: "pause", type: "paused", occurredAt: at(12) }, at(12));
  assert.equal(paused.execution.statusByOperation["a-heat"], "needs_check");
  assert.notEqual(paused.execution.statusByOperation["a-heat"], "completed");
});

test("an explicit extension resumes an expired heat and preserves its recorded start", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const heat = op("a-heat", "heat", { duration: 10, background: true }); const check = op("a-check", "intervention", { deps: ["a-heat"] }); const input = session([heat, check]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  state = applyCookingEvent(input, state, { id: "pause", type: "paused", occurredAt: at(12) }, at(12)).execution;
  const extended = applyCookingEvent(input, state, { id: "extend", type: "extended", opId: "a-heat", occurredAt: at(12), endsAt: at(25) }, at(12));
  assert.equal(extended.execution.statusByOperation["a-heat"], "active"); assert.equal(extended.execution.startedAtByOperation["a-heat"], at(0)); assert.equal(extended.execution.endsAtByOperation["a-heat"], at(25));
});

test("heat durations are seconds in the recipe and milliseconds in the running anchor", async () => {
  const { initialCookingExecution, applyCookingEvent, replanCookingSession } = await core();
  const heat = op("a-heat", "heat", { duration: 120, background: true }); const check = op("a-check", "intervention", { deps: ["a-heat"] }); const input = session([heat, check]);
  const state = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-heat", occurredAt: at(5), endsAt: at(125) }, at(5)).execution;
  assert.equal(state.endsAtByOperation["a-heat"] - state.startedAtByOperation["a-heat"], 120_000);
  const plan = replanCookingSession(input, state, at(20));
  assert.equal(entry(plan, "a-heat").endAt - entry(plan, "a-heat").startAt, 120_000);
});

test("extension moves the reservation to the new end anchor", async () => {
  const { initialCookingExecution, applyCookingEvent, replanCookingSession } = await core();
  const heat = op("a-heat", "heat", { duration: 10, background: true }); const check = op("a-check", "intervention", { deps: ["a-heat"] }); const prep = op("b-prep", "prep", { duration: 10 }); const input = session([heat, check, prep]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "start", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  const expired = applyCookingEvent(input, state, { id: "expire", type: "paused", occurredAt: at(12) }, at(12));
  assert.equal(expired.diagnostics.length, 0);
  const extended = applyCookingEvent(input, expired.execution, { id: "extend", type: "extended", opId: "a-heat", occurredAt: at(12), endsAt: at(40) }, at(12));
  assert.equal(extended.diagnostics.length, 0);
  const plan = replanCookingSession(input, extended.execution, at(12));
  assert.equal(entry(plan, "a-heat").endAt, at(40));
  assert.ok(entry(plan, "a-check").startAt >= at(40));
});

test("pause survives a reload and still permits the required intervention", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const heat = op("a-heat", "heat", { duration: 10, background: true }); const check = op("a-check", "intervention", { deps: ["a-heat"] }); const input = session([heat, check]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "heat", type: "started", opId: "a-heat", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  state = applyCookingEvent(input, state, { id: "done", type: "completed", opId: "a-heat", occurredAt: at(10) }, at(10)).execution;
  state = applyCookingEvent(input, state, { id: "pause", type: "paused", occurredAt: at(11) }, at(11)).execution;
  const reloaded = JSON.parse(JSON.stringify(state));
  const next = applyCookingEvent(input, reloaded, { id: "check", type: "started", opId: "a-check", occurredAt: at(11), endsAt: at(21) }, at(11));
  assert.equal(next.diagnostics.length, 0); assert.equal(next.execution.statusByOperation["a-check"], "active");
});

test("completion cannot bypass an unfinished dependency", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core(); const input = session([op("a-prep", "prep"), op("a-portion", "portion", { deps: ["a-prep"] })]);
  const result = applyCookingEvent(input, initialCookingExecution(input), { id: "bad", type: "completed", opId: "a-portion", occurredAt: at(0) }, at(0));
  assert.ok(result.diagnostics.some((item) => item.code === "dependency_incomplete"));
});

test("a completed load still holds its pot until the recorded unload", async () => {
  const { initialCookingExecution, applyCookingEvent } = await core();
  const load = op("a-load", "start_heat", { resources: [use("cook", "cook"), use("pot", "pot")], holds: [{ resourceId: "pot", kind: "pot", releaseAfterOpId: "a-unload" }] });
  const heat = op("a-heat", "heat", { deps: ["a-load"], duration: 30, background: true, resources: [use("pot", "pot")] });
  const unload = op("a-unload", "unload", { deps: ["a-heat"], resources: [use("cook", "cook"), use("pot", "pot")] });
  const other = op("b-load", "start_heat", { resources: [use("cook", "cook"), use("pot", "pot")] }); const input = session([load, heat, unload, other]);
  let state = applyCookingEvent(input, initialCookingExecution(input), { id: "load-start", type: "started", opId: "a-load", occurredAt: at(0), endsAt: at(10) }, at(0)).execution;
  state = applyCookingEvent(input, state, { id: "load-end", type: "completed", opId: "a-load", occurredAt: at(10) }, at(10)).execution;
  state = applyCookingEvent(input, state, { id: "heat-start", type: "started", opId: "a-heat", occurredAt: at(10), endsAt: at(40) }, at(10)).execution;
  const blocked = applyCookingEvent(input, state, { id: "other", type: "started", opId: "b-load", occurredAt: at(20), endsAt: at(30) }, at(20));
  assert.ok(blocked.diagnostics.some((item) => item.code === "resource_conflict"));
});
