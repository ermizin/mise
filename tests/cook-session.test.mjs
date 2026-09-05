import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const cook = await loadTypeScriptModule(new URL("../domain/cook-session.ts", import.meta.url));
const base = (overrides = {}) => ({
  version: 1,
  stepIndex: 0,
  completedStepIds: [],
  phase: "cooking",
  timers: {},
  cookedWeights: {},
  updatedAt: 100,
  ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("running timers recover their remaining time after a reload and finish by timestamp", () => {
  const state = base({ timers: { oven: { title: "Духовка", status: "running", endsAt: 2_000, remainingMs: 9_000 } } });
  assert.equal(cook.timerRemainingMs(state.timers.oven, 1_250), 750);
  assert.deepEqual(plain(cook.refreshCookSessionTimers(state, 2_100).timers.oven), {
    title: "Духовка", status: "done", endsAt: null, remainingMs: 0,
  });
});

test("pausing freezes the measured remaining time and resume creates a fresh deadline", () => {
  const running = base({ timers: { sauce: { title: "Соус", status: "running", endsAt: 10_000, remainingMs: 10_000 } } });
  const paused = cook.pauseCookSessionTimer(running, "sauce", 4_000);
  assert.deepEqual(plain(paused.timers.sauce), { title: "Соус", status: "paused", endsAt: null, remainingMs: 6_000 });
  assert.equal(cook.timerRemainingMs(paused.timers.sauce, 9_000), 6_000);
  assert.deepEqual(plain(cook.startCookSessionTimer(paused, "sauce", 9_000).timers.sauce), {
    title: "Соус", status: "running", endsAt: 15_000, remainingMs: 6_000,
  });
});

test("corrupt durable data falls back safely and weighted completion uses UI weights", () => {
  const fallback = base({ stepIndex: 2 });
  const envelope = cook.normalizeCookSessionEnvelope("not an envelope", fallback, 100);
  assert.deepEqual(plain(envelope.state), plain(fallback));
  const state = base({ completedStepIds: ["prep", "prep", 42], timers: { bad: { title: "", remainingMs: "bad" } } });
  const normalized = cook.normalizeCookSessionState(state, 100);
  assert.deepEqual(plain(normalized.completedStepIds), ["prep"]);
  assert.deepEqual(plain(normalized.timers), {});
  assert.equal(cook.weightedCookSessionCompletion(normalized, [{ id: "prep", weight: 3 }, { id: "cook", weight: 1 }]), 0.75);
});

test("durable in-flight A survives B and ACK rebases B only after A is known accepted", () => {
  const initial = cook.normalizeCookSessionEnvelope(null, base(), 100);
  const a = base({ stepIndex: 1, updatedAt: 101 });
  const withA = cook.beginCookSessionRequest(cook.queueCookSessionUpdate(initial, a, "mutation-a"));
  const b = base({ stepIndex: 2, updatedAt: 102 });
  const withB = cook.queueCookSessionUpdate(withA, b, "mutation-b");
  assert.equal(withB.inFlight.mutationId, "mutation-a");
  assert.equal(withB.pending.mutationId, "mutation-b");
  const afterA = cook.acknowledgeCookSessionMutation(withB, "mutation-a", a, 1);
  assert.equal(afterA.inFlight, null);
  assert.equal(afterA.pending.mutationId, "mutation-b");
  assert.equal(afterA.pending.revision, 1);
  assert.equal(afterA.state.stepIndex, 2);
});

test("a GET cannot silently rebase unsent work onto a newer unrelated server revision", () => {
  const initial = cook.normalizeCookSessionEnvelope(null, base(), 100);
  const local = cook.beginCookSessionRequest(cook.queueCookSessionUpdate(
    initial,
    base({ stepIndex: 1, updatedAt: 101 }),
    "mutation-a",
  ));
  const result = cook.reconcileCookSessionLoad(
    local,
    base({ stepIndex: 9, updatedAt: 102 }),
    4,
    "other-device-mutation",
  );
  assert.equal(result.conflict.revision, 4);
  assert.equal(result.inFlight.mutationId, "mutation-a");
  assert.equal(result.state.stepIndex, 1);
});

test("reload preserves an expired running timer byte-for-byte in durable outbox", () => {
  const running = base({ timers: { oven: { title: "Духовка", status: "running", endsAt: 2_000, remainingMs: 1_000 } } });
  const envelope = cook.normalizeCookSessionEnvelope({
    version: 1, state: running, revision: 0, mutationId: null,
    inFlight: { state: running, revision: 0, mutationId: "mutation-a" }, pending: null,
  }, base(), 5_000);
  assert.equal(envelope.state.timers.oven.status, "running");
  assert.equal(envelope.inFlight.state.timers.oven.endsAt, 2_000);
  assert.deepEqual(JSON.parse(JSON.stringify(envelope.inFlight.state.timers.oven)), running.timers.oven);
  assert.equal(cook.timerRemainingMs(envelope.state.timers.oven, 5_000), 0);
});

test("a transport failure leaves the retry request unchanged until its later ACK", () => {
  const initial = cook.normalizeCookSessionEnvelope(null, base(), 100);
  const changed = base({ stepIndex: 3, updatedAt: 103 });
  const request = cook.beginCookSessionRequest(cook.queueCookSessionUpdate(initial, changed, "retry-same-id"));
  // A failed fetch is deliberately a no-op on the durable envelope: retry must
  // send this exact revision, mutation id and timestamped timer payload again.
  assert.deepEqual(plain(request.inFlight), {
    state: changed, revision: 0, mutationId: "retry-same-id",
  });
  const accepted = cook.acknowledgeCookSessionMutation(request, "retry-same-id", changed, 1);
  assert.equal(accepted.inFlight, null);
  assert.equal(accepted.revision, 1);
});


test("a successful late GET cannot roll back a newer acknowledged write", () => {
  const current = cook.normalizeCookSessionEnvelope({version:1,state:base({stepIndex:3}),revision:8,mutationId:"saved-new",pending:null,inFlight:null},base(),100);
  const loaded = cook.reconcileCookSessionLoad(current,base({stepIndex:1}),7,"saved-old");
  assert.equal(loaded.revision,8);
  assert.equal(loaded.state.stepIndex,3);
});
