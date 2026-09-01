import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadAnalytics() {
  const source = await readFile(
    new URL("../lib/analytics.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(
    `${source.replaceAll("export ", "")}\nglobalThis.__analytics = { parseAnalyticsEvent, buildPilotSummary, pilotSummaryCsv, analyticsEventNames };`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  const sandbox = { Date };
  vm.runInNewContext(output, sandbox);
  return sandbox.__analytics;
}

const {
  parseAnalyticsEvent,
  buildPilotSummary,
  pilotSummaryCsv,
  analyticsEventNames,
} = await loadAnalytics();
const now = Date.UTC(2026, 7, 28, 12);
const ids = {
  first: "11111111-1111-4111-8111-111111111111",
  flow: "22222222-2222-4222-8222-222222222222",
};

test("analytics accepts only the bounded event contract", () => {
  const valid = parseAnalyticsEvent(
    {
      eventId: ids.first,
      eventName: "plan_created",
      flowId: ids.flow,
      durationMs: 590_000,
      pilotEligible: true,
      occurredAt: now,
    },
    now,
  );
  assert.equal("error" in valid, false);
  for (const forbidden of [
    { macros: { kcal: 2000 } },
    { bodyParameters: { weight: 70 } },
    { allergy: "орехи" },
    { plan: { meals: ["секрет"] } },
    { pushSubscription: { endpoint: "secret" } },
  ]) {
    const result = parseAnalyticsEvent(
      {
        eventId: ids.first,
        eventName: "first_open",
        occurredAt: now,
        ...forbidden,
      },
      now,
    );
    assert.equal(result.error, "event contains unsupported fields");
  }
  assert.equal(
    parseAnalyticsEvent(
      {
        eventId: ids.first,
        eventName: "plan_created",
        flowId: ids.flow,
        durationMs: 590_000,
        occurredAt: now,
      },
      now,
    ).error,
    "durationMs and pilotEligible are required for plan_created",
  );
  assert.equal(
    parseAnalyticsEvent(
      {
        eventId: ids.first,
        eventName: "blocking_error",
        errorCode: "raw server stack",
        occurredAt: now,
      },
      now,
    ).error,
    "errorCode is not allowed",
  );
  assert.ok(analyticsEventNames.includes("reminders_enabled"));
  assert.ok(analyticsEventNames.includes("recipe_opened"));
  assert.ok(analyticsEventNames.includes("recipe_tab_switched"));
  const tabSwitch = parseAnalyticsEvent(
    {
      eventId: ids.first,
      eventName: "recipe_tab_switched",
      from: "cooking",
      to: "dish",
      occurredAt: now,
    },
    now,
  );
  assert.equal("error" in tabSwitch, false);
  assert.equal(
    parseAnalyticsEvent(
      {
        eventId: ids.first,
        eventName: "recipe_tab_switched",
        from: "cooking",
        to: "cooking",
        occurredAt: now,
      },
      now,
    ).error,
    "different from and to sections are required for recipe_tab_switched",
  );
});

test("pilot report separates screen opens from confirmed purchase and cooking", () => {
  const rows = [];
  let counter = 0;
  const add = (actorId, eventName, fields = {}) =>
    rows.push({
      eventId: `${String(++counter).padStart(8, "0")}-0000-4000-8000-000000000000`,
      actorId,
      actorKind: "device",
      eventName,
      occurredAt: now + counter,
      recordedAt: now + counter,
      ...fields,
    });
  for (const actor of ["a", "b", "c", "d"]) {
    add(actor, "first_open");
    add(actor, "plan_created", {
      flowId: ids.flow,
      durationMs: 9 * 60_000,
      pilotEligible: true,
    });
  }
  add("a", "shopping_opened");
  add("a", "cooking_instructions_opened");
  for (const actor of ["b", "c", "d"]) {
    add(actor, "shopping_item_checked");
    add(actor, "cooking_confirmed");
    add(actor, "next_plan_created", { flowId: ids.flow });
  }
  const summary = buildPilotSummary(rows, now);
  assert.equal(summary.planUnderTenMinutes, 4);
  assert.equal(summary.purchaseAndCooking, 3);
  assert.equal(summary.returnedAndCreatedNextPlan, 3);
  assert.deepEqual(
    { ...summary.thresholds },
    { plan: true, action: true, return: true },
  );
  assert.equal(summary.participants[0].shoppingOpened, true);
  assert.equal(summary.participants[0].cookingInstructionsOpened, true);
  assert.equal(summary.participants[0].completedPurchaseAndCooking, false);
  assert.equal(summary.observedParticipants, 4);
  assert.equal(summary.participants.length, 5);
  assert.match(pilotSummaryCsv(summary), /purchase_confirmed/);
});

test("only a 3-7 day client classification contributes to the time threshold", () => {
  const row = {
    eventId: ids.first,
    actorId: "actor",
    actorKind: "sites",
    eventName: "plan_created",
    flowId: ids.flow,
    durationMs: 60_000,
    pilotEligible: false,
    occurredAt: now,
    recordedAt: now,
  };
  const summary = buildPilotSummary([row], now);
  assert.equal(summary.planUnderTenMinutes, 0);
  assert.equal(summary.participants[0].firstEligiblePlanDurationMs, null);
});

test("client instrumentation and owner report stay inside the privacy contract", async () => {
  const [page, notificationSetup, eventRoute, summaryRoute, owner, reportPage] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/notification-setup.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/analytics/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/analytics/summary/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/analytics-owner.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/pilot-analytics/page.tsx", import.meta.url),
        "utf8",
      ),
    ]);
  for (const event of analyticsEventNames)
    assert.match(`${page}\n${notificationSetup}`, new RegExp(event));
  assert.match(page, /Отметить, что партия приготовлена/);
  assert.match(eventRoute, /SHA-256/);
  assert.match(eventRoute, /onConflictDoNothing/);
  assert.match(summaryRoute, /owner access required/);
  assert.match(owner, /MISE_ANALYTICS_OWNER_ID/);
  assert.match(reportPage, /Засчитываем реальные действия/);
  assert.doesNotMatch(eventRoute, /payload|allerg|macro|subscription/i);
});
