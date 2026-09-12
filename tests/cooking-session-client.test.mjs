import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const epoch = Date.UTC(2026, 8, 12, 12, 0, 0);
const heatEndsAt = epoch + 10_000;

async function loadClient() {
  const modules = {};
  for (const path of ["domain/cooking/validate", "domain/cooking/schedule", "domain/cooking/replan", "lib/cooking-session-client"]) {
    const url = new URL(`${path}.ts`, root);
    const compiledModule = { exports: {} };
    const source = await readFile(url, "utf8");
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      module: compiledModule, exports: compiledModule.exports,
      require: id => modules[id] ?? createRequire(url)(id),
      Map, Math, Set, Object, Array, JSON, Promise, Error,
      crypto: { randomUUID: () => "generated-id" },
    }, { filename: url.pathname });
    modules[`./${path.split("/").at(-1)}`] = compiledModule.exports;
    modules[`../domain/cooking/${path.split("/").at(-1)}`] = compiledModule.exports;
  }
  return modules["./cooking-session-client"];
}

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function session() {
  const prep = { id: "prep", recipeId: "r", methodId: "original", kind: "prep", title: "Prep", dependsOn: [], durationSeconds: 5, attention: "required", resources: [{ resourceId: "cook", kind: "cook" }], allocations: [], sourceStepIndexes: [0] };
  const heat = { id: "heat", recipeId: "r", methodId: "original", kind: "heat", title: "Heat", dependsOn: ["prep"], durationSeconds: 10, attention: "background", resources: [{ resourceId: "pot", kind: "pot" }], allocations: [], sourceStepIndexes: [1], requiresCheckAtEnd: true };
  const input = { sessionId: "session", planId: "plan", pace: "speed", recipes: [{ dishKey: "dish", recipeId: "r", methodId: "original", personIds: ["person"], sourceStepsChecksum: "source" }], kitchen: { resources: [{ id: "cook", kind: "cook" }, { id: "pot", kind: "pot" }] } };
  const compiled = { id: "session", input, operations: [prep, heat], diagnostics: [] };
  return { input, compiled, schedule: { mode: "sequential", entries: [], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: true, diagnostics: [] }, execution: { revision: 0, statusByOperation: { prep: "completed", heat: "pending" }, events: [], startedAtByOperation: {}, endsAtByOperation: {} } };
}

