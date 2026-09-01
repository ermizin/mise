import assert from "node:assert/strict";
import test from "node:test";

import { editorialStorage } from "../scripts/apply-recipe-editorial-cards.mjs";

function storage({ title = "Test recipe", sourceTitle, titleRu = "Тестовое блюдо", steps }) {
  return editorialStorage({ title, sourceTitle }, { titleRu, paraphrasedInstructionDraft: steps });
}

test("storage detects thermal preparation from the expanded action set and Russian step verbs", () => {
  assert.equal(storage({
    steps: [{ action: "steam", text: "Готовьте овощи на пару до мягкости." }],
  }).reheatToC, 74);
  assert.equal(storage({
    steps: [{ action: "mix", text: "Обжарьте овощи на сковороде до румяности." }],
  }).reheatToC, 74);
});

test("storage infers freezing only from an instruction action or text, never a title", () => {
  assert.equal(storage({
    title: "Freeze-ahead chicken",
    sourceTitle: "Frozen chicken",
    steps: [{ action: "mix", text: "Смешайте ингредиенты и подайте." }],
  }).freezable, false);
  assert.equal(storage({
    steps: [{ action: "mix", text: "Полностью остудите и заморозьте порции." }],
  }).freezable, true);
  assert.equal(storage({
    steps: [{ action: "freeze", text: "Полностью остудите и упакуйте порции." }],
  }).freezable, true);
});

test("explicit cold dishes never receive a 74°C reheating instruction", () => {
  for (const titleRu of ["Салат с запечённой тыквой", "Гранола с куркумой", "Йогуртовый боул", "Сорбет из манго", "Ночная овсянка с бананом"]) {
    const result = storage({
      titleRu,
      steps: [{ action: "bake", text: "Запекайте компонент до готовности, затем полностью остудите." }],
    });
    assert.equal(result.reheatToC, null, titleRu);
    assert.match(result.reheat, /без повторного нагрева/i, titleRu);
  }
});
