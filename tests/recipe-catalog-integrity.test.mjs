import assert from "node:assert/strict";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const app = await recipeCatalog();
const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const sourcePage = (recipe) =>
  String(recipe.provenance?.sourceUrl ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();

test("a source page reaches new menus as one dish, not as an old and a new card", () => {
  const retired = app.retiredDuplicateRecipes;
  assert.equal(Object.keys(retired).length, 9);
  for (const [id, entry] of Object.entries(retired)) {
    const old = app.recipesById[id];
    const current = app.recipesById[entry.replacedBy];
    assert.ok(old && current, `${id} and its replacement exist`);
    assert.equal(old.title, entry.title, `${id}: the reviewed title cannot drift`);
    assert.ok(entry.reason.length > 20);
    assert.equal(sourcePage(old), sourcePage(current), `${id} and ${entry.replacedBy} adapt the same page`);
    assert.ok(app.productionRecipes.includes(old), `${id}: kept for saved plans`);
    assert.ok(!app.newMenuRecipes.includes(old), `${id}: not offered again`);
    assert.ok(app.newMenuRecipes.includes(current), `${entry.replacedBy}: offered`);
  }
  // Several dishes may legitimately share a page (a snack round-up, a recipe
  // with a chicken and a beef variant), but never a hand-written card and the
  // audited card of the same dish.
  const pages = new Map();
  for (const recipe of app.newMenuRecipes) {
    const page = sourcePage(recipe);
    if (page) pages.set(page, [...(pages.get(page) ?? []), recipe.id]);
  }
  for (const [page, ids] of pages)
    assert.ok(
      ids.length === 1 || !ids.some((id) => id.startsWith("src-")),
      `${page} is offered as ${ids.join(" and ")}`,
    );
});

test("a saved plan with a retired dish still opens, calculates and saves", () => {
  for (const id of Object.keys(app.retiredDuplicateRecipes)) {
    const recipe = app.recipesById[id];
    const key = `b1:${recipe.slot}`;
    const plan = {
      id: "retired-legacy", createdAt: "2026-09-05T12:00:00.000Z", start: "2026-09-05", end: "2026-09-05", periodDays: 1, cookEveryDays: 1,
      menuStyle: "protein", mealSlots: [recipe.slot], recipeMethods: { [id]: "original" },
      people: [{ id: "p1", name: "Я", daily: { kcal: 2200, protein: 120, fat: 70, carbs: 272.5 }, includedSlots: [recipe.slot] }],
      batches: [{ id: "b1", index: 0, start: "2026-09-05", end: "2026-09-05", days: 1 }],
      selections: { [key]: id }, selectionAssignments: { [key]: [{ recipeId: id, personIds: ["p1"] }] }, shopping: [],
    };
    const restored = app.normalizePlan(plain(plan));
    assert.equal(restored.selections[key], id, `${id}: the selection is kept`);
    assert.ok(restored.shopping.length > 0, `${id}: the shopping list is rebuilt`);
    assert.equal(validatePlanForPersistence(restored).valid, true, `${id}: the server accepts it`);
    assert.ok(app.recipeCookingSession(restored.people, recipe.slot, recipe, 1).viable, `${id}: portions are calculated`);
  }
});

test("every card shows the nutrition its portions are calculated from", () => {
  let checked = 0;
  for (const recipe of app.productionRecipes) {
    const family = app.recipeFamilyFor(recipe);
    assert.ok(family, `${recipe.id} has a Recipe Family`);
    const calculated = engine.nutritionForFamily(family);
    for (const key of ["kcal", "protein", "fat", "carbs"])
      assert.ok(
        Math.abs(recipe.macros[key] - calculated[key]) <= Math.max(1, calculated[key] * 0.01),
        `${recipe.id} «${recipe.title}»: card ${key} ${recipe.macros[key]}, engine ${calculated[key]}`,
      );
    checked += 1;
  }
  assert.ok(checked >= 250, "the whole production catalog is compared");
});

// Fried on a dry non-stick pan, exactly as the source does. Each entry was
// compared with the source ingredient list on 2026-09-29.
const friedWithoutAddedFat = {
  "tmpm-26414": "Вафли обжариваются на антипригарной сковороде; в источнике масла нет.",
  "tmpm-25030": "Панкейки на антипригарной сковороде; в источнике масла нет.",
  "goodfood-steak-broccoli-protein-pots": "Стейк на сухой раскалённой сковороде, как в источнике.",
  "new-home-simple-buckwheat": "Лук и курица на разогретой сковороде без масла, как в источнике.",
};

test("an offered dish counts the fat it is cooked in", () => {
  const fries = /обжар|поджар|жарьте|жарить/iu;
  const uncounted = [];
  for (const recipe of app.newMenuRecipes) {
    const family = app.recipeFamilyFor(recipe);
    const steps = app.recipeDisplaySteps(recipe).join(" ");
    const hasFat = family.ingredients.some(
      (ingredient) => engine.canonicalIngredients[ingredient.canonicalIngredientId].category === "fat",
    );
    const nutrition = engine.nutritionForFamily(family);
    // Frying without any fat in the dish is only plausible when the dish
    // brings its own (mince, bacon, cheese) or the source fries dry.
    if (fries.test(steps) && !hasFat && nutrition.fat < 10 && !friedWithoutAddedFat[recipe.id])
      uncounted.push(`${recipe.id} «${recipe.title}» — ${nutrition.fat} г жира`);
  }
  assert.deepEqual(uncounted, [], "fried dishes with neither cooking fat nor fat of their own");
  for (const id of Object.keys(friedWithoutAddedFat))
    assert.ok(app.newMenuRecipes.some((recipe) => recipe.id === id), `${id}: the reviewed exception still refers to an offered dish`);
});

test("products are counted as themselves, not as a namesake", () => {
  const ids = (recipeId) => app.recipesById[recipeId].ingredients.map((item) => item.canonicalIngredientId);
  for (const id of ["tmpm-23501", "tmpm-23194"]) {
    assert.ok(ids(id).includes("glass_noodles_raw"), `${id}: glass noodles are noodles`);
    assert.ok(!ids(id).includes("sweet_potato_raw"), `${id}: not a sweet potato`);
  }
  assert.ok(ids("tmpm-26689").includes("milk_powder_processed"), "dry milk is not liquid milk");
  for (const id of ["tmpm-26414", "tmpm-22531"]) {
    assert.ok(ids(id).includes("strawberries_raw"), `${id}: strawberries`);
    assert.ok(!ids(id).includes("berries_raw"), `${id}: not blueberries`);
  }
  assert.ok(ids("tmpm-26660").includes("tomato_passata_processed"), "fire-roasted tomatoes are tomatoes");
  // "Rice cakes" are puffed crispbread in one recipe and Korean tteok in another.
  assert.ok(ids("tmpm-25044").includes("tteok_processed") && !ids("tmpm-25044").includes("rice_cake_processed"));
  assert.ok(ids("tmpm-25006-avocado-bean-rice-cakes").includes("rice_cake_processed"));
  assert.ok(app.recipesById["tmpm-25044"].macros.kcal < 600, "tteokbokki is no longer counted as 120 g of crispbread");
  assert.ok(ids("goodfood-steak-broccoli-protein-pots").includes("green_onion_raw"));
  // Four spring onions are about 60 g, not four onion bulbs.
  const pots = app.recipesById["goodfood-steak-broccoli-protein-pots"];
  assert.ok(pots.macros.kcal < 430 && pots.macros.carbs < 60, `steak pots: ${JSON.stringify(pots.macros)}`);
  const noodles = app.recipesById["tmpm-23194"];
  assert.ok(noodles.macros.kcal > 600, `glass noodles carry their starch: ${noodles.macros.kcal} kcal`);
  const profile = (id) => engine.canonicalIngredients[id].nutritionPer100g;
  assert.deepEqual({ ...profile("green_onion_raw") }, { kcal: 32, protein: 1.83, fat: 0.19, carbs: 7.34 });
  assert.deepEqual({ ...profile("glass_noodles_raw") }, { kcal: 351, protein: 0.16, fat: 0.06, carbs: 86.1 });
  assert.deepEqual({ ...profile("milk_powder_processed") }, { kcal: 362, protein: 36.2, fat: 0.77, carbs: 52 });
  assert.deepEqual({ ...profile("strawberries_raw") }, { kcal: 32, protein: 0.67, fat: 0.3, carbs: 7.68 });
});

test("the recipe card weighs what the shopping list weighs", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const ts = (await import("typescript")).default;
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("function roundedIngredientAmount(");
  const end = page.indexOf("function procedureIngredientAmountLabel(");
  assert.ok(start >= 0 && end > start, "the amount label is present");
  const context = {
    canonicalIngredients: engine.canonicalIngredients,
    canonicalIdForIngredient: app.canonicalIdForIngredient,
    normalizeShoppingIngredient: app.normalizeShoppingIngredient,
    round: app.round,
  };
  runInNewContext(
    ts.transpileModule(`${page.slice(start, end)}\nglobalThis.label = ingredientAmountLabel;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  const ingredient = (canonicalIngredientId, unit) => ({ id: canonicalIngredientId, canonicalIngredientId, name: canonicalIngredientId, unit, group: "" });
  // 100 ml of butter is 91 g; 100 ml of flour is 50 g.
  assert.equal(context.label(ingredient("butter_processed", "мл"), 100), "90 г");
  assert.equal(context.label(ingredient("wheat_flour_raw", "мл"), 100), "50 г");
  assert.equal(context.label(ingredient("yogurt_processed", "мл"), 200), "205 г");
  assert.equal(context.label(ingredient("olive_oil_processed", "мл"), 30), "30 мл", "a liquid stays in millilitres");
  assert.equal(context.label(ingredient("milk_processed", "мл"), 200), "200 мл");
  assert.equal(context.label(ingredient("chicken_raw", "г"), 430), "430 г");
  assert.equal(context.label(ingredient("onion_raw", "шт."), 2), "2 шт.", "counted vegetables stay counted");

  let solidsInMillilitres = 0;
  for (const recipe of app.newMenuRecipes)
    for (const item of recipe.ingredients) {
      if (item.unit !== "мл") continue;
      const bought = app.normalizeShoppingIngredient(item, item.quantity).unit;
      const shown = context.label(item, item.quantity).split(" ").at(-1);
      assert.equal(shown, bought, `${recipe.id}: ${item.name} is shown in ${shown} and bought in ${bought}`);
      if (bought === "г") solidsInMillilitres += 1;
    }
  assert.ok(solidsInMillilitres > 300, "the catalog really contains such lines");
});
