import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { orderedCookingInstructions } = await loadTypeScriptModule(
  new URL("../domain/batch-cooking.ts", import.meta.url),
);

const step = (id, text, dependsOn = []) => ({
  id,
  text,
  action: "prepare",
  dependsOn,
  ingredientIds: ["ingredient"],
});

test("A1: preparation never disappears before ingredient use", () => {
  const result = orderedCookingInstructions([
    step("chop", "Мелко нарежьте 100 г лука"),
    step("add", "Добавьте лук в сковороду", ["chop"]),
  ]);
  assert.deepEqual(Array.from(result, ({ text }) => text), [
    "Мелко нарежьте 100 г лука",
    "Добавьте лук в сковороду",
  ]);
});

test("A2: every action in a compound instruction is preserved verbatim", () => {
  const text = "Очистите и нарежьте 150 г моркови, затем добавьте её в кастрюлю";
  assert.equal(orderedCookingInstructions([step("carrot", text)])[0].text, text);
});

test("A3-A4: uncertain shared preparations stay separate with their amounts and shapes", () => {
  const result = orderedCookingInstructions([
    step("a", "Нарежьте 100 г лука мелкими кубиками"),
    step("b", "Нарежьте 200 г лука полукольцами"),
  ]);
  assert.deepEqual(Array.from(result, ({ text }) => text), [
    "Нарежьте 100 г лука мелкими кубиками",
    "Нарежьте 200 г лука полукольцами",
  ]);
});

test("A5: dependencies win over an unsafe input order", () => {
  const result = orderedCookingInstructions([
    step("sauce", "Добавьте соус", ["fry"]),
    step("fry", "Обжарьте овощи", ["chop"]),
    step("chop", "Нарежьте овощи"),
  ]);
  assert.deepEqual(Array.from(result, ({ id }) => id), ["chop", "fry", "sauce"]);
});

test("A6: optimization is repeatable and never mutates source instructions", () => {
  const source = [
    { ...step("chop", "Нарежьте овощи"), equipment: ["knife"] },
    step("fry", "Обжарьте овощи", ["chop"]),
  ];
  const snapshot = structuredClone(source);
  assert.deepEqual(orderedCookingInstructions(source), orderedCookingInstructions(source));
  assert.deepEqual(source, snapshot);
  orderedCookingInstructions(source)[0].equipment.push("pan");
  assert.deepEqual(source, snapshot);
});

test("cyclic metadata cannot make an instruction disappear", () => {
  const source = [
    step("a", "Первое действие", ["b"]),
    step("b", "Второе действие", ["a"]),
  ];
  assert.deepEqual(Array.from(orderedCookingInstructions(source), ({ id }) => id), ["a", "b"]);
});
