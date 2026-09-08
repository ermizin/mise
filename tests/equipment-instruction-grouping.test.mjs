import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { matchesEquipmentInstructionFingerprint } from "../scripts/recipe-equipment.mjs";

const historicalPackingText = "Разделите готовый выход по числу рассчитанных контейнеров, подпишите имя, приём пищи и дату, затем уберите на хранение.";
const fingerprint = (steps) => createHash("sha256").update(JSON.stringify(steps)).digest("hex");

test("equipment review accepts an exact A6 regrouping of previously split sentences", () => {
  const grouped = [
    "Обжарьте овощи на сковороде. Добавьте соус и томите 10 минут.",
    "Переложите блюдо в контейнеры.",
  ];
  const historical = [
    "Обжарьте овощи на сковороде.",
    "Добавьте соус и томите 10 минут.",
    "Переложите блюдо в контейнеры.",
  ];

  assert.equal(matchesEquipmentInstructionFingerprint(fingerprint(historical), grouped), true);
});

test("equipment review accepts the direct legacy text array and only the known removed packing artifact", () => {
  const direct = ["Обжарьте овощи на сковороде.", "Добавьте соус и томите 10 минут."];
  assert.equal(matchesEquipmentInstructionFingerprint(fingerprint(direct), direct), true);

  const singleStep = ["Обжарьте овощи на сковороде."];
  assert.equal(matchesEquipmentInstructionFingerprint(fingerprint([...singleStep, historicalPackingText]), singleStep), true);
});

test("equipment review rejects regrouped instructions when words or order changed", () => {
  const historical = [
    "Обжарьте овощи на сковороде.",
    "Добавьте соус и томите 10 минут.",
  ];
  const expected = fingerprint(historical);

  assert.equal(
    matchesEquipmentInstructionFingerprint(expected, ["Добавьте соус и томите 10 минут. Обжарьте овощи на сковороде."]),
    false,
  );
  assert.equal(
    matchesEquipmentInstructionFingerprint(expected, ["Обжарьте овощи на сковороде. Добавьте томатный соус и томите 10 минут."]),
    false,
  );
});
