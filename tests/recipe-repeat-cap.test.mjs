import assert from "node:assert/strict";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const catalog = await recipeCatalog();

test("a capacity record does not block a high-calorie meal made of ordinary servings", () => {
  const person = {
    id: "high-target",
    name: "Высокая цель",
    daily: { kcal: 5000, protein: 200, fat: 120, carbs: 780 },
    includedSlots: ["breakfast"],
    hardExclusions: [],
    dislikes: [],
  };
  const recipe = catalog.recipesById["tmpm-26414"];
  const portion = catalog.portionFor(person, "breakfast", recipe);
  const session = catalog.recipeCookingSession([person], "breakfast", recipe, 1);

  assert.equal(portion.target.kcal, 1250);
  assert.equal(portion.engine, "recipe-family-v1");
  assert.equal(portion.sourceServingRepeat, 2);
  assert.equal(session.viable, true);
  assert.ok(Object.keys(session.cookingAmounts).length > 0);
  assert.ok(portion.actual.kcal >= portion.target.kcal * 0.9);
  assert.ok(portion.actual.kcal <= portion.target.kcal * 1.05);
});
