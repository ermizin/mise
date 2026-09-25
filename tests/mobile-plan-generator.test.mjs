import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMobileBootstrap } from "../domain/mobile.ts";
import { generateMobilePlan } from "../domain/plan-generator.ts";
import { loadTypeScriptModule } from "./typescript-module.mjs";
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const audit = JSON.parse(await readFile(new URL("../data/recipe-release-audit.json", import.meta.url), "utf8"));
const simpleManifest = JSON.parse(await readFile(new URL("../data/simple-recipe-images.json", import.meta.url), "utf8"));
const bootstrap = buildMobileBootstrap(catalog, audit, simpleManifest);
const person = (id = "p1", extra = {}) => ({ id, name: id, daily: { kcal: 2000, protein: 150, fat: 60, carbs: 215 }, includedSlots: ["lunch"], ...extra });
const allEquipment = [...bootstrap.limits.kitchenEquipment];
const draft = (extra = {}) => ({ id: "offline-plan", createdAt: "2026-09-25T12:00:00Z", start: "2026-09-25", periodDays: 1, cookEveryDays: 1, menuStyle: "protein", kitchenEquipment: allEquipment, mealSlots: ["lunch"], people: [person()], ...extra });

test("deterministic offline plans cover period and household limits and persist", () => {
  for (const days of [1, 14]) for (const count of [1, 4]) {
    const input = draft({ periodDays: days, cookEveryDays: 3, people: Array.from({ length: count }, (_, i) => person(`p${i}`)) });
    const plan = generateMobilePlan(bootstrap, input);
    assert.deepEqual(plan, generateMobilePlan(bootstrap, input));
    assert.equal(validatePlanForPersistence(plan).valid, true);
    assert.equal(plan.batches.reduce((sum, b) => sum + b.days, 0), days);
    assert.equal(plan.batches.at(-1).end, plan.end);
    assert.equal(plan.cooking.reduce((sum, c) => sum + c.personIds.length * plan.batches.find((b) => c.key.startsWith(`${b.id}:`)).days, 0), days * count);
    assert.equal(Object.keys(plan.selectionAssignments).length, Object.keys(plan.selections).length);
    assert.ok(Object.entries(plan.selectionAssignments).every(([key, groups]) => groups.length > 0 && groups[0].recipeId === plan.selections[key]));
    assert.ok(plan.shopping.every((i) => Number.isFinite(i.quantity) && i.quantity > 0));
    assert.ok(plan.cooking.every((c) => c.portions.every((p) => p.actual.kcal >= p.target.kcal * .9 && p.actual.kcal <= p.target.kcal * 1.05)));
  }
});

test("style gates recipes and all release styles can generate", () => {
  for (const menuStyle of ["simple", "protein", "budget"]) {
    const plan = generateMobilePlan(bootstrap, draft({ menuStyle }));
    for (const id of Object.values(plan.selections)) assert.ok(bootstrap.recipes.find((r) => r.id === id).menuTags.includes(menuStyle));
  }
});

test("simple main dishes can cover lunch and dinner like the web release", () => {
  const input = draft({ menuStyle: "simple", mealSlots: ["lunch", "dinner"], people: [person("p1", { includedSlots: ["lunch", "dinner"] })] });
  const plan = generateMobilePlan(bootstrap, input);
  assert.ok(plan.selections["batch-0:lunch"]);
  assert.ok(plan.selections["batch-0:dinner"]);
});

test("new plans use only the original recipe route supported by selected equipment", () => {
  const noHeatRecipes = bootstrap.recipes.filter((recipe) => recipe.slot === "breakfast" && recipe.menuTags.includes("protein") && recipe.equipmentOptions.find((method) => method.id === "original")?.requiredEquipment.length === 0);
  const noHeat = generateMobilePlan({ ...bootstrap, recipes: noHeatRecipes }, draft({ kitchenEquipment: [], mealSlots: ["breakfast"], people: [person("p1", { includedSlots: ["breakfast"] })] }));
  assert.ok(Object.values(noHeat.selections).every((id) => noHeatRecipes.some((recipe) => recipe.id === id)));

  const incompatible = bootstrap.recipes.find((recipe) => recipe.slot === "lunch" && recipe.menuTags.includes("protein") && recipe.equipmentOptions.find((method) => method.id === "original")?.requiredEquipment.length);
  assert.ok(incompatible);
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [incompatible] }, draft({ kitchenEquipment: [] })), { code: "no_candidate" });
});

test("all five meal slots remain complete for a fourteen-day plan", () => {
  const mealSlots = [...bootstrap.limits.mealSlots];
  const plan = generateMobilePlan(bootstrap, draft({ periodDays: 14, cookEveryDays: 3, mealSlots, people: [person("a", { includedSlots: mealSlots }), person("b", { includedSlots: ["lunch", "dinner"] })] }));
  assert.equal(validatePlanForPersistence(plan).valid, true);
  assert.equal(Object.keys(plan.selections).length, plan.batches.length * 5);
  assert.equal(plan.cooking.reduce((sum, c) => sum + c.personIds.length * plan.batches.find((b) => c.key.startsWith(`${b.id}:`)).days, 0), 14 * 7);
});

