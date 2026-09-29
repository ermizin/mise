import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
const catalog = await recipeCatalog();

const shelves = new Set([
  "Бакалея",
  "Крупы и бобовые",
  "Крупы и макароны",
  "Масла и соусы",
  "Молочное",
  "Мясо и птица",
  "Овощи и фрукты",
  "Рыба и морепродукты",
  "Соусы и специи",
]);

test("a product has one shelf, whichever recipe brings it into the plan", () => {
  const shelfByProduct = new Map();
  for (const recipe of catalog.productionRecipes)
    for (const ingredient of recipe.ingredients) {
      const canonical = catalog.canonicalShoppingIngredient(ingredient);
      if (!canonical) continue;
      const shelf = catalog.shoppingGroupFor(ingredient);
      assert.ok(shelves.has(shelf), `${recipe.id}: ${canonical.canonicalName} is on a known shelf, not «${shelf}»`);
      const known = shelfByProduct.get(canonical.id);
      assert.equal(known ?? shelf, shelf, `${canonical.canonicalName} moved from «${known}» to «${shelf}» in ${recipe.id}`);
      shelfByProduct.set(canonical.id, shelf);
    }
  assert.ok(shelfByProduct.size > 150, "the whole catalog is covered");
});

test("fish is bought with fish and poultry with meat", () => {
  const shelfOf = (canonicalIngredientId) =>
    catalog.shoppingGroupFor({ id: canonicalIngredientId, canonicalIngredientId, name: canonicalIngredientId, group: "Бакалея" });
  assert.equal(shelfOf("cod_raw"), "Рыба и морепродукты");
  assert.equal(shelfOf("salmon_raw"), "Рыба и морепродукты");
  assert.equal(shelfOf("chicken_thigh_raw"), "Мясо и птица");
  assert.equal(shelfOf("rice_raw"), "Крупы и макароны");
  assert.equal(shelfOf("mustard_processed"), "Соусы и специи");
  assert.equal(shelfOf("honey_processed"), "Бакалея", "what has no shelf of its own stays in groceries");
});

test("the shopping list of a plan uses those shelves", () => {
  const mealSlots = ["lunch", "dinner"];
  const kcal = 2100;
  const person = {
    id: "a",
    name: "a",
    daily: nutrition.fitMacrosToCalories(kcal, { protein: (kcal * 0.3) / 4, fat: (kcal * 0.3) / 9, carbs: (kcal * 0.4) / 4 }),
    includedSlots: mealSlots,
    hardExclusions: [],
    dislikes: [],
  };
  const batches = catalog.buildBatches("2026-10-05", 2, 1);
  // One hand-written card and one generated card that both use chicken thigh,
  // plus the baked cod that used to land among the dry goods.
  const selections = {
    [catalog.selectionKey(batches[0], "lunch")]: "src-halal-chicken",
    [catalog.selectionKey(batches[0], "dinner")]: "simple-parsed-main-baked-cod-potato",
    [catalog.selectionKey(batches[1], "lunch")]: "tmpm-28247",
    [catalog.selectionKey(batches[1], "dinner")]: "simple-parsed-main-baked-cod-potato",
  };
  for (const id of Object.values(selections)) assert.ok(catalog.recipesById[id], `${id} is in the catalog`);
  const shopping = catalog.buildShopping({ batches, mealSlots, selections, people: [person] });
  assert.ok(shopping.length > 10);
  const shelfOf = (name) => Array.from(shopping).find((item) => item.name === name)?.group;
  assert.equal(shelfOf("Треска"), "Рыба и морепродукты");
  assert.equal(shelfOf("Куриное бедро без кожи"), "Мясо и птица");
  assert.equal(
    Array.from(shopping).filter((item) => item.name === "Куриное бедро без кожи").length,
    1,
    "both chicken dishes share one line",
  );
  for (const item of shopping) assert.ok(shelves.has(item.group), `${item.name}: «${item.group}»`);
});
