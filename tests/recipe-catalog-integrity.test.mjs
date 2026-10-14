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

const wholegrainBreadSandwiches = [
  "new-sandwich-boiled-chicken",
  "new-sandwich-smoked-chicken",
  "new-sandwich-turkey-ham",
  "new-sandwich-balyk",
  "new-sandwich-caesar",
];
const wholegrainPastaCards = ["goodfood-apple-penne-slaw-walnuts", "goodfood-scandi-beetroot-salmon-pasta"];
const wholegrainFlourCards = [
  "goodfood-mozzarella-pepper-aubergine-calzone",
  "goodfood-wholemeal-wraps-minty-pea-hummus-beetroot",
  "goodfood-sweet-potato-gnocchi-with-tomato-sauce",
  "foodru-oblomov-pepper-beef",
  "foodru-oblomov-pepper-chicken",
];
const wholegrainCouscousCards = ["goodfood-pork-with-cucumber-apricot-couscous"];

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
  // Five sandwiches name wholegrain bread; ciabatta and the other breads stay white.
  const offeredWithWholegrainBread = app.newMenuRecipes
    .filter((recipe) => ids(recipe.id).includes("wholegrain_bread_processed"))
    .map((recipe) => recipe.id);
  assert.deepEqual([...offeredWithWholegrainBread].sort(), [...wholegrainBreadSandwiches].sort());
  for (const id of wholegrainBreadSandwiches) assert.ok(!ids(id).includes("bread_processed"), `${id}: not white bread`);
  for (const id of ["new-sandwich-paprika", "foodru-oblomov-sandwich"]) assert.ok(ids(id).includes("bread_processed"), `${id}: ciabatta is white bread`);
  assert.deepEqual({ ...profile("wholegrain_bread_processed") }, { kcal: 252, protein: 12.4, fat: 3.5, carbs: 42.7 });
  assert.equal(engine.canonicalIngredients.wholegrain_bread_processed.reference.recordId, "172688");
  assert.deepEqual([...engine.canonicalIngredients.wholegrain_bread_processed.allergens], ["gluten"]);
  // Cards that name wholewheat or wholemeal pasta, flour and giant couscous;
  // every other pasta, flour and couscous stays white.
  const offeredWith = (canonicalId) =>
    [...app.newMenuRecipes.filter((recipe) => ids(recipe.id).includes(canonicalId)).map((recipe) => recipe.id)].sort();
  assert.deepEqual(offeredWith("wholegrain_pasta_raw"), [...wholegrainPastaCards].sort());
  assert.deepEqual(offeredWith("wholegrain_flour_raw"), [...wholegrainFlourCards].sort());
  assert.deepEqual(offeredWith("wholegrain_giant_couscous_raw"), [...wholegrainCouscousCards].sort());
  for (const id of [...wholegrainPastaCards, ...wholegrainFlourCards, ...wholegrainCouscousCards])
    for (const white of ["pasta_raw", "wheat_flour_raw", "giant_couscous_raw"]) assert.ok(!ids(id).includes(white), `${id}: not ${white}`);
  assert.ok(ids("tmpm-22968").includes("pasta_raw"), "ordinary pasta stays white");
  assert.ok(ids("tmpm-26358").includes("wheat_flour_raw"), "ordinary flour stays white");
  assert.ok(ids("goodfood-10minute-couscous-salad").includes("couscous_raw"), "ordinary couscous stays white");
  // One SR Legacy record each; wholemeal giant couscous is counted as the
  // whole-wheat pasta it is made like, there is no couscous record for it.
  assert.deepEqual({ ...profile("wholegrain_pasta_raw") }, { kcal: 352, protein: 13.9, fat: 2.93, carbs: 73.4 });
  assert.deepEqual({ ...profile("wholegrain_flour_raw") }, { kcal: 340, protein: 13.2, fat: 2.5, carbs: 72 });
  assert.deepEqual({ ...profile("wholegrain_giant_couscous_raw") }, { ...profile("wholegrain_pasta_raw") });
  for (const [id, recordId] of [["wholegrain_pasta_raw", "169738"], ["wholegrain_flour_raw", "168893"], ["wholegrain_giant_couscous_raw", "169738"]]) {
    const ingredient = engine.canonicalIngredients[id];
    assert.equal(ingredient.reference.recordId, recordId, id);
    assert.equal(ingredient.fiberReference.record, recordId, `${id}: fiber from the same record`);
    assert.deepEqual([...ingredient.allergens], ["gluten"], id);
  }
  // Same measuring units as the white products, so amounts and steps do not move.
  for (const [wholegrain, white] of [["wholegrain_pasta_raw", "pasta_raw"], ["wholegrain_flour_raw", "wheat_flour_raw"], ["wholegrain_giant_couscous_raw", "giant_couscous_raw"]]) {
    assert.deepEqual({ ...engine.canonicalIngredients[wholegrain].unit }, { ...engine.canonicalIngredients[white].unit }, wholegrain);
    assert.equal(engine.canonicalIngredients[wholegrain].densityGPerMl, engine.canonicalIngredients[white].densityGPerMl, wholegrain);
  }
});

