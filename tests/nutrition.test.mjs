import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
const daily = { kcal: 2000, protein: 150, fat: 65, carbs: 204 };

test("a complete five-slot plan never exceeds the calorie target", () => {
  const result = nutrition.calculateMealPlanTargets(daily, ["breakfast", "snack1", "lunch", "snack2", "dinner"]);
  assert.equal(result.planned.kcal, 2000);
  assert.equal(result.remaining.kcal, 0);
  assert.ok(Object.values(result.slots).every((slot) => nutrition.macroCalories(slot) <= slot.kcal));
});

test("selected breakfast and dinner keep their fixed shares and expose the remainder", () => {
  const result = nutrition.calculateMealPlanTargets(daily, ["breakfast", "dinner"]);
  assert.equal(result.slots.breakfast.kcal, 500);
  assert.equal(result.slots.dinner.kcal, 500);
  assert.equal(result.planned.kcal, 1000);
  assert.equal(result.remaining.kcal, 1000);
  assert.ok(result.chocolateEquivalent.grams > 0);
  assert.ok(result.chocolateEquivalent.bars > 0);
});

test("integer rounding is compensated without crossing the hard cap", () => {
  for (let target = 1200; target <= 4000; target += 7) {
    const result = nutrition.calculateMealPlanTargets({ ...daily, kcal: target }, ["breakfast", "snack1", "lunch", "snack2", "dinner"]);
    assert.equal(result.planned.kcal, target);
    assert.ok(nutrition.macroCalories(result.planned) <= target);
  }
});

const baseWizard = {
  sex: "male",
  age: 30,
  height: 178,
  weight: 78,
  activity: "medium",
  musclePriority: false,
  goal: "maintenance",
  monthlyWeightChangeKg: 0,
};

test("wizard calculates maintenance, loss and gain from Mifflin-St Jeor and kg per month", () => {
  const maintenance = nutrition.calculateNutritionTarget(baseWizard);
  const loss = nutrition.calculateNutritionTarget({ ...baseWizard, goal: "loss", monthlyWeightChangeKg: 1 });
  const gain = nutrition.calculateNutritionTarget({ ...baseWizard, goal: "gain", monthlyWeightChangeKg: 1 });
  assert.ok("target" in maintenance && "target" in loss && "target" in gain);
  assert.ok(loss.target.kcal < maintenance.target.kcal);
  assert.ok(gain.target.kcal > maintenance.target.kcal);
  assert.ok(Math.abs(loss.dailyEnergyDelta - 7700 / 30.4) < 1);
});

test("server normalization corrects stale automatic targets but preserves manual targets", () => {
  const automatic = {
    id: "plan",
    people: [
      {
        id: "person",
        nutritionTargetMode: "auto",
        estimate: baseWizard,
        daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 },
      },
    ],
  };
  const normalized = nutrition.normalizeAutomaticNutritionTargets(automatic);
  const expected = nutrition.calculateNutritionTarget(baseWizard);
  assert.ok("target" in expected);
  assert.deepEqual(normalized.people[0].daily, expected.target);

  const manual = structuredClone(automatic);
  manual.people[0].nutritionTargetMode = "manual";
  const preserved = nutrition.normalizeAutomaticNutritionTargets(manual);
  assert.equal(preserved.people[0].daily.kcal, 2200);
});

test("activity factor changes TDEE", () => {
  const inactive = nutrition.calculateNutritionTarget({ ...baseWizard, activity: "low" });
  const active = nutrition.calculateNutritionTarget({ ...baseWizard, activity: "high" });
  assert.ok("target" in inactive && "target" in active);
  assert.ok(active.tdee > inactive.tdee);
});

test("muscle priority primarily raises protein while keeping calories capped", () => {
  const general = nutrition.calculateNutritionTarget(baseWizard);
  const muscle = nutrition.calculateNutritionTarget({ ...baseWizard, musclePriority: true });
  assert.ok("target" in general && "target" in muscle);
  assert.ok(muscle.target.protein > general.target.protein);
  assert.ok(nutrition.macroCalories(muscle.target) <= muscle.target.kcal);
  assert.ok(muscle.target.kcal - nutrition.macroCalories(muscle.target) <= 3);
});

test("muscle priority uses 2 g/kg for maintenance and gain, and 2.2 g/kg for loss", () => {
  const weight = 80;
  assert.equal(nutrition.calculateMacroTargets(3000, weight, true, "maintenance").protein, 160);
  assert.equal(nutrition.calculateMacroTargets(3000, weight, true, "gain").protein, 160);
  assert.equal(nutrition.calculateMacroTargets(3000, weight, true, "loss").protein, 176);
});

