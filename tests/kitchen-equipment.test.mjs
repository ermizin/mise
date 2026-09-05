import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";
import { recipeEquipmentFor, equipmentCoverage, kitchenEquipmentIds } from "../scripts/recipe-equipment.mjs";
import { buildRecipeRuntimeCatalog } from "../scripts/build-recipe-runtime-catalog.mjs";

const runtime = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/plan-recipe-registry.json", import.meta.url), "utf8"));
const app = await recipeCatalog();
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
function planFor(recipe, equipment, selectedMethod) {
  const slot = recipe.slot;
  // Fixture models an explicit user selection, not an application default.
  const method = selectedMethod ?? (Array.isArray(equipment) ? app.equipmentMethods(recipe).find((method) => method.requiredEquipment.every((id) => equipment.includes(id)))?.id : undefined);
  return {
    id: "kitchen-test", start: "2026-09-05", end: "2026-09-05", periodDays: 1, cookEveryDays: 1,
    menuStyle: "budget", mealSlots: [slot], kitchenEquipment: equipment, recipeMethods: method ? { [recipe.id]: method } : undefined,
    people: [{ id: "p1", name: "Я", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: [slot] }],
    batches: [{ id: "b1", index: 0, start: "2026-09-05", end: "2026-09-05", days: 1 }],
    selections: { [`b1:${slot}`]: recipe.id },
    selectionAssignments: { [`b1:${slot}`]: [{ recipeId: recipe.id, personIds: ["p1"] }] }, shopping: [],
  };
}

test("50 distinct released recipes have complete appliance methods, not reheat tags", () => {
  assert.deepEqual(equipmentCoverage(runtime.recipes), { multicooker: 30, airFryer: 20, uniqueRecipes: 50 });
  const active = new Set(app.productionRecipes.map((recipe) => recipe.id));
  for (const recipe of runtime.recipes) {
    for (const method of recipe.equipmentOptions) {
      if (method.id === "original") continue;
      assert.ok(active.has(recipe.id), recipe.id);
      assert.ok(method.steps.some((step) => /готовьте|готовится|тушите|выпекайте|грейте|запеките|обжарьте/iu.test(step)), recipe.id);
      assert.ok(method.steps.some((step) => /°C|Тушени|Томлени|Жарк/u.test(step)), recipe.id);
      assert.ok(method.steps.length >= 3);
      assert.ok(method.timeMinutes >= method.activeMinutes);
      assert.ok([1, 2, 3].includes(method.difficulty));
      assert.ok(method.requiredEquipment.includes(method.id));
    }
  }
});

test("equipment generator is deterministic and rejects stale cooking instructions", async () => {
  const rebuilt = await buildRecipeRuntimeCatalog();
  assert.deepEqual(rebuilt, runtime);
  const recipe = runtime.recipes[0];
  assert.throws(() => recipeEquipmentFor(recipe.id, recipe.title, [...recipe.steps, "different process"]), /review equipment/);
  const first = recipeEquipmentFor(recipe.id, recipe.title, recipe.steps);
  first[0].requiredEquipment.push("bogus");
  assert.ok(!recipeEquipmentFor(recipe.id, recipe.title, recipe.steps)[0].requiredEquipment.includes("bogus"));
});

test("all-of requirements and alternative methods agree between client and server for all kitchens", () => {
  const subsets = [undefined, [], ["air_fryer"], ["multicooker"], ["stove", "pot", "pan"], ["oven", "baking_dish"], kitchenEquipmentIds];
  for (const recipe of app.productionRecipes) for (const equipment of subsets) {
    const expected = equipment === undefined || app.equipmentMethods(recipe).some((method) => method.requiredEquipment.every((id) => equipment.includes(id)));
    assert.equal(app.recipeSupportsEquipment(recipe, equipment), expected, recipe.id);
    assert.equal(validatePlanForPersistence(planFor(recipe, equipment)).valid, expected, `${recipe.id}: ${equipment}`);
    const entry = registry.recipes.find((value) => value.id === recipe.id);
    assert.deepEqual(plain(entry.equipmentOptions), plain(app.equipmentMethods(recipe).map(({ id, requiredEquipment }) => ({ id, requiredEquipment }))));
  }
  const bowl = app.recipesById["tmpm-22571"];
  assert.equal(app.recipeSupportsEquipment(bowl, ["air_fryer"]), false, "a bowl also needs stovetop sides and salsa blender");
  assert.equal(app.recipeSupportsEquipment(bowl, ["air_fryer", "stove", "pot", "pan", "blender"]), true);
});

test("malformed equipment fails at the API boundary; missing legacy field stays compatible", () => {
  const recipe = app.productionRecipes[0];
  for (const equipment of [null, "air_fryer", {}, ["unknown"], ["air_fryer", "air_fryer"], [17]]) {
    const result = validatePlanForPersistence(planFor(recipe, equipment));
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  }
  assert.equal(validatePlanForPersistence(planFor(recipe, undefined)).valid, true);
  assert.equal(app.normalizeKitchenEquipment(undefined), undefined);
  assert.deepEqual(plain(app.normalizeKitchenEquipment([])), []);
  assert.deepEqual(plain(app.normalizeKitchenEquipment(["air_fryer", "bogus", "air_fryer"])), ["air_fryer"]);
});

