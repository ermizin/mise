import assert from "node:assert/strict";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const catalog = await recipeCatalog();
const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const allocation = await loadTypeScriptModule(new URL("../domain/portion-allocation.ts", import.meta.url));
const person = (id, kcal, proteinShare) => ({
  id, name: id,
  daily: { kcal, protein: kcal * proteinShare / 4, fat: kcal * 0.3 / 9, carbs: kcal * (0.7 - proteinShare) / 4 },
  includedSlots: catalog.allMealSlots, hardExclusions: [], dislikes: [],
});

test("one shared casserole reports the nutrition that its containers can actually hold", () => {
  const recipe = catalog.recipesById["goodfood-chicken-pasta-bake"];
  const people = [person("A", 2100, 0.2), person("B", 2100, 0.4)];
  for (const days of [1, 3, 6]) {
    const session = catalog.recipeCookingSession(people, "dinner", recipe, days);
    assert.equal(session.viable, days !== 1, `days=${days}: pooled protein floor must be respected`);
    const family = catalog.recipeFamilyFor(recipe);
    const cooked = engine.nutritionForFamily(family, session.cookingAmounts);
    const cookedWeight = 1000 * days;
    const containers = allocation.allocateMixedDish(cookedWeight, session.portions.map((portion, index) => ({
      personId: people[index].id, label: people[index].name, portionCount: days,
      nutritionShare: portion.actual.kcal * days,
    })));
    for (let index = 0; index < people.length; index += 1) {
      const portion = session.portions[index];
      const grams = containers.allocations[index].totalG / days;
      for (const key of ["kcal", "protein", "fat", "carbs"]) {
        const physicallyAllocated = cooked[key] * grams / cookedWeight;
        assert.ok(Math.abs(physicallyAllocated - portion.actual[key]) <= (key === "kcal" ? 1 : 0.2),
          `${days}/${people[index].id}/${key}: actual=${physicallyAllocated}, reported=${portion.actual[key]}`);
      }
    }
    for (const ingredient of family.ingredients) {
      const allocated = session.portions.reduce((sum, portion) => sum + portion.solvedAmounts[ingredient.sourceIngredientId], 0) * days;
      assert.ok(Math.abs(allocated - session.cookingAmounts[ingredient.sourceIngredientId]) < 0.000001);
    }
  }
});

test("canonical ingredients expose separate steak and rice without mislabelling mixed rice bowls", () => {
  const components = catalog.portionComponents(catalog.recipesById["goodfood-steak-broccoli-protein-pots"]);
  assert.deepEqual(Array.from(components, (component) => component.id), ["protein", "carbs"]);
  assert.ok(components[0].ingredients.some((ingredient) => ingredient.canonicalIngredientId?.includes("beef")));
  assert.ok(components[1].ingredients.some((ingredient) => ingredient.canonicalIngredientId === "rice_raw"));
  assert.equal(catalog.portionComponents(catalog.recipesById["tmpm-24949"]).length, 0);
  assert.equal(catalog.portionComponents(catalog.recipesById["goodfood-chicken-pasta-bake"]).length, 0);
});

test("different calorie targets receive the same cooked composition in different amounts", () => {
  const recipe = catalog.recipesById["src-creamy-chicken-pasta"];
  const people = [person("A", 1600, 0.3), person("B", 3100, 0.3)];
  const session = catalog.recipeCookingSession(people, "lunch", recipe, 3);
  assert.equal(session.viable, true);
  const [small, large] = session.portions;
  assert.ok(large.actual.kcal > small.actual.kcal);
  const firstId = Object.keys(session.cookingAmounts)[0];
  const ratio = large.solvedAmounts[firstId] / small.solvedAmounts[firstId];
  for (const id of Object.keys(session.cookingAmounts))
    assert.ok(Math.abs(large.solvedAmounts[id] / small.solvedAmounts[id] - ratio) < 0.000001, id);
});

test("automatic personal fallback never joins an incompatible physical cooking session", () => {
  const people = [person("A", 1600, 0.2), person("B", 3100, 0.4)];
  for (const slot of ["breakfast", "lunch", "dinner"])
    for (const style of ["protein", "budget"]) {
      const assignments = catalog.automaticAssignmentsFor(slot, style, people, 3, new Set(), new Set(), []);
      assert.ok(assignments.length, `${slot}/${style}`);
      assert.equal(new Set(assignments.map((assignment) => assignment.recipeId)).size, assignments.length);
      assert.deepEqual(Array.from(assignments).flatMap((assignment) => Array.from(assignment.personIds)).sort(), ["A", "B"]);
      for (const assignment of assignments) {
        const eaters = people.filter((eater) => assignment.personIds.includes(eater.id));
        assert.equal(catalog.recipeCookingSession(eaters, slot, catalog.recipesById[assignment.recipeId], 3).viable, true);
      }
    }
});
