import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
async function loadModule(path, exports, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source.replace(/^import[\s\S]*?;\n/gm, "").replaceAll("export ", "") + `\nglobalThis.api = { ${exports.join(",")} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const sandbox = { URL, URLSearchParams, Date, Response, ...globals }; vm.runInNewContext(code, sandbox); return sandbox.api;
}
const { buildAnalyticsDashboard: build, parseDashboardOptions: parse, dashboardCsv, DAY } = await loadModule("../lib/analytics-dashboard.ts", ["buildAnalyticsDashboard", "parseDashboardOptions", "dashboardCsv", "DAY"]);
const { parseAnalyticsEvent } = await loadModule("../lib/analytics.ts", ["parseAnalyticsEvent"]);
const start = Date.UTC(2026, 7, 1), now = start + 40 * DAY;
const options = { start, end: start + 10 * DAY, actorKind: "all", excludeOwner: true };
let sequence = 0;
const row = (actorId, eventName, day, extra = {}) => ({ eventId: `event-${++sequence}`, actorId, actorKind: "device", eventName, recordedAt: start + day * DAY, occurredAt: start + day * DAY, ...extra });
const first = (actorId, day, actorKind = "device") => ({ actorId, actorKind, firstSeenAt: start + day * DAY });

test("date validation rejects impossible dates and oversize ranges; current end is partial", () => {
  assert.throws(() => parse(new URLSearchParams("from=2026-02-30&to=2026-03-05"), now));
  assert.throws(() => parse(new URLSearchParams("from=2026-01-01&to=2026-09-01"), now));
  assert.throws(() => parse(new URLSearchParams("identity=unexpected"), now));
  assert.throws(() => parse(new URLSearchParams("from=2026-09-10"), now));
  assert.throws(() => parse(new URLSearchParams("days=NaN"), now));
  const range = parse(new URLSearchParams("days=7"), now + 12 * 3600000);
  assert.equal(range.end, now + 12 * 3600000);
  assert.equal(range.start, now - 6 * DAY);
});

test("unique actors, legacy first activity, owner filter, dedupe and equal comparison windows", () => {
  const event = row("a", "plan_created", 1, { flowId: "flow", durationMs: 60000 });
  const rows = [row("a", "first_open", -5), event, event, row("a", "plan_created", 2, { flowId: "flow", durationMs: 60000 }), row("b", "app_open", 3), row("owner", "app_open", 3, { actorKind: "sites" }), row("boundary", "app_open", 10)];
  const r = build(rows, [first("a", -5), first("b", 3), first("owner", 3, "sites")], options, now, "owner");
  assert.equal(r.metrics.active, 2); assert.equal(r.metrics.newActors, 1); assert.equal(r.metrics.plans, 1);
  assert.equal(r.previous.active, 1); assert.equal(r.previousStart, start - 10 * DAY); assert.equal(r.daily.length, 10);
  assert.equal(r.daily[0].active, 0); assert.equal(r.recent.some((v) => v.participant.includes("owner")), false);
  assert.equal(build(rows, [], { ...options, actorKind: "sites", excludeOwner: false }, now, "owner").metrics.active, 1);
});

test("funnel respects order; screen opens do not imply buying or cooking", () => {
  const rows = [row("out-of-order", "cooking_confirmed", 0), row("out-of-order", "plan_create_started", 1), row("out-of-order", "plan_created", 2), row("out-of-order", "shopping_opened", 3), row("out-of-order", "cooking_instructions_opened", 4)];
  ["plan_create_started", "plan_created", "shopping_item_checked", "cooking_confirmed", "next_plan_created"].forEach((name, i) => rows.push(row("complete", name, i + 1)));
  const r = build(rows.reverse(), [], options, now);
  assert.deepEqual(Array.from(r.funnel, (p) => p.count), [2, 2, 1, 1, 1]);
  assert.equal(r.funnel[2].conversion, 50); assert.equal(r.funnel[2].lost, 1);
});

test("retention counts exact UTC day, follows beyond period, and waits for full maturity", () => {
  const people = [first("a", 0), first("b", 9), first("c", 0), first("old", -1)];
  const rows = [row("a", "app_open", 7), row("a", "app_open", 7.5), row("a", "app_open", 30), row("b", "app_open", 16), row("c", "app_open", 8), row("old", "app_open", 6)];
  const r = build(rows, people, options, start + 32 * DAY);
  assert.equal(r.retention[1].eligible, 3); assert.equal(r.retention[1].returned, 2);
  assert.equal(r.retention[2].eligible, 2); assert.equal(r.retention[2].returned, 1);
  assert.equal(r.retention[2].rate, 50);
  const pending = build([], [first("new", 9)], options, start + 10.5 * DAY);
  assert.equal(pending.retention[0].eligible, 0); assert.equal(pending.retention[0].rate, null);
});

test("flow IDs scoped to actor, steps deduped, later saves prevent false stalls", () => {
  const rows = [row("a", "wizard_step_viewed", 1, { flowId: "same", step: 2 }), row("a", "wizard_step_viewed", 2, { flowId: "same", step: 2 }), row("b", "wizard_step_viewed", 1, { flowId: "same", step: 2 }), row("a", "plan_created", 11, { flowId: "same" })];
  const r = build(rows, [], options, now);
  assert.equal(r.wizardFlows, 2); assert.equal(r.wizard[2].count, 2); assert.equal(r.wizard[2].stalled, 1); assert.equal(r.wizardSaved, 0);
});

test("recipe opens without IDs stay unassigned and ranking uses unique actors", () => {
  const r = build([row("a", "recipe_opened", 1), row("a", "recipe_opened", 1, { recipeId: "recipe-1" }), row("a", "recipe_opened", 2, { recipeId: "recipe-1" }), row("b", "recipe_opened", 2, { recipeId: "recipe-2" }), row("c", "recipe_opened", 2, { recipeId: "recipe-2" })], [], options, now);
  assert.equal(r.recipeOpensWithoutId, 1); assert.equal(r.recipes[0].id, "recipe-2"); assert.equal(r.recipes[1].actors, 1);
  assert.match(dashboardCsv(r), /exclude_owner/); assert.match(dashboardCsv(r), /to_exclusive_utc/); assert.match(dashboardCsv(r), /"previous"/);
});

test("new ingestion fields are bounded and old payloads remain valid", () => {
  const base = { eventId: "11111111-1111-4111-8111-111111111111", occurredAt: now };
  const step = { ...base, eventName: "wizard_step_viewed", flowId: base.eventId, step: 0 };
  assert.equal(parseAnalyticsEvent(step, now).event.step, 0);
  assert.ok(parseAnalyticsEvent({ ...step, step: 7 }, now).error);
  assert.ok(parseAnalyticsEvent({ ...step, step: 0.5 }, now).error);
  assert.ok(parseAnalyticsEvent({ ...step, flowId: undefined }, now).error);
  assert.ok(parseAnalyticsEvent({ ...step, eventName: "app_open" }, now).error);
  assert.equal(parseAnalyticsEvent({ ...base, eventName: "recipe_opened" }, now).event.eventName, "recipe_opened");
  assert.equal(parseAnalyticsEvent({ ...base, eventName: "recipe_opened", recipeId: "tmpm-123" }, now).event.recipeId, "tmpm-123");
  assert.ok(parseAnalyticsEvent({ ...base, eventName: "app_open", recipeId: "tmpm-123" }, now).error);
});

test("dashboard endpoint fails closed before database access and never caches reports", async () => {
  let calls = 0;
  const mock = build([], [], options, now);
  const { GET } = await loadModule("../app/api/analytics/dashboard/route.ts", ["GET"], {
    isAnalyticsOwner: (id) => id === "owner", parseDashboardOptions: parse,
    loadAnalyticsDashboard: async () => { calls++; return mock; }, dashboardCsv,
    AnalyticsCapacityError: class extends Error {}, console,
  });
  const forbidden = await GET(new Request("https://test/api/analytics/dashboard"));
  assert.equal(forbidden.status, 403); assert.equal(calls, 0); assert.match(forbidden.headers.get("cache-control"), /no-store/);
  const allowed = await GET(new Request("https://test/api/analytics/dashboard?days=7&format=csv", { headers: { "oai-authenticated-user-id": "owner" } }));
  assert.equal(allowed.status, 200); assert.equal(calls, 1); assert.match(allowed.headers.get("content-type"), /csv/);
  assert.match(await allowed.text(), /"retention","D7"/);
});
