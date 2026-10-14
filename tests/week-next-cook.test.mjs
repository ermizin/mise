import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const app = await recipeCatalog();
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/* Партия 2 плана по умолчанию 14–20 октября: ночная овсянка (485 минут
   всего, из них 480 — холодильник), тофу с гречкой и куриное рагу.
   Карточка «Следующая готовка» складывала общее время и показывала
   «~585 мин», а экран готовки той же партии — 35 минут активного времени. */
const batch = { id: "b2", index: 1, start: "2026-10-17", end: "2026-10-19", days: 3 };
const dishes = {
  breakfast: "new-oats-carrot",
  lunch: "mise-vegan-tofu-buckwheat-broccoli",
  dinner: "goodfood-family-meals-chicken-veg-casserole",
};
function plan(selected = dishes) {
  const slots = Object.keys(selected);
  return {
    id: "week-next-cook",
    people: [{ id: "a", name: "Я", daily: { kcal: 2460, protein: 117, fat: 82, carbs: 313 }, includedSlots: slots }],
    mealSlots: slots,
    selections: Object.fromEntries(slots.map((slot) => [`b2:${slot}`, selected[slot]])),
    selectionAssignments: Object.fromEntries(
      slots.map((slot) => [`b2:${slot}`, [{ recipeId: selected[slot], personIds: ["a"] }]]),
    ),
    batches: [batch],
  };
}

test("the batch figure is active time, so an overnight fridge rest never becomes cooking minutes", () => {
  const model = app.buildBatchCookingModel(plan(), batch);
  assert.equal(model.blockers.length, 0);
  assert.equal(model.dishes.length, 3);
  assert.equal(model.totalPortions, 9);
  assert.equal(model.activeMinutes, 35);
  assert.equal(
    model.activeMinutes,
    model.dishes.reduce(
      (sum, { recipe }) =>
        sum + (app.planCookingMethod(recipe, plan()).activeMinutes ?? recipe.effort.activeMinutes),
      0,
    ),
    "the figure is the sum of the dishes' active minutes",
  );
  assert.ok(
    model.activeMinutes < app.recipesById[dishes.breakfast].time,
    "the oats' 480 minutes in the fridge cannot reach the batch figure",
  );
});

test("a blocked batch is recognisable, so the card can stay silent about minutes", () => {
  const model = app.buildBatchCookingModel(
    plan({ ...dishes, lunch: "recipe-that-does-not-exist" }),
    batch,
  );
  assert.ok(model.blockers.length > 0);
});

function slice(source, start) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} is present`);
  const to = source.indexOf("\nfunction ", from + start.length);
  return source.slice(from, to > from ? to : undefined);
}

test("the week card and the recipe button show the cooking screen's active minutes", async () => {
  const page = await read("app/page.tsx");
  const week = slice(page, "function WeekScreen(");
  assert.match(week, /buildBatchCookingModel\(activePlan, nextCook\)/);
  assert.match(week, /nextCookModel\.blockers\.length === 0/, "no minutes while the batch is blocked");
  assert.match(week, /активно&nbsp;≈&nbsp;\{nextCookActiveMinutes\}&nbsp;мин/, "the number stays with its unit");
  assert.doesNotMatch(week, /nextCookRecipes\.reduce\([\s\S]{0,200}recipe\.time/, "total times are not summed");
  assert.doesNotMatch(
    week.slice(week.indexOf("const activePlan = plan;")),
    /\buse(Memo|State|Effect|Callback|Ref)\(/,
    "no hook after WeekScreen's early returns",
  );

  const recipe = slice(page, "function RecipeView(");
  assert.match(recipe, /buildBatchCookingModel\(plan, batch\)/);
  assert.match(recipe, /активно ≈ \{batchActiveMinutes\} мин на партию/);
  assert.doesNotMatch(recipe, /Начать готовку <span>· \{cookingTime\} мин/);
});

test("the product contract records the decision", async () => {
  const product = await read("PRODUCT.md");
  assert.match(product, /«Следующая готовка»[^\n]*активного времени партии/);
});
