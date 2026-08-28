import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const portions = await loadTypeScriptModule(new URL("../domain/portion-allocation.ts", import.meta.url));
const person = (personId, portionCount, nutritionShare, componentShares) => ({ personId, label: personId, portionCount, nutritionShare, componentShares });

test("mixed dish allocates one person's actual cooked output across containers", () => {
  const result = portions.allocateMixedDish(1800, [person("A", 3, 1)]);
  assert.deepEqual(Array.from(result.allocations[0].perContainerG), [600, 600, 600]);
  assert.equal(result.allocatedWeightG, 1800);
});

test("mixed dish allocates two people by nutrition share", () => {
  const result = portions.allocateMixedDish(1800, [person("A", 3, 0.6), person("B", 3, 0.4)]);
  assert.equal(result.allocations[0].totalG, 1080);
  assert.equal(result.allocations[1].totalG, 720);
  assert.deepEqual(Array.from(result.allocations[0].perContainerG), [360, 360, 360]);
  assert.deepEqual(Array.from(result.allocations[1].perContainerG), [240, 240, 240]);
});

test("different portion counts preserve each person's total", () => {
  const result = portions.allocateMixedDish(1001, [person("A", 2, 1), person("B", 3, 1)]);
  assert.equal(result.allocations[0].perContainerG.reduce((sum, value) => sum + value, 0), result.allocations[0].totalG);
  assert.equal(result.allocations[1].perContainerG.reduce((sum, value) => sum + value, 0), result.allocations[1].totalG);
  assert.equal(result.allocatedWeightG, 1001);
});

test("component dish returns concrete grams for every separately weighed component", () => {
  const result = portions.allocateComponentDish(
    [
      { componentId: "chicken", label: "Курица", cookedWeightG: 840 },
      { componentId: "rice", label: "Рис", cookedWeightG: 1140 },
      { componentId: "vegetables", label: "Овощи", cookedWeightG: 810 },
    ],
    [
      person("A", 3, 0.6, { chicken: 0.65, rice: 0.55, vegetables: 0.6 }),
      person("B", 3, 0.4, { chicken: 0.35, rice: 0.45, vegetables: 0.4 }),
    ],
  );
  assert.equal(result.mode, "components");
  for (const component of result.components) {
    assert.equal(component.allocations.length, 2);
    assert.ok(component.allocations.every((allocation) => allocation.perContainerG.length === 3));
    assert.ok(component.allocatedWeightG <= Math.floor(component.cookedWeightG));
  }
});

test("actual cooked weight is authoritative even when it differs from a predicted raw weight", () => {
  const predictedRawWeight = 2200;
  const actualCookedWeight = 1777;
  const result = portions.allocateMixedDish(actualCookedWeight, [person("A", 4, 0.7), person("B", 2, 0.3)]);
  assert.notEqual(result.allocatedWeightG, predictedRawWeight);
  assert.equal(result.allocatedWeightG, actualCookedWeight);
  assert.ok(result.allocations.reduce((sum, allocation) => sum + allocation.totalG, 0) <= actualCookedWeight);
});