function options(overrides = {}) {
  return { fetch: async () => { throw new TypeError("offline"); }, storage: storage(), clientId: () => "client", now: () => epoch, key: "cook", planId: "plan", batchId: "batch", signature: "sig", planSnapshotSignature: "plan-sig", ...overrides };
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serverAfterStart(base, event) {
  const next = structuredClone(base);
  next.execution = {
    revision: 1,
    statusByOperation: { prep: "completed", heat: "active" },
    events: [event],
    startedAtByOperation: { heat: event.occurredAt },
    endsAtByOperation: { heat: event.endsAt },
  };
  return next;
}

test("offline create and start preserve the absolute heat anchor after reload", async () => {
  const { createCookingSessionClient } = await loadClient();
  const config = options();
  const client = createCookingSessionClient(config);
  await assert.rejects(client.create(session(), { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  client.enqueue({ id: "start-heat", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  const restored = createCookingSessionClient(config);
  const snapshot = restored.restore();
  assert.equal(snapshot.session.execution.endsAtByOperation.heat, heatEndsAt);
  assert.equal(snapshot.pending[0].mutationId, "start-heat");
});

test("invalid dependent action is rejected before storage or network", async () => {
  const { createCookingSessionClient } = await loadClient();
  const config = options();
  const client = createCookingSessionClient(config);
  const invalid = session();
  invalid.execution.statusByOperation.prep = "pending";
  await assert.rejects(client.create(invalid, { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  assert.throws(() => client.enqueue({ id: "heat", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt }), /Сначала завершите/);
  assert.equal(client.snapshot().pending.length, 0);
});

test("storage failure leaves the in-memory snapshot unchanged", async () => {
  const { createCookingSessionClient } = await loadClient();
  const config = options({ storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
  const client = createCookingSessionClient(config);
  await assert.rejects(client.create(session(), { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  assert.equal(client.snapshot().session, null);
});

test("offline provisional session retries PUT, then posts the pending start exactly once", async () => {
  const { createCookingSessionClient } = await loadClient();
  const base = session();
  let online = false;
  let puts = 0;
  let posts = 0;
  const fetch = async (_url, init) => {
    if (init.method === "PUT") {
      puts += 1;
      if (!online) throw new TypeError("offline");
      return reply({ session: base, revision: 0 });
    }
    posts += 1;
    const request = JSON.parse(init.body);
    return reply({ session: serverAfterStart(base, request.event), revision: 1 });
  };
  const client = createCookingSessionClient(options({ fetch }));
  await assert.rejects(client.create(base, { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  online = true;
  client.enqueue({ id: "start", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  await client.sync();
  assert.equal(puts, 2);
  assert.equal(posts, 1);
  assert.equal(client.snapshot().pending.length, 0);
  assert.equal(client.snapshot().session.execution.endsAtByOperation.heat, heatEndsAt);
});

test("refresh restores a same-signature session from another device", async () => {
  const { createCookingSessionClient } = await loadClient();
  const remote = serverAfterStart(session(), { id: "remote-start", type: "started", opId: "heat", occurredAt: epoch + 40_000, endsAt: epoch + 50_000 });
  const client = createCookingSessionClient(options({
    fetch: async () => reply({ session: remote, revision: 7, signature: "sig", planSnapshotSignature: "plan-sig" }),
  }));
  const restored = await client.refresh();
  assert.equal(restored.revision, 7);
  assert.equal(restored.session.execution.endsAtByOperation.heat, epoch + 50_000);
});

test("acknowledging the first queued action replays the second and preserves its timer", async () => {
  const { createCookingSessionClient } = await loadClient();
  const base = session();
  let releaseFirst;
  const firstPost = new Promise(resolve => { releaseFirst = resolve; });
  let postCount = 0;
  const fetch = async (_url, init) => {
    if (init.method === "PUT") return reply({ session: base, revision: 0 });
    postCount += 1;
    if (postCount === 1) return firstPost;
    throw new TypeError("offline after first ack");
  };
  const client = createCookingSessionClient(options({ fetch }));
  await client.create(base, { operationIds: ["prep", "heat"], recipeIds: ["r"] });
  client.enqueue({ id: "start", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  client.enqueue({ id: "pause", type: "paused", occurredAt: epoch + 1_000 });
  releaseFirst(reply({ session: serverAfterStart(base, { id: "start", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt }), revision: 1 }));
  await client.sync();
  const current = client.snapshot();
  assert.equal(current.pending.length, 1);
  assert.equal(current.pending[0].mutationId, "pause");
  assert.equal(current.session.execution.endsAtByOperation.heat, heatEndsAt);
  assert.equal(current.session.execution.pausedAt, epoch + 1_000);
});

test("same mutation id with a different action is rejected locally", async () => {
  const { createCookingSessionClient } = await loadClient();
  const base = session();
  const client = createCookingSessionClient(options());
  await assert.rejects(client.create(base, { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  client.enqueue({ id: "same", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  assert.throws(() => client.enqueue({ id: "same", type: "paused", occurredAt: epoch + 1_000 }), /Идентификатор события/);
  assert.equal(client.snapshot().pending.length, 1);
});

test("source mismatch retains local timer and requires explicit user action", async () => {
  const { createCookingSessionClient } = await loadClient();
  const base = session();
  let refresh = false;
  const client = createCookingSessionClient(options({
    fetch: async (_url, init) => {
      if (init.method === "PUT") throw new TypeError("offline");
      if (!refresh) throw new TypeError("offline");
      return reply({ session: session(), revision: 9, signature: "different", planSnapshotSignature: "plan-sig" });
    },
  }));
  await assert.rejects(client.create(base, { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  client.enqueue({ id: "start", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  refresh = true;
  const current = await client.refresh();
  assert.equal(current.requiresUserAction, "source_changed");
  assert.equal(current.session.execution.endsAtByOperation.heat, heatEndsAt);
});

test("invalid cached JSON reports the cache problem without inventing a session", async () => {
  const { createCookingSessionClient } = await loadClient();
  const client = createCookingSessionClient(options({ storage: { getItem: () => "{", setItem: () => {} } }));
  const current = client.restore();
  assert.equal(current.session, null);
  assert.equal(current.requiresUserAction, "local_state_invalid");
});

test("valid JSON with an incomplete envelope is rejected before it can render a timer", async () => {
  const { createCookingSessionClient } = await loadClient();
  const incomplete = JSON.stringify({
    session: { input: {}, compiled: { id: "session", operations: [] }, execution: { events: [] } },
    revision: 0, signature: "sig", planSnapshotSignature: "plan-sig", pending: [],
  });
  const client = createCookingSessionClient(options({ storage: { getItem: () => incomplete, setItem: () => {} } }));
  const current = client.restore();
  assert.equal(current.session, null);
  assert.equal(current.requiresUserAction, "local_state_invalid");
});

test("non-finite cached timer anchors are rejected instead of restored", async () => {
  const { createCookingSessionClient } = await loadClient();
  const corrupt = { session: session(), revision: 0, signature: "sig", planSnapshotSignature: "plan-sig", pending: [] };
  corrupt.session.execution.endsAtByOperation.heat = Infinity;
  const client = createCookingSessionClient(options({ storage: { getItem: () => JSON.stringify(corrupt), setItem: () => {} } }));
  const current = client.restore();
  assert.equal(current.session, null);
  assert.equal(current.requiresUserAction, "local_state_invalid");
});

test("changed server plan snapshot retains local timer and requires review", async () => {
  const { createCookingSessionClient } = await loadClient();
  const base = session();
  let refresh = false;
  const client = createCookingSessionClient(options({
    fetch: async (_url, init) => {
      if (init.method === "PUT") throw new TypeError("offline");
      if (!refresh) throw new TypeError("offline");
      return reply({ session: base, revision: 8, signature: "sig", planSnapshotSignature: "changed-plan" });
    },
  }));
  await assert.rejects(client.create(base, { operationIds: ["prep", "heat"], recipeIds: ["r"] }));
  client.enqueue({ id: "start", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  refresh = true;
  const current = await client.refresh();
  assert.equal(current.requiresUserAction, "source_changed");
  assert.equal(current.session.execution.endsAtByOperation.heat, heatEndsAt);
});

test("explicit server resolution replaces a stale-conflict queue with server anchors", async () => {
  const { createCookingSessionClient } = await loadClient();
  const local = session();
  const remote = serverAfterStart(session(), { id: "remote", type: "started", opId: "heat", occurredAt: epoch + 20_000, endsAt: epoch + 30_000 });
  const client = createCookingSessionClient(options({
    fetch: async (_url, init) => init.method === "PUT"
      ? reply({ session: local, revision: 0 })
      : reply({ session: remote, revision: 9, signature: "sig", planSnapshotSignature: "plan-sig" }),
  }));
  await client.create(local, { operationIds: ["prep", "heat"], recipeIds: ["r"] });
  client.enqueue({ id: "local", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  const resolved = await client.resolveFromServer();
  assert.equal(resolved.revision, 9);
  assert.equal(resolved.pending.length, 0);
  assert.equal(resolved.session.execution.endsAtByOperation.heat, epoch + 30_000);
  assert.equal(resolved.requiresUserAction, undefined);
});

test("server resolution never discards local pending actions for a mismatched source", async () => {
  const { createCookingSessionClient } = await loadClient();
  const local = session();
  const client = createCookingSessionClient(options({
    fetch: async () => reply({ session: session(), revision: 9, signature: "other", planSnapshotSignature: "plan-sig" }),
  }));
  await client.create(local, { operationIds: ["prep", "heat"], recipeIds: ["r"] });
  client.enqueue({ id: "local", type: "started", opId: "heat", occurredAt: epoch, endsAt: heatEndsAt });
  const resolved = await client.resolveFromServer();
  assert.equal(resolved.requiresUserAction, "source_changed");
  assert.equal(resolved.pending[0].mutationId, "local");
  assert.equal(resolved.session.execution.endsAtByOperation.heat, heatEndsAt);
});

test("deeply malformed cached operations are rejected before UI state is restored", async () => {
  const { createCookingSessionClient } = await loadClient();
  const corrupt = { session: session(), revision: 0, signature: "sig", planSnapshotSignature: "plan-sig", pending: [] };
  corrupt.session.compiled.operations = [{}];
  const client = createCookingSessionClient(options({ storage: { getItem: () => JSON.stringify(corrupt), setItem: () => {} } }));
  const restored = client.restore();
  assert.equal(restored.session, null);
  assert.equal(restored.requiresUserAction, "local_state_invalid");
});
