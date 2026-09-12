import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const clientId = "12345678-1234-1234-1234-123456789abc";
const now = Date.now();

async function loadTs(path, dependencies = {}) {
  const url = new URL(path, root);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    module: compiledModule, exports: compiledModule.exports, Response, Request, URL, TextEncoder, Date, JSON, Array, Map, Set, Object, Math,
    require: id => dependencies[id] ?? createRequire(url)(id),
  }, { filename: url.pathname });
  return compiledModule.exports;
}

function input() {
  return {
    sessionId: "session", planId: "plan", pace: "speed",
    recipes: [{ dishKey: "dish", recipeId: "recipe", methodId: "original", personIds: ["person"], cookingAmounts: { ingredient: { amount: 100, unit: "g", canonicalId: "ingredient" } }, sourceStepsChecksum: "source" }],
    kitchen: { resources: [{ id: "cook", kind: "cook" }] },
  };
}

function createBody(operationId = "server-op") {
  const sessionInput = input();
  return {
    sessionId: "session", planId: "plan", batchId: "batch", signature: "sig", planSnapshotSignature: "snap",
    graph: { operationIds: [operationId], recipeIds: ["recipe"] },
    session: { input: sessionInput, compiled: { id: "session", operations: [{ id: operationId }] } },
  };
}

function request(method, body) {
  return new Request("https://mise.invalid/api/cooking-session", {
    method, headers: { "content-type": "application/json", "x-mise-client": clientId }, body: JSON.stringify(body),
  });
}

function context() {
  return {
    cookingDishContext: recipe => recipe && typeof recipe === "object" ? {
      dishKey: recipe.dishKey, recipeId: recipe.recipeId, methodId: recipe.methodId, personIds: recipe.personIds, cookingAmounts: recipe.cookingAmounts,
    } : null,
    plannedCookingDishes: () => [{ dishKey: "dish", recipeId: "recipe", methodId: "original", personIds: ["person"] }],
    cookingPlanSnapshotSignature: () => "snap",
    cookingPlanSnapshotMatches: signature => signature === "snap",
  };
}

function dbFor({ plan = { batches: [{ id: "batch" }] }, row, newest, writes, casChanges = 1 }) {
  let reads = 0;
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => {
      reads += 1;
      const value = reads === 1 ? (plan ? { payload: JSON.stringify(plan) } : undefined) : reads === 2 ? row : newest ?? row;
      return value ? [value] : [];
    } }) }) }),
    update: () => ({ set: () => ({ where: async () => { writes.push("cas"); return { meta: { changes: casChanges } }; } }) }),
    insert: () => ({ values: async () => { writes.push("insert"); } }),
  };
}

async function routeWith({ plan, row, newest, compiled, sourceSignature = "sig", writes = [], casChanges, notifications, applied } = {}) {
  const store = await loadTs("lib/cooking-session-store.ts");
  const protocol = await loadTs("lib/cooking-session-protocol.ts");
  const db = dbFor({ plan, row, newest, writes, casChanges });
  return {
    route: await loadTs("app/api/cooking-session/route.ts", {
      "drizzle-orm": { and: (...items) => items, eq: (...items) => items },
      "../../../db": { getDb: () => db },
      "../../../db/schema": { cookingSessions: {}, mealPlans: {} },
      "../../../lib/cooking-session-store": store,
      "../../../lib/cooking-session-context": context(),
      "../../../lib/cooking-plan-resolver": { resolvePlannedCookingRecipes: () => input().recipes },
      "../../../lib/cooking-session-protocol": protocol,
      "../../../lib/cooking-notifications": { syncCookingStepNotifications: notifications ?? (async () => ({ scheduled: 0 })) },
      "../../../domain/cooking/compile": { compileCookingSession: sessionInput => compiled ?? { id: "session", input: sessionInput, operations: [{ id: "server-op" }], diagnostics: [] } },
      "../../../domain/cooking/schedule": { scheduleCookingSession: () => ({ entries: [{ opId: "server-op", startAt: 0, endAt: 1 }], diagnostics: [] }) },
      "../../../domain/cooking/source": { cookingSourceSignature: async () => sourceSignature },
      "../../../domain/cooking/replan": { initialCookingExecution: () => ({ events: [], statusByOperation: {} }), applyCookingEvent: applied ?? ((_compiled, execution, event) => ({ execution: { ...execution, revision: execution.revision + 1, events: [...execution.events, event] }, schedule: { entries: [] }, diagnostics: [] })) },
    }), writes,
  };
}

