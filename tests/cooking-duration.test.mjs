import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const duration = await loadTypeScriptModule(
  new URL("../domain/cooking-duration.ts", import.meta.url),
);
const parsed = (text) => JSON.parse(JSON.stringify(duration.parseCookingDuration(text)));

test("parses Russian time units, decimals, and compact compounds into seconds", () => {
  assert.deepEqual(parsed("1 час30мин"), {
    kind: "exact",
    seconds: 5_400,
  });
  assert.deepEqual(parsed("1,5 ч"), {
    kind: "exact",
    seconds: 5_400,
  });
  assert.deepEqual(parsed("45 с"), {
    kind: "exact",
    seconds: 45,
  });
  assert.deepEqual(parsed("45 сек."), {
    kind: "exact",
    seconds: 45,
  });
});

test("preserves a bounded interval instead of choosing an endpoint", () => {
  assert.deepEqual(parsed("запекайте 1–1.5 часа"), {
    kind: "range",
    minSeconds: 3_600,
    maxSeconds: 5_400,
  });
  assert.deepEqual(parsed("20—25 мин"), {
    kind: "range",
    minSeconds: 1_200,
    maxSeconds: 1_500,
  });
});

test("keeps sequential intervals as selectable options, not a sum", () => {
  assert.deepEqual(parsed("15 минут, затем 10 минут"), {
    kind: "multiple",
    options: [
      { kind: "exact", seconds: 900 },
      { kind: "exact", seconds: 600 },
    ],
  });
  assert.deepEqual(parsed("1 час 30 мин, потом 20–25 мин"), {
    kind: "multiple",
    options: [
      { kind: "exact", seconds: 5_400 },
      { kind: "range", minSeconds: 1_200, maxSeconds: 1_500 },
    ],
  });
  assert.deepEqual(parsed("готовьте 6 часов до мягкости мяса; за 30 минут добавьте овощи"), {
    kind: "multiple",
    options: [
      { kind: "exact", seconds: 21_600 },
      { kind: "exact", seconds: 1_800 },
    ],
  });
  assert.deepEqual(parsed("1 час, затем 30 минут"), {
    kind: "multiple",
    options: [
      { kind: "exact", seconds: 3_600 },
      { kind: "exact", seconds: 1_800 },
    ],
  });
});

test("does not mistake ingredient amounts, temperatures, or unbounded prose for timers", () => {
  for (const text of ["200 °C", "500 г курицы", "до готовности", "15"])
    assert.deepEqual(parsed(text), { kind: "unknown" });
});

test("formats parsed duration options in concise Russian", () => {
  assert.equal(duration.formatCookingDuration({ kind: "exact", seconds: 5_400 }), "1 ч 30 мин");
  assert.equal(
    duration.formatCookingDuration({ kind: "range", minSeconds: 1_200, maxSeconds: 1_500 }),
    "20–25 мин",
  );
});
