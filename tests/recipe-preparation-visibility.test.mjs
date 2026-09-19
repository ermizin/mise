import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const app = await recipeCatalog();
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const hidden = ["tmpm-28584", "tmpm-28572", "tmpm-28504", "tmpm-28499", "tmpm-28513", "tmpm-25453", "tmpm-22550"];
const plain = value => JSON.parse(JSON.stringify(value));

test("only the seven reviewed preparations leave the catalogue and all new candidate paths", () => {
  assert.deepEqual(Object.keys(app.hiddenPreparationRecipes).sort(), [...hidden].sort());
  assert.equal(app.productionRecipes.length - app.newMenuRecipes.length, hidden.length);
  for (const id of hidden) {
    const recipe = app.recipesById[id];
    assert.ok(app.productionRecipes.includes(recipe), `${id}: persistence record retained`);
    assert.equal(app.hiddenPreparationRecipes[id].title, recipe.title, `${id}: reviewed title cannot drift`);
    assert.ok(app.hiddenPreparationRecipes[id].reason.length > 20);
    assert.ok(!app.newMenuRecipes.includes(recipe));
  }
  for (const slot of app.allMealSlots) for (const style of ["budget", "protein", "simple"]) {
    const people = [{ id: "p1", name: "Я", daily: { kcal: 2200, protein: 120, fat: 70, carbs: 272.5 }, includedSlots: [slot] }];
    for (const eaters of [[], people]) for (const includeDisliked of [false, true]) {
      assert.ok(app.candidateRecipes(slot, style, eaters, 1, { limit: "all", includeDisliked }).every(recipe => !hidden.includes(recipe.id)));
    }
    assert.ok(app.automaticAssignmentsFor(slot, style, people, 1, new Set(), new Set(), []).every(group => !hidden.includes(group.recipeId)));
  }
  for (const id of ["tmpm-28533", "simple-parsed-main-pasta-salmon-cream", "tmpm-25092", "goodfood-summery-beans-herby-green-aioli", "tmpm-22331"]) {
    assert.ok(app.newMenuRecipes.some(recipe => recipe.id === id), `${id}: full dish or ordinary snack retained`);
  }
});

test("saved preparations still reopen, calculate, preserve history and pass persistence validation", () => {
  for (const id of hidden) {
    const recipe = app.recipesById[id];
    const slot = recipe.slot;
    const key = `b1:${slot}`;
    const plan = {
      id: "prep-legacy", createdAt: "2026-09-05T12:00:00.000Z", start: "2026-09-05", end: "2026-09-05", periodDays: 1, cookEveryDays: 1,
      menuStyle: "budget", mealSlots: [slot], recipeMethods: { [id]: "original" },
      people: [{ id: "p1", name: "Я", daily: { kcal: 2200, protein: 120, fat: 70, carbs: 272.5 }, includedSlots: [slot] }],
      batches: [{ id: "b1", index: 0, start: "2026-09-05", end: "2026-09-05", days: 1 }],
      selections: { [key]: id }, selectionAssignments: { [key]: [{ recipeId: id, personIds: ["p1"] }] }, shopping: [],
      cookedBatchIds: ["b1"], cookedWeights: { [`${key}:${id}`]: { total: 550 } }, cookingSignatures: { b1: "retained" }, nutritionHistory: { historical: { recipeId: id } },
    };
    const restored = app.normalizePlan(plain(plan));
    assert.equal(restored.selections[key], id);
    assert.equal(restored.selectionAssignments[key][0].recipeId, id);
    for (const field of ["cookedBatchIds", "cookedWeights", "cookingSignatures", "nutritionHistory", "recipeMethods"]) assert.deepEqual(plain(restored[field]), plan[field], `${id}: ${field}`);
    assert.ok(restored.shopping.length > 0);
    assert.ok(app.recipeDisplaySteps(recipe).length > 0);
    assert.ok(app.retainsExistingRecipeRoute(recipe, undefined, restored.recipeMethods));
    assert.equal(validatePlanForPersistence(restored).valid, true, id);
    assert.deepEqual(plain(app.recipeCookingSession(restored.people, slot, recipe, 1)), plain(app.recipeCookingSession(plan.people, slot, recipe, 1)), `${id}: no hidden recalculation`);
  }
});

test("the UI uses visible cards for search but keeps existing selections independent of visibility", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const catalogue = page.slice(page.indexOf("function RecipesScreen("), page.indexOf("function ShoppingScreen("));
  assert.match(catalogue, /newMenuRecipes\.filter/);
  assert.doesNotMatch(catalogue, /productionRecipes/);
  assert.match(page, /Заготовка сохранена в вашем плане/);
  const retention = page.slice(page.indexOf("const validSelectionAssignments ="), page.indexOf("const validSelections ="));
  assert.match(retention, /isProductionReadyRecipe\(recipe\)/);
  assert.doesNotMatch(retention, /isAvailableForNewMenus/);
});
