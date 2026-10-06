import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadModule(path) {
  const output = ts.transpileModule(await read(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    module: { exports },
    exports,
    URL,
    URLSearchParams,
    TextEncoder,
  });
  return exports;
}

const analytics = await loadModule("lib/analytics.ts");
const now = Date.UTC(2026, 9, 6, 12);
const base = {
  eventId: "8c1f9f0e-3e7a-4d55-9a3b-1f0d7e2c4b11",
  occurredAt: now,
};
const flowId = "2f6b0c8e-5d4a-4b3c-8e2f-7a9d1c0b3e55";

test("onboarding screens are numbered in a fixed list, not in the shown order", () => {
  assert.deepEqual(
    [...analytics.analyticsOnboardingSteps],
    ["welcome", "batches", "install", "reminders"],
  );
  const { parseAnalyticsEvent } = analytics;
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "onboarding_step_viewed", step: 2 }, now).event.step,
    2,
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "onboarding_step_viewed" }, now).error,
    "step must name an onboarding screen",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "onboarding_step_viewed", step: 4 }, now).error,
    "step must name an onboarding screen",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "onboarding_step_viewed", step: "install" }, now).error,
    "step must be a non-negative integer",
  );
});

test("a wizard screen belongs to a plan flow and stays within the seven screens", () => {
  const { parseAnalyticsEvent } = analytics;
  const accepted = parseAnalyticsEvent(
    { ...base, eventName: "wizard_step_viewed", flowId, step: 6 },
    now,
  );
  assert.equal(accepted.event.step, 6);
  assert.equal(accepted.event.flowId, flowId);
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "wizard_step_viewed", step: 0 }, now).error,
    "flowId is required for wizard_step_viewed",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "wizard_step_viewed", flowId, step: 7 }, now).error,
    "step must be a wizard screen from 0 to 6",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "wizard_step_viewed", flowId, step: -1 }, now).error,
    "step must be a non-negative integer",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "wizard_step_viewed", flowId, step: 1.5 }, now).error,
    "step must be a non-negative integer",
  );
});

test("other events cannot carry a screen number", () => {
  assert.equal(
    analytics.parseAnalyticsEvent({ ...base, eventName: "first_open", step: 0 }, now).error,
    "step is only allowed for step events",
  );
});

test("the screen number reaches its own column and stays out of the pilot summary", async () => {
  const [schema, route, migration, journal, report, analyticsDoc] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/analytics/route.ts"),
    read("drizzle/0007_step_analytics.sql"),
    read("drizzle/meta/_journal.json"),
    read("lib/pilot-report.ts"),
    read("ANALYTICS.md"),
  ]);
  assert.match(schema, /step: integer\("step"\)/);
  assert.match(route, /step: parsed\.event\.step \?\? null/);
  assert.match(migration, /ALTER TABLE `analytics_events` ADD `step` integer;/);
  assert.ok(JSON.parse(journal).entries.some((entry) => entry.tag === "0007_step_analytics"));
  assert.match(report, /notInArray\(analyticsEvents\.eventName, \[\s*"onboarding_step_viewed",\s*"wizard_step_viewed",\s*\]\)/);
  assert.match(analyticsDoc, /onboarding_step_viewed/);
  assert.match(analyticsDoc, /wizard_step_viewed/);
});

test("screens are recorded once per first onboarding and once per plan flow", async () => {
  const page = await read("app/page.tsx");
  assert.match(
    page,
    /if \(screen < 0 \|\| localStorage\.getItem\(onboardingStorageKey\)\) return;\s*void trackAnalytics\(\s*"onboarding_step_viewed",\s*\{ step: screen \},\s*`onboarding-step:\$\{onboardingStep\}`,/,
  );
  assert.match(
    page,
    /if \(!plannedFlow \|\| successPlan\) return;\s*const screen = stepRef\.current;\s*void trackAnalytics\(\s*"wizard_step_viewed",\s*\{ flowId: plannedFlow, step: screen \},\s*`plan-step:\$\{plannedFlow\}:\$\{screen\}`,/,
  );
  const restore = page.indexOf("/* a broken draft must never block the wizard */");
  const observer = page.indexOf('"wizard_step_viewed",');
  assert.ok(restore > 0 && observer > restore, "the wizard observer runs after the draft restore");
});