test("sandwiches on wholegrain bread carry its macros and fiber", () => {
  // 90 г хлеба по FDC 172688 вместо белого 174924: −11,7 ккал, +3 г белка,
  // −5,7 г углеводов и +3 г клетчатки на базовую порцию.
  const expected = {
    "new-sandwich-boiled-chicken": [{ kcal: 546.8, protein: 50.3, fat: 18.1, carbs: 44 }, 6.4],
    "new-sandwich-smoked-chicken": [{ kcal: 549.9, protein: 48.9, fat: 19.4, carbs: 43 }, 6.2],
    "new-sandwich-turkey-ham": [{ kcal: 530.8, protein: 42.3, fat: 19.7, carbs: 45.4 }, 6.5],
    "new-sandwich-balyk": [{ kcal: 493.8, protein: 43.1, fat: 15.2, carbs: 45 }, 6.4],
    "new-sandwich-caesar": [{ kcal: 540.4, protein: 56.4, fat: 14.9, carbs: 43.2 }, 6.6],
  };
  assert.deepEqual(Object.keys(expected), wholegrainBreadSandwiches);
  for (const [id, [macros, fiber]] of Object.entries(expected)) {
    const recipe = app.recipesById[id];
    assert.deepEqual({ ...recipe.macros }, macros, id);
    assert.equal(engine.fiberForFamily(app.recipeFamilyFor(recipe)), fiber, id);
  }
});

test("wholegrain pasta, flour and giant couscous carry their own macros and fiber", () => {
  // На базовую порцию: 50 г макарон или кускуса по FDC 169738 вместо 169736
  // и 169699 (+3,0 и +2,1 г клетчатки), мука по FDC 168893 вместо 169761 —
  // 100 г в кальцоне (+8 г), 42,5 г в лепёшках (+3,4 г), 50 г в ньокки
  // (+4 г) и 10 г в подливе (+0,8 г). Количества и шаги не меняются.
  const expected = {
    "goodfood-apple-penne-slaw-walnuts": [{ kcal: 440.1, protein: 18.4, fat: 9.8, carbs: 76.9 }, 14.1],
    "goodfood-scandi-beetroot-salmon-pasta": [{ kcal: 557, protein: 26.5, fat: 23.7, carbs: 69.8 }, 15.6],
    "goodfood-mozzarella-pepper-aubergine-calzone": [{ kcal: 532.9, protein: 22.6, fat: 15.3, carbs: 84.1 }, 15.6],
    "goodfood-wholemeal-wraps-minty-pea-hummus-beetroot": [{ kcal: 431.2, protein: 19.6, fat: 14.3, carbs: 62.3 }, 12.7],
    "goodfood-sweet-potato-gnocchi-with-tomato-sauce": [{ kcal: 541.4, protein: 18.9, fat: 8.3, carbs: 103 }, 14.9],
    "foodru-oblomov-pepper-beef": [{ kcal: 403.3, protein: 43.6, fat: 18.4, carbs: 18.2 }, 2.9],
    "foodru-oblomov-pepper-chicken": [{ kcal: 369.3, protein: 47.8, fat: 11, carbs: 18.2 }, 2.9],
    "goodfood-pork-with-cucumber-apricot-couscous": [{ kcal: 549, protein: 33.6, fat: 20.1, carbs: 65.5 }, 12.5],
  };
  assert.deepEqual(Object.keys(expected), [...wholegrainPastaCards, ...wholegrainFlourCards, ...wholegrainCouscousCards]);
  for (const [id, [macros, fiber]] of Object.entries(expected)) {
    const recipe = app.recipesById[id];
    assert.deepEqual({ ...recipe.macros }, macros, id);
    assert.equal(engine.fiberForFamily(app.recipeFamilyFor(recipe)), fiber, id);
  }
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