test("a person can add a meal slot that was absent from the original plan", () => {
  const people = [
    { id: "one", name: "Маша", includedSlots: ["breakfast", "lunch", "dinner"] },
    { id: "two", name: "Саша", includedSlots: ["breakfast", "lunch", "dinner"] },
  ];
  const result = nutrition.togglePersonMealSlot(
    people,
    ["breakfast", "lunch", "dinner"],
    "two",
    "snack2",
  );

  assert.equal(JSON.stringify(result.mealSlots), JSON.stringify(["breakfast", "lunch", "snack2", "dinner"]));
  assert.equal(JSON.stringify(result.people[0].includedSlots), JSON.stringify(["breakfast", "lunch", "dinner"]));
  assert.ok(result.people[1].includedSlots.includes("snack2"));
});

test("removing the last eater also removes that slot from the plan", () => {
  const result = nutrition.togglePersonMealSlot(
    [{ id: "one", includedSlots: ["breakfast", "snack2"] }],
    ["breakfast", "snack2"],
    "one",
    "snack2",
  );

  assert.equal(JSON.stringify(result.mealSlots), JSON.stringify(["breakfast"]));
  assert.equal(JSON.stringify(result.people[0].includedSlots), JSON.stringify(["breakfast"]));
});

test("macro presets and custom recalculation never exceed target calories", () => {
  for (const preset of ["balanced", "protein", "carbs", "fat"]) {
    const result = nutrition.macrosForCalories(2001, preset);
    assert.ok(nutrition.macroCalories(result) <= result.kcal);
    assert.ok(result.kcal - nutrition.macroCalories(result) <= 3);
  }
  const custom = nutrition.recalculateDailyMacros(1733, { kcal: 2000, protein: 180, fat: 80, carbs: 200 }, "custom");
  assert.ok(nutrition.macroCalories(custom) <= custom.kcal);
});

test("invalid and extreme wizard values are explicit", () => {
  const invalid = nutrition.calculateNutritionTarget({ ...baseWizard, age: 12 });
  assert.ok(!("target" in invalid));
  assert.ok(invalid.issues.some((issue) => issue.code === "invalid_age" && issue.severity === "error"));

  const extreme = nutrition.calculateNutritionTarget({ ...baseWizard, goal: "loss", monthlyWeightChangeKg: 8 });
  assert.ok("target" in extreme);
  assert.ok(extreme.issues.some((issue) => issue.severity === "warning"));
  assert.ok(nutrition.macroCalories(extreme.target) <= extreme.target.kcal);
});

test("nutrition target mode preserves legacy manual goals", () => {
  assert.equal(nutrition.normalizeNutritionTargetMode("auto", false, false), "auto");
  assert.equal(nutrition.normalizeNutritionTargetMode("manual", true, true), "manual");
  assert.equal(nutrition.normalizeNutritionTargetMode(undefined, false, false), "manual");
  assert.equal(nutrition.normalizeNutritionTargetMode(undefined, true, false), "manual");
  assert.equal(nutrition.normalizeNutritionTargetMode(undefined, true, true), "auto");
});

test("legacy macro targets are repaired before a plan is saved", () => {
  const legacy = { kcal: 2490, protein: 10, fat: 83, carbs: 315 };
  const repaired = nutrition.repairLegacyDailyMacros(legacy, "custom");
  assert.equal(repaired.kcal, legacy.kcal);
  assert.ok(Math.abs(nutrition.macroCalories(repaired) - repaired.kcal) <= 5);
  assert.deepEqual(
    nutrition.repairLegacyDailyMacros(repaired, "custom"),
    repaired,
    "normalization is stable after the first repair",
  );
});

test("a meal's protein floor is the proportional share until that share stops being a dish property", () => {
  // A balanced 30%-of-energy day: every slot's share is already reachable, so
  // the floor is exactly the share and nothing about selection changes.
  assert.equal(nutrition.mealProteinFloor(400, 30), 30);
  // The wizard's own ceiling is 40% of energy. A 400 kcal breakfast would then
  // be asked for 40 g of protein; the floor stops at 32% of the meal's energy
  // so the slot keeps a real catalog, while the 40 g stays the search target.
  assert.equal(nutrition.mealProteinFloor(400, 40), 32);
  assert.equal(nutrition.mealProteinFloor(775, 77), 62);
  // A slot the person does not eat has no floor at all.
  assert.equal(nutrition.mealProteinFloor(0, 0), 0);
  assert.equal(nutrition.mealProteinFloor(Number.NaN, 40), 0);
});
