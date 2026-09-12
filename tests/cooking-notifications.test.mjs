import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const epoch = Date.UTC(2026, 8, 12, 12, 0, 0);

async function loadNotifications(db) {
  const url = new URL("lib/cooking-notifications.ts", root);
  const source = await readFile(url, "utf8");
  const compiledModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams, JSON, Array, Math, Date,
    require: id => ({
      "drizzle-orm": { and: (...items) => items, eq: (...items) => items },
      "../db": { getDb: () => db },
      "../db/schema": { cookingSessions: {}, pushJobs: {}, pushPreferences: {}, pushSubscriptions: {} },
      "./cooking-session-store": { cookingSessionStorageId: (client, plan, batch) => `${client}:${plan}:${batch}` },
    }[id] ?? createRequire(url)(id)),
  }, { filename: url.pathname });
  return compiledModule.exports;
}

function envelope({ status = "active", endsAt = epoch + 10_000, revision = 1 } = {}) {
  return {
    compiled: { id: "session", operations: [
      { id: "heat", kind: "heat", attention: "background", title: "Запекайте", durationSeconds: 10 },
      { id: "prep", kind: "prep", attention: "required", title: "Нарежьте", durationSeconds: 5 },
    ] },
    execution: { revision, statusByOperation: { heat: status, prep: "completed" }, endsAtByOperation: { heat: endsAt }, events: [] },
  };
}

function dbWith({ preferences = [], subscriptions = [], row } = {}) {
  let selects = 0;
  const inserts = [];
  return {
    inserts,
    select: () => {
      selects += 1;
      const index = selects;
      const value = row && !preferences.length && !subscriptions.length ? [row]
        : index === 1 ? preferences : [subscriptions[index - 2]].filter(Boolean);
      return { from: () => ({ where: () => ({
        then: resolve => Promise.resolve(value).then(resolve),
        limit: async () => value,
      }) }) };
    },
    insert: () => ({ values: values => ({ onConflictDoNothing: async () => { inserts.push(values); } }) }),
  };
}

test("jobs resourceUse an absolute timer and never complete an expired operation", async () => {
  const notifications = await loadNotifications(dbWith());
  const source = envelope({ status: "needs_check" });
  const [job] = notifications.cookingStepJobs("sub", "plan", "batch", source);
  assert.equal(job.dueAt, epoch + 10_000);
  assert.equal(source.execution.statusByOperation.heat, "needs_check");
  assert.match(job.url, /^\/\?tab=week&planId=plan.*batchId=batch.*sessionId=session.*opId=heat.*endsAt=/);
});

test("extension produces a new deterministic job and invalidates the old anchor", async () => {
  const oldEnvelope = envelope({ endsAt: epoch + 10_000, revision: 1 });
  const extended = envelope({ endsAt: epoch + 20_000, revision: 2 });
  const db = dbWith({ row: { id: "owner:plan:batch", clientId: "owner", revision: 2, payload: JSON.stringify({ ...extended, input: { sessionId: "session" } }) } });
  const notifications = await loadNotifications(db);
  const [oldJob] = notifications.cookingStepJobs("sub", "plan", "batch", oldEnvelope);
  const [newJob] = notifications.cookingStepJobs("sub", "plan", "batch", extended);
  assert.notEqual(oldJob.id, newJob.id);
  assert.equal(await notifications.currentCookingStepJob("owner", oldJob), false);
  assert.equal(await notifications.currentCookingStepJob("owner", newJob), true);
});

test("unrelated later revision preserves a heat job, while completion invalidates it", async () => {
  const active = envelope({ endsAt: epoch + 10_000, revision: 1 });
  const db = dbWith({ row: { id: "owner:plan:batch", clientId: "owner", revision: 2, payload: JSON.stringify({ ...active, execution: { ...active.execution, revision: 2 }, input: { sessionId: "session" } }) } });
  const notifications = await loadNotifications(db);
  const [job] = notifications.cookingStepJobs("sub", "plan", "batch", active);
  assert.equal(await notifications.currentCookingStepJob("owner", job), true);

  db.select = () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner:plan:batch", clientId: "owner", revision: 3, payload: JSON.stringify({ ...active, execution: { ...active.execution, revision: 3, statusByOperation: { ...active.execution.statusByOperation, heat: "completed" } }, input: { sessionId: "session" } }) }] }) }) });
  assert.equal(await notifications.currentCookingStepJob("owner", job), false);
});

test("repeated sync does not duplicate jobs, opted-out and wrong-owner subscriptions receive none", async () => {
  const enabledDb = dbWith({ preferences: [{ subscriptionId: "sub" }], subscriptions: [{ id: "sub", clientId: "owner" }] });
  const notifications = await loadNotifications(enabledDb);
  const jobs = notifications.cookingStepJobs("sub", "plan", "batch", envelope());
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, notifications.cookingStepJobs("sub", "plan", "batch", envelope())[0].id);
  await notifications.syncCookingStepNotifications("owner", "plan", "batch", envelope(), epoch);
  assert.equal(enabledDb.inserts.length, 1);

  const optedOut = await loadNotifications(dbWith());
  assert.equal((await optedOut.syncCookingStepNotifications("owner", "plan", "batch", envelope(), epoch)).scheduled, 0);
  const wrongOwnerDb = dbWith({ preferences: [{ subscriptionId: "sub" }], subscriptions: [{ id: "sub", clientId: "other" }] });
  const wrongOwner = await loadNotifications(wrongOwnerDb);
  assert.equal((await wrongOwner.syncCookingStepNotifications("owner", "plan", "batch", envelope(), epoch)).scheduled, 0);
  assert.equal(wrongOwnerDb.inserts.length, 0);
});
