import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const clientId = "12345678-1234-4234-8234-123456789abc";
const deviceId = "87654321-4321-4321-8321-cba987654321";

async function loadTs(path, dependencies = {}, globals = {}) {
  const url = new URL(path, root);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true },
  }).outputText;
  const exports = {};
  const sandbox = {
    module: { exports }, exports, Response, Request, URL, TextEncoder, crypto,
    console: { error() {} },
    require: (id) => dependencies[id] ?? createRequire(url)(id),
    ...globals,
  };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}

const drizzle = { and: (...parts) => parts, desc() {}, eq: (...parts) => parts, isNull: (part) => part, lt() {}, lte() {}, or() {} };

/** A database whose every statement resolves, recording what was written. */
function recordingDb(writes = []) {
  const statement = (kind, table) => {
    const chain = {
      values: (value) => { writes.push({ kind, table, value }); return chain; },
      set: (value) => { writes.push({ kind, table, value }); return chain; },
      from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain,
      onConflictDoUpdate: () => chain, returning: () => chain,
      then: (resolve) => resolve([]),
    };
    return chain;
  };
  return {
    select: () => statement("select"),
    insert: (table) => statement("insert", table),
    update: (table) => statement("update", table),
    delete: (table) => statement("delete", table),
  };
}

const failingDb = () => {
  const fail = () => { throw new Error('SQLITE_ERROR: no such column "secret_column" in push_jobs'); };
  return { select: fail, insert: fail, update: fail, delete: fail };
};

async function pushRoute(db, processed = []) {
  return loadTs("app/api/push/route.ts", {
    "drizzle-orm": drizzle,
    "../../../db": { getDb: () => db },
    "../../../db/schema": { pushJobs: "jobs", pushPreferences: "preferences", pushSubscriptions: "subscriptions" },
    "../../../lib/push-server": {
      publicVapidKey: () => "key",
      processDueNotifications: async (...args) => { processed.push(args); return { checked: 0, sent: 0, failed: 0 }; },
    },
  });
}

const pushRequest = (body) => new Request("https://mise.invalid/api/push", {
  method: "POST",
  headers: { "content-type": "application/json", "x-mise-client": clientId, "x-mise-device": deviceId },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({
  endpoint,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});

const job = (patch = {}) => ({
  kind: "cooking", title: "Готовка", body: "Сегодня готовим первую партию.", url: "/", dueAt: Date.now() + 60_000, ...patch,
});

test("reminder setup answers a malformed body with 400 instead of failing", async () => {
  const writes = [];
  const route = await pushRoute(recordingDb(writes));
  for (const [label, body] of [
    ["JSON null", "null"],
    ["a list", "[]"],
    ["a number", "7"],
    ["a numeric plan id", { planId: 42, action: "disable" }],
    ["a job that is null", { planId: "plan", action: "enable", subscription: subscription(), jobs: [null] }],
    ["a job whose link is a number", { planId: "plan", action: "enable", subscription: subscription(), jobs: [job({ url: 5 })] }],
    ["a job whose time is text", { planId: "plan", action: "enable", subscription: subscription(), jobs: [job({ dueAt: "soon" })] }],
    ["keys that are not text", { planId: "plan", action: "enable", subscription: { endpoint: subscription().endpoint, keys: { p256dh: {}, auth: [] } }, jobs: [] }],
    ["a subscription that is text", { planId: "plan", action: "enable", subscription: "https://fcm.googleapis.com/x", jobs: [] }],
  ]) {
    const response = await route.POST(pushRequest(body));
    assert.equal(response.status, 400, label);
    assert.equal(typeof (await response.json()).error, "string", label);
  }
  assert.equal(writes.length, 0, "nothing reaches the database");
});

test("reminders are only ever posted to a public push service", async () => {
  for (const endpoint of [
    "https://localhost/push",
    "https://127.0.0.1/push",
    "https://10.0.0.5:8443/push",
    "https://[::1]/push",
    "https://intranet/push",
    "https://db.internal/push",
    "https://printer.local/push",
    "https://user:password@fcm.googleapis.com/fcm/send/abc",
    "http://fcm.googleapis.com/fcm/send/abc",
  ]) {
    const writes = [];
    const route = await pushRoute(recordingDb(writes));
    const response = await route.POST(pushRequest({ planId: "plan", action: "enable", subscription: subscription(endpoint), jobs: [job()] }));
    assert.equal(response.status, 400, endpoint);
    assert.equal(writes.length, 0, `${endpoint} is not stored`);
  }
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ]) {
    const writes = [];
    const processed = [];
    const route = await pushRoute(recordingDb(writes), processed);
    const response = await route.POST(pushRequest({ planId: "plan", action: "enable", installed: true, subscription: subscription(endpoint), jobs: [job()] }));
    assert.equal(response.status, 200, endpoint);
    const stored = writes.find((write) => write.kind === "insert" && write.table === "subscriptions");
    assert.equal(stored.value.endpoint, endpoint);
    assert.equal(processed.length, 1, "the confirmation is sent once");
  }
});