test("create and mutation validators reject malformed client payloads", async () => {
  const { validateCookingSessionCreate, validateCookingSessionMutation } = await loadTs("lib/cooking-session-store.ts");
  assert.equal(validateCookingSessionCreate({}), null);
  assert.equal(validateCookingSessionMutation({}), null);
  const { route } = await routeWith();
  const response = await route.PUT(new Request("https://mise.invalid/api/cooking-session", { method: "PUT", body: "{}" }));
  assert.equal(response.status, 400);
});

test("route hides foreign plans before compiling a submitted graph", async () => {
  const { route } = await routeWith({ plan: null });
  const response = await route.PUT(request("PUT", createBody()));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "plan or batch not found" });
});

test("server compilation and source signature reject forged create requests", async () => {
  const forged = await routeWith();
  const graphResponse = await forged.route.PUT(request("PUT", createBody("client-op")));
  assert.equal(graphResponse.status, 422);
  assert.equal((await graphResponse.json()).error, "submitted graph differs from server compilation");

  const source = await routeWith({ sourceSignature: "other-source" });
  const sourceResponse = await source.route.PUT(request("PUT", createBody()));
  assert.equal(sourceResponse.status, 422);
  assert.equal((await sourceResponse.json()).error, "source or schedule validation failed");
});

function stored(event = undefined, revision = 3) {
  const sessionInput = input();
  const execution = { revision, statusByOperation: {}, events: event ? [event] : [] };
  return {
    id: `${clientId}:plan:batch`, signature: "sig", planSnapshotSignature: "snap", revision,
    graph: JSON.stringify({ operationIds: ["server-op"], recipeIds: ["recipe"] }),
    payload: JSON.stringify({ input: sessionInput, compiled: { id: "session", operations: [{ id: "server-op" }] }, execution }),
  };
}

function mutation(event, expectedRevision = 3) {
  return { sessionId: "session", planId: "plan", batchId: "batch", expectedRevision, mutationId: event.id, event: { ...event, id: undefined } };
}

test("lost-ack duplicate returns current state without a second CAS, while reused id conflicts", async () => {
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const writes = [];
  const accepted = await routeWith({ row: stored(event), writes });
  const acceptedResponse = await accepted.route.POST(request("POST", mutation(event)));
  assert.equal(acceptedResponse.status, 200);
  assert.equal(writes.length, 0);

  const conflict = await routeWith({ row: stored(event), writes: [] });
  const conflictResponse = await conflict.route.POST(request("POST", mutation({ ...event, endsAt: event.endsAt + 1 })));
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).error, "mutation id was used for a different action");
});

test("stale expected revision returns 409 before CAS write", async () => {
  const writes = [];
  const { route } = await routeWith({ row: stored(undefined, 3), writes });
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const response = await route.POST(request("POST", mutation(event, 2)));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "cooking session changed");
  assert.equal(writes.length, 0);
});

test("stale plan snapshot returns 409 before CAS write", async () => {
  const writes = [];
  const row = stored();
  row.planSnapshotSignature = "old-snapshot";
  const { route } = await routeWith({ row, writes });
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const response = await route.POST(request("POST", mutation(event)));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "cooking session source changed");
  assert.equal(writes.length, 0);
});

test("CAS persists execution before a notification enqueue failure, then accepted retry repairs without CAS", async () => {
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const writes = [];
  const first = await routeWith({
    row: stored(), writes,
    notifications: async () => { throw new Error("notification unavailable"); },
  });
  const failed = await first.route.POST(request("POST", mutation(event)));
  assert.equal(failed.status, 500);
  assert.equal(writes.length, 1, "the action CAS completed before retryable notification work");

  const repairedWrites = [];
  const repaired = await routeWith({ row: stored(event, 4), writes: repairedWrites });
  const retry = await repaired.route.POST(request("POST", mutation(event, 3)));
  assert.equal(retry.status, 200);
  assert.equal(repairedWrites.length, 0, "accepted retry must not apply a second CAS");
});

test("successful POST returns the persisted execution payload", async () => {
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const { route } = await routeWith({ row: stored() });
  const response = await route.POST(request("POST", mutation(event)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revision, 4);
  assert.equal(body.session.execution.events[0].id, "start");
  assert.equal(body.session.execution.events[0].endsAt, now + 10_000);
});

test("a concurrent CAS loss returns the actual newest session", async () => {
  const event = { id: "start", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 10_000 };
  const current = stored(undefined, 3);
  const newest = stored({ ...event, id: "other" }, 4);
  const writes = [];
  const { route } = await routeWith({ row: current, newest, writes, casChanges: 0 });
  const response = await route.POST(request("POST", mutation(event)));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.current.revision, 4);
  assert.equal(body.current.session.execution.events[0].id, "other");
  assert.equal(writes.length, 1);
});


