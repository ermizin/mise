import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);

async function loadServer() {
  const url = new URL("lib/cook-session-server.ts", root);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports, require: createRequire(url), TextEncoder, crypto };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}

function state(now) {
  return {
    version: 1, stepIndex: 2, completedStepIds: ["prep-veg"], phase: "cooking",
    timers: { "sear-chicken": { endsAt: now + 60_000, remainingMs: 60_000, status: "running", title: "Обжарьте курицу" } },
    cookedWeights: { "chicken-rice": { chicken: 500, rice: 240 } }, updatedAt: now,
  };
}

test("accepts the bounded versioned cooking-session state", async () => {
  const server = await loadServer();
  const now = Date.now();
  assert.equal(server.validateCookState(state(now), now), true);
  assert.equal(server.validOpaqueId("5b:plan-1:batch-1:fingerprint", 80), true);
  assert.equal(server.validMutationId("8ad84a02-8c43-4eff-81ec-82dd8a256919"), true);
  assert.equal(server.validOpaqueId(`lunch:recipe:${"person-uuid:".repeat(28)}0`, 512), true);
});

test("rejects timer states that cannot be safely scheduled", async () => {
  const server = await loadServer();
  const now = Date.now();
  const pausedWithDueAt = state(now);
  pausedWithDueAt.timers["sear-chicken"].status = "paused";
  assert.equal(server.validateCookState(pausedWithDueAt, now), false);
  const unbounded = state(now);
  unbounded.timers["sear-chicken"].remainingMs = 25 * 60 * 60 * 1000;
  assert.equal(server.validateCookState(unbounded, now), false);
  const resumedLate = state(now);
  resumedLate.timers["sear-chicken"].endsAt = now - 24 * 60 * 60 * 1000;
  resumedLate.timers["sear-chicken"].title = "Инструкция ".repeat(150);
  assert.equal(server.validateCookState(resumedLate, now), true, "offline resume can retain an old timer for stale-guarded cleanup");
});

test("timer job tags are session-scoped and parse only safe ids", async () => {
  const server = await loadServer();
  const sessionId = "a".repeat(64);
  const kind = server.timerJobKind(sessionId, "sear-chicken");
  assert.deepEqual(JSON.parse(JSON.stringify(server.parseTimerJobKind(kind))), { sessionId, timerId: "sear-chicken" });
  assert.equal(server.parseTimerJobKind(`cooking-timer:${sessionId}:../unsafe`), null);
  assert.notEqual(server.timerJobId(sessionId, "sear-chicken", 1000), server.timerJobId(sessionId, "sear-chicken", 2000), "a restarted timer gets a fresh durable job id");
});

test("session job reconciliation avoids D1's long LIKE-pattern failure", async () => {
  const route = await readFile(new URL("app/api/cook-sessions/route.ts", root), "utf8");
  assert.doesNotMatch(route, /\blike\(/);
  assert.match(route, /job\.kind\.startsWith\(kindPrefix\)/);
  assert.match(route, /job\.kind\.startsWith\(prefix\)/);
});