test("a storage failure is reported without its internal message", async () => {
  const push = await pushRoute(failingDb());
  const pushResponse = await push.POST(pushRequest({ planId: "plan", action: "disable" }));
  assert.equal(pushResponse.status, 500);
  assert.doesNotMatch(JSON.stringify(await pushResponse.json()), /SQLITE|secret_column|push_jobs/);

  const plans = await loadTs("app/api/plans/route.ts", {
    "drizzle-orm": drizzle,
    "../../../db": { getDb: failingDb },
    "../../../db/schema": { mealPlans: {}, pushJobs: {}, pushPreferences: {}, pushSubscriptions: {} },
    "../../../lib/plan-validation": { validatePlanForPersistence: () => ({ valid: true }) },
    "../../../domain/nutrition": { normalizeAutomaticNutritionTargets: (plan) => plan },
  });
  const headers = { "content-type": "application/json", "x-mise-client": clientId };
  for (const response of [
    await plans.GET(new Request("https://mise.invalid/api/plans", { headers })),
    await plans.POST(new Request("https://mise.invalid/api/plans", { method: "POST", headers, body: JSON.stringify({ plan: { id: "plan" } }) })),
    await plans.DELETE(new Request("https://mise.invalid/api/plans", { method: "DELETE", headers })),
  ]) {
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.doesNotMatch(JSON.stringify(body), /SQLITE|secret_column|push_jobs/);
  }
});

test("a plan is measured in stored bytes and refused before it is parsed when oversized", async () => {
  const writes = [];
  const plans = await loadTs("app/api/plans/route.ts", {
    "drizzle-orm": drizzle,
    "../../../db": { getDb: () => recordingDb(writes) },
    "../../../db/schema": { mealPlans: "plans", pushJobs: {}, pushPreferences: {}, pushSubscriptions: {} },
    "../../../lib/plan-validation": { validatePlanForPersistence: () => ({ valid: true }) },
    "../../../domain/nutrition": { normalizeAutomaticNutritionTargets: (plan) => plan },
  });
  const post = (plan, extraHeaders = {}) => plans.POST(new Request("https://mise.invalid/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mise-client": clientId, ...extraHeaders },
    body: JSON.stringify({ plan }),
  }));

  // 800,000 Cyrillic characters are 1.6 MB once stored.
  const cyrillic = await post({ id: "plan", note: "я".repeat(800_000) });
  assert.equal(cyrillic.status, 413, "two-byte text counts as two bytes");

  const latin = await post({ id: "plan", note: "a".repeat(800_000) });
  assert.equal(latin.status, 200, "the same length in one-byte text fits");

  const declared = await post({ id: "plan" }, { "content-length": "9000000" });
  assert.equal(declared.status, 413, "a declared oversize is refused outright");

  assert.equal(writes.filter((write) => write.kind === "insert").length, 1, "only the plan that fits is stored");
});

test("a body that is not a plan is refused by validation, not by a crash", async () => {
  const writes = [];
  const plans = await loadTs("app/api/plans/route.ts", {
    "drizzle-orm": drizzle,
    "../../../db": { getDb: () => recordingDb(writes) },
    "../../../db/schema": { mealPlans: "plans", pushJobs: {}, pushPreferences: {}, pushSubscriptions: {} },
    "../../../lib/plan-validation": await loadTs("lib/plan-validation.ts"),
    "../../../domain/nutrition": await loadTs("domain/nutrition.ts"),
  });
  for (const body of ["null", "7", "\"plan\"", "[]", "{}", "{\"plan\":null}", "{\"plan\":[]}"]) {
    const response = await plans.POST(new Request("https://mise.invalid/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mise-client": clientId },
      body,
    }));
    assert.equal(response.status, 400, body);
  }
  assert.equal(writes.length, 0);
});

test("a reminder that could not be delivered for hours is closed, not sent late", async () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const jobs = [
    { id: "late", kind: "cooking", dueAt: now - 7 * hour, attempts: 0, subscriptionId: "s", planId: "p", title: "t", body: "b", url: "/" },
    { id: "recent", kind: "cooking", dueAt: now - 2 * hour, attempts: 0, subscriptionId: "s", planId: "p", title: "t", body: "b", url: "/" },
  ];
  const updates = [];
  let selects = 0;
  const db = {
    select: () => {
      selects += 1;
      const first = selects === 1;
      const chain = { from: () => chain, where: () => chain, limit: () => chain, then: (resolve) => resolve(first ? jobs : []) };
      return chain;
    },
    update: () => {
      let payload;
      let target;
      const chain = {
        set: (value) => { payload = value; return chain; },
        where: (condition) => { target = condition; return chain; },
        returning: () => chain,
        then: (resolve) => {
          const id = JSON.stringify(target).match(/"(late|recent)"/)?.[1];
          updates.push({ id, payload });
          resolve(payload.leaseUntil ? [jobs.find((item) => item.id === id)] : []);
        },
      };
      return chain;
    },
    delete: () => ({ where: async () => [] }),
  };
  const sender = await loadTs("lib/push-server.ts", {
    "drizzle-orm": { ...drizzle, eq: (_column, value) => value, and: (...parts) => parts },
    "cloudflare:workers": { env: {} },
    "../db": { getDb: () => db },
    "../db/schema": { pushJobs: { id: "id" }, pushPreferences: {}, pushSubscriptions: { $inferSelect: {} } },
  }, { atob, btoa, fetch: async () => assert.fail("nothing may be sent in this test") });

  const result = await sender.processDueNotifications(now);
  assert.equal(result.sent, 0);
  const closed = updates.filter((update) => update.payload.sentAt === now);
  assert.deepEqual(
    closed.map((update) => [update.id, update.payload.lastError]),
    [["late", "expired before delivery"], ["recent", "disabled"]],
    "only the 7-hour-old reminder expires; the recent one takes the ordinary path",
  );
});