test("soft dislikes need explicit override; hard exclusions cannot be overridden", () => {
  const initial = generateMobilePlan(bootstrap, draft());
  const recipe = bootstrap.recipes.find((r) => r.id === initial.selections["batch-0:lunch"]);
  const single = { ...bootstrap, recipes: [recipe] };
  const disliked = draft({ people: [person("p1", { dislikes: [recipe.ingredients[0].canonicalIngredientId] })] });
  assert.throws(() => generateMobilePlan(single, disliked), { code: "no_candidate" });
  assert.equal(generateMobilePlan(single, { ...disliked, includeDisliked: true }).selections["batch-0:lunch"], recipe.id);
  const allergen = recipe.ingredients.flatMap((i) => i.allergens)[0];
  assert.ok(allergen, "fixture contains an allergen");
  assert.throws(() => generateMobilePlan(single, draft({ includeDisliked: true, people: [person("p1", { hardExclusions: [allergen] })] })), { code: "no_candidate" });
});

test("incompatible eaters get separate assignments with complete coverage", () => {
  // Synthetic presentation allergens isolate assignment logic while retaining real solver inputs.
  const first = generateMobilePlan(bootstrap, draft()).selections["batch-0:lunch"];
  const second = generateMobilePlan({ ...bootstrap, recipes: bootstrap.recipes.filter((r) => r.id !== first) }, draft()).selections["batch-0:lunch"];
  const splitCatalog = { ...bootstrap, recipes: [first, second].map((id, index) => {
    const r = structuredClone(bootstrap.recipes.find((x) => x.id === id));
    r.ingredients[0].allergens.push(`test-${index}`);
    return r;
  }) };
  const plan = generateMobilePlan(splitCatalog, draft({ people: [person("a", { hardExclusions: ["test-1"] }), person("b", { hardExclusions: ["test-1"] }), person("c", { hardExclusions: ["test-0"] })] }));
  assert.equal(validatePlanForPersistence(plan).valid, true);
  assert.deepEqual(plan.selectionAssignments["batch-0:lunch"], [{ recipeId: first, personIds: ["a", "b"] }, { recipeId: second, personIds: ["c"] }]);
});

test("quantities aggregate solved ingredients for people and days with cooking fat once", () => {
  const plan = generateMobilePlan(bootstrap, draft({ periodDays: 3, cookEveryDays: 3, people: [person(), person("p2")] }));
  const expected = new Map();
  for (const c of plan.cooking) {
    const recipe = bootstrap.recipes.find((r) => r.id === c.recipeId);
    for (const i of recipe.ingredients) {
      const key = `${i.canonicalIngredientId}:${{ g: "г", ml: "мл", piece: "шт." }[i.unit]}`;
      expected.set(key, (expected.get(key) ?? 0) + c.amounts[i.id]);
    }
    for (const i of recipe.solver.ingredients) {
      assert.equal(c.amounts[i.sourceIngredientId], i.role === "fat_cooking" ? i.baseAmount : Math.round(c.portions.reduce((sum, p) => sum + p.amounts[i.sourceIngredientId], 0) * 3 * 10) / 10);
    }
  }
  for (const item of plan.shopping) assert.equal(item.quantity, item.unit === "шт." ? Math.ceil(expected.get(item.key)) : Math.ceil(expected.get(item.key) / 10) * 10);
});

test("storage rejects unsafe batches and explicitly counts freezing", () => {
  const recipe = bootstrap.recipes.find((r) => r.id === generateMobilePlan(bootstrap, draft()).selections["batch-0:lunch"]);
  const cold = { ...recipe, storage: { ...recipe.storage, refrigeratorDays: 1, freezerDays: 30, freezable: false } };
  const input = draft({ periodDays: 3, cookEveryDays: 3 });
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [cold] }, input), { code: "no_candidate" });
  const plan = generateMobilePlan({ ...bootstrap, recipes: [{ ...cold, storage: { ...cold.storage, freezable: true } }] }, input);
  assert.equal(plan.cooking[0].frozenDays, 2);
});

test("replace-one keeps every reviewed slot except the requested slot", () => {
  const input = draft({ periodDays: 4, cookEveryDays: 2, mealSlots: ["lunch", "dinner"], people: [person("p1", { includedSlots: ["lunch", "dinner"] })] });
  const original = generateMobilePlan(bootstrap, input);
  const targetKey = "batch-0:lunch";
  const pinnedSelections = Object.fromEntries(
    Object.entries(original.selections).filter(([key]) => key !== targetKey),
  );
  const pinnedAssignments = Object.fromEntries(
    Object.entries(original.selectionAssignments).filter(([key]) => key !== targetKey),
  );
  const replaced = generateMobilePlan(bootstrap, {
    ...input,
    pinnedSelections,
    pinnedAssignments,
    excludedRecipeIds: { [targetKey]: [original.selections[targetKey]] },
  });
  assert.notEqual(replaced.selections[targetKey], original.selections[targetKey]);
  for (const [key, recipeId] of Object.entries(original.selections)) {
    if (key !== targetKey) assert.equal(replaced.selections[key], recipeId);
  }
});

test("no candidates and bad input fail without partial plans", () => {
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [] }, draft()), { code: "no_candidate" });
  assert.throws(() => generateMobilePlan({ ...bootstrap, schemaVersion: 999 }, draft()), { code: "unsupported_catalog" });
  for (const extra of [{ periodDays: 0 }, { periodDays: 15 }, { people: [] }, { people: Array.from({ length: 5 }, (_, i) => person(`p${i}`)) }, { start: "2026-02-30" }, { people: [person("a"), person("a")] }, { mealSlots: ["lunch", "lunch"] }, { kitchenEquipment: ["invalid"] }]) assert.throws(() => generateMobilePlan(bootstrap, draft(extra)), { code: "invalid_draft" });
});
