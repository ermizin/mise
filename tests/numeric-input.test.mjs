import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const numeric = await loadTypeScriptModule(new URL("../domain/numeric-input.ts", import.meta.url));

test("calorie editing permits empty intermediate state and ordinary digit-by-digit entry", () => {
  const sequence = ["", "2", "23", "236", "2360"].map(numeric.normalizeIntegerEdit);
  assert.deepEqual(sequence.map(({ text }) => text), ["", "2", "23", "236", "2360"]);
  assert.deepEqual(sequence.map(({ value }) => value), [null, 2, 23, 236, 2360]);
});

test("leading zeroes are not retained", () => {
  const ordinary = numeric.normalizeIntegerEdit("02360");
  const zero = numeric.normalizeIntegerEdit("000");
  assert.equal(ordinary.text, "2360");
  assert.equal(ordinary.value, 2360);
  assert.equal(zero.text, "0");
  assert.equal(zero.value, 0);
});
