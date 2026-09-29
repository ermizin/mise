import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRecipeMenuCatalog, renderRecipeMenuCatalog } from "../scripts/build-recipe-menu-catalog.mjs";
import { recipeCatalog } from "./recipe-session-fixture.mjs";

const checkedIn = await readFile(new URL("../docs/recipe-catalog.md", import.meta.url), "utf8");
const catalog = await buildRecipeMenuCatalog();
const app = await recipeCatalog();

test("the published catalogue is the one the current recipes produce", () => {
  assert.equal(checkedIn, renderRecipeMenuCatalog(catalog));
});

test("the catalogue lists five menus and every meal of each", () => {
  assert.deepEqual(catalog.menus.map((menu) => menu.id), ["simple", "protein", "budget", "vegan", "paleo"]);
  for (const menu of catalog.menus) {
    assert.ok(menu.label && menu.description, `${menu.id} is named for a person, not by its code`);
    for (const group of menu.groups)
      assert.ok(group.recipes.length >= 6, `${menu.id}/${group.id}: ${group.recipes.length} dishes`);
    assert.equal(
      new Set(menu.groups.flatMap((group) => group.recipes.map((recipe) => recipe.id))).size,
      menu.total,
      `${menu.id}: every dish of the menu appears under a meal`,
    );
  }
});

test("a dish is in the catalogue exactly when the wizard can offer it", () => {
  for (const menu of catalog.menus)
    for (const slot of app.allMealSlots) {
      const group = menu.groups.find((item) => item.slots.includes(slot));
      const listed = new Set(group.recipes.filter((recipe) => recipe.slots.includes(slot)).map((recipe) => recipe.id));
      // Без людей и с любой кухней мастер показывает всё, что подходит меню и
      // приёму пищи; срок хранения на один день не ограничивает ничего.
      const offered = Array.from(app.candidateRecipes(slot, menu.id, [], 1, { limit: "all" }), (recipe) => recipe.id);
      assert.deepEqual(
        offered.filter((id) => !listed.has(id)),
        [],
        `${menu.id}/${slot}: offered by the wizard but missing from the catalogue`,
      );
      assert.deepEqual(
        [...listed].filter((id) => !offered.includes(id)).filter((id) => app.recipeSupportsEquipment(app.recipesById[id])),
        [],
        `${menu.id}/${slot}: listed but never offered`,
      );
    }
});

test("retired duplicates, preparations and unverified diet cards stay out", () => {
  const listed = new Set(catalog.menus.flatMap((menu) => menu.groups.flatMap((group) => group.recipes.map((recipe) => recipe.id))));
  for (const id of [...Object.keys(app.retiredDuplicateRecipes), ...Object.keys(app.hiddenPreparationRecipes)])
    assert.equal(listed.has(id), false, `${id} is not offered for new menus`);
  for (const menu of catalog.menus.filter((item) => item.id === "vegan" || item.id === "paleo"))
    for (const group of menu.groups)
      for (const recipe of group.recipes)
        assert.ok(recipe.id.startsWith("mise-"), `${recipe.id}: only a card checked against the ${menu.id} rules`);
});