test("new configuration requests send no recipe quantities or compiled graph", async () => {
  const { route, writes } = await routeWith();
  const sessionInput = input();
  const body = { schemaVersion: 2, sessionId: "session", planId: "plan", batchId: "batch",
    sources: sessionInput.recipes.map(({dishKey, recipeId, methodId, sourceStepsChecksum}) => ({dishKey, recipeId, methodId, sourceStepsChecksum})),
    configuration: { kitchen: sessionInput.kitchen, pace: sessionInput.pace },
  };
  const response = await route.PUT(request("PUT", body));
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.deepEqual(saved.session.input.recipes, sessionInput.recipes);
  assert.deepEqual(writes, ["insert"]);
  body.sources[0].sourceStepsChecksum = "outdated";
  assert.equal((await (await routeWith()).route.PUT(request("PUT", body))).status, 409);
});

test("legacy create cannot forge quantities even with a matching client signature", async () => {
  const { route, writes } = await routeWith();
  const body = createBody();
  body.session.input.recipes[0].cookingAmounts.ingredient.amount = 999;
  const response = await route.PUT(request("PUT", body));
  assert.equal(response.status, 422);
  assert.deepEqual(writes, []);
});


test("oversized durable event snapshot is rejected before CAS and preserves the current graph", async () => {
  const writes = [];
  const oversized = stored();
  const session = JSON.parse(oversized.payload);
  session.padding = "x".repeat(1_800_000);
  oversized.payload = JSON.stringify(session);
  const { route } = await routeWith({ row: oversized, writes });
  const response = await route.POST(request("POST", mutation({ id: "new", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 1000 })));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "cooking session storage limit reached");
  assert.deepEqual(writes, []);
});

test("durable bounds count UTF-8 bytes and allow a near-limit CAS", async () => {
  for (const [padding, status] of [["x".repeat(1_700_000), 200], ["я".repeat(950_000), 422]]) {
    const writes = [], row = stored(), session = JSON.parse(row.payload);
    session.padding = padding;
    row.payload = JSON.stringify(session);
    const { route } = await routeWith({ row, writes });
    const response = await route.POST(request("POST", mutation({ id: "new", type: "started", opId: "server-op", occurredAt: now, endsAt: now + 1000 })));
    assert.equal(response.status, status);
    assert.deepEqual(writes, status === 200 ? ["cas"] : []);
  }
});

test("create reserves future event storage before writing a large graph", async () => {
  const writes = [], sessionInput = input();
  const compiled = { id: "session", input: sessionInput, operations: [{ id: "server-op", sourceText: "x".repeat(1_799_000) }], diagnostics: [] };
  const { route } = await routeWith({ compiled, writes });
  const response = await route.PUT(request("PUT", createBody()));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /split the batch/);
  assert.deepEqual(writes, []);
});


test("plan signatures normalize implicit assignments but preserve old sessions and detect actual changes", async () => {
  const { cookingPlanSnapshotSignature, cookingPlanSnapshotMatches, plannedCookingDishes } = await loadTs("lib/cooking-session-context.ts");
  const implicit = { id: "plan", batches: [{id: "batch", days: 1}], mealSlots: ["dinner"], people: [{id: "p", includedSlots: ["dinner"], daily: {kcal: 2000}}], selections: {"batch:dinner": "recipe"} };
  const explicit = {...implicit, selectionAssignments: {"batch:dinner": [{recipeId: "recipe", personIds: ["p"]}]}};
  const dishes = plannedCookingDishes(implicit, "batch");
  assert.equal(cookingPlanSnapshotSignature(implicit, "batch", dishes), cookingPlanSnapshotSignature(explicit, "batch", dishes));
  const legacy = cookingPlanSnapshotSignature(implicit, "batch", dishes, true);
  assert.ok(cookingPlanSnapshotMatches(legacy, implicit, "batch", dishes));
  assert.ok(cookingPlanSnapshotMatches(legacy, explicit, "batch", dishes));
  const changed = structuredClone(implicit); changed.people[0].daily.kcal = 2400;
  assert.equal(cookingPlanSnapshotMatches(legacy, changed, "batch", dishes), false);
});