test("automatic, manual, disliked override and personal fallback never bypass kitchen constraints", () => {
  const kitchens = [[], ["multicooker"], ["air_fryer"], ["stove", "pot", "pan", "multicooker"], kitchenEquipmentIds];
  for (const equipment of kitchens) for (const style of ["protein", "budget"]) for (const slot of app.allMealSlots) {
    const person = { id: "p1", name: "Я", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: [slot] };
    for (const includeDisliked of [false, true]) {
      const candidates = app.candidateRecipes(slot, style, [person], 3, { limit: "all", includeDisliked }, equipment);
      assert.ok(candidates.every((recipe) => app.recipeSupportsEquipment(recipe, equipment)));
    }
    const assignments = app.automaticAssignmentsFor(slot, style, [person], 3, new Set(), new Set(), [], equipment);
    assert.ok(assignments.every((assignment) => app.recipeSupportsEquipment(app.recipesById[assignment.recipeId], equipment)));
  }
});

test("appliance choice changes cooking instructions and batch timeline without changing portions", () => {
  const recipe = app.recipesById["tmpm-25453"];
  const original = plain(app.recipeDisplaySteps(recipe));
  const air = plain(app.recipeDisplaySteps(recipe, ["air_fryer"], "air_fryer"));
  assert.ok(original.some((step) => /духов/u.test(step)));
  assert.ok(air.some((step) => /аэрогрил/u.test(step)));
  assert.ok(!air.some((step) => /духов|противн/u.test(step)));
  const plan = planFor(recipe, ["air_fryer"]);
  const model = app.buildBatchCookingModel(plan, plan.batches[0]);
  assert.ok(model.steps.some((step) => /аэрогрил/u.test(step.title)));
  const originalPlan = planFor(recipe, undefined);
  const originalModel = app.buildBatchCookingModel(originalPlan, originalPlan.batches[0]);
  assert.equal(model.totalPortions, originalModel.totalPortions);
  assert.deepEqual(plain(model.steps[0].products), plain(originalModel.steps[0].products));
  assert.equal(model.totalMinutes, app.planCookingMethod(recipe, plan).timeMinutes);
  assert.equal(app.cookingMethodFor(recipe)?.id, "original");
  assert.equal(app.planCookingMethod(recipe, plan).id, "air_fryer");
});


test("saved method is explicit, survives reload and never switches when equipment changes", () => {
  const recipe = app.recipesById["tmpm-25453"];
  const both = ["oven", "baking_dish", "air_fryer"];
  const original = planFor(recipe, both, "original");
  assert.equal(app.planCookingMethod(recipe, original).id, "original");
  assert.equal(app.cookingMethodFor(recipe, both).id, "original", "having an appliance never silently selects it");
  assert.equal(app.cookingMethodFor(recipe, ["air_fryer"]), undefined, "no original route is available; user must choose");
  const selected = { ...original, recipeMethods: { [recipe.id]: "air_fryer" } };
  const restored = JSON.parse(JSON.stringify(selected));
  restored.recipeMethods = app.normalizeRecipeMethods(restored.recipeMethods);
  assert.equal(app.planCookingMethod(recipe, restored).id, "air_fryer");
  assert.deepEqual(plain(app.missingPlanMethods(restored)), []);
  assert.equal(validatePlanForPersistence(restored).valid, true);
  const removedAppliance = { ...restored, kitchenEquipment: ["oven", "baking_dish"] };
  assert.equal(app.planCookingMethod(recipe, removedAppliance), undefined, "available original does not overwrite saved appliance");
  assert.equal(validatePlanForPersistence(removedAppliance).valid, false);
  assert.deepEqual(plain(app.missingPlanMethods(removedAppliance)), [recipe.id]);
  assert.ok(!app.buildBatchCookingModel(removedAppliance, removedAppliance.batches[0]).steps.some((step) => /духов/u.test(step.title)));
  assert.equal(app.planCookingMethod(recipe, planFor(recipe, undefined)).id, "original", "legacy plans keep original instructions");
  const missing = { ...original, recipeMethods: undefined };
  assert.equal(validatePlanForPersistence(missing).valid, false, "new kitchen-aware plan needs saved choices");
  assert.equal(app.planCookingMethod(recipe, missing), undefined);
  for (const methods of [null, [], "air_fryer", { [recipe.id]: "unknown" }, { nonexistent: "original" }]) {
    assert.equal(validatePlanForPersistence({ ...original, recipeMethods: methods }).status, 400);
  }
});

test("Cooking step identifies unbuildable meal slots before menu assembly", () => {
  const person = { id: "p1", name: "Я", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["breakfast", "lunch", "dinner"] };
  const batches = [{ id: "b1", days: 1 }];
  const gaps = plain(app.kitchenMenuGaps([person], person.includedSlots, "budget", batches, []));
  assert.ok(gaps.includes("lunch"));
  assert.ok(gaps.includes("dinner"));
  assert.deepEqual(plain(app.kitchenMenuGaps([person], person.includedSlots, "budget", batches, kitchenEquipmentIds)), []);
});

test("wizard draft, recipe card and next-step guards are wired to the saved method", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /setRecipeMethods\(normalizeRecipeMethods\(draft\.recipeMethods\)\)/);
  assert.match(source, /kitchenEquipment,\s+recipeMethods,\s+remainderDecision/);
  assert.match(source, /kitchenEquipment,\s+recipeMethods,\s+menuStyle/);
  assert.match(source, /resolvedPeriodValid && kitchenGaps\.length === 0/);
  assert.match(source, /if \(pendingMethods\.length\) return false;/);
  assert.match(source, /context=\{\{ recipe: previewRecipe, plan: draftPlan \}\}/);
  assert.match(source, /onChangePlan\(\{ \.\.\.plan, recipeMethods:/);
});
