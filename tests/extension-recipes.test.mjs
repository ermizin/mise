import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildExtensionRecipeCatalog,
  projectExtensionRecipe,
} from "../scripts/build-extension-recipe-catalog.mjs";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [source, runtimeCatalog, registry] = await Promise.all([
  readJson("../data/extension-recipes.json"),
  readJson("../data/recipe-runtime-catalog.json"),
  readJson("../data/plan-recipe-registry.json"),
]);
const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const { validatePlanForPersistence } = await loadTypeScriptModule(
  new URL("../lib/plan-validation.ts", import.meta.url),
);
const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));
const app = await recipeCatalog();
const plain = (value) => JSON.parse(JSON.stringify(value));
const cardById = new Map(source.recipes.map((card) => [card.id, card]));
const changed = (id, change) => {
  const card = structuredClone(cardById.get(id));
  assert.ok(card, `${id} is in the package`);
  change(card);
  return card;
};

test("the checked-in catalog is exactly what the extension source builds", async () => {
  const built = await buildExtensionRecipeCatalog();
  assert.deepEqual(plain(runtimeCatalog.extensionRecipes), plain(built.recipes));
  assert.deepEqual(plain(runtimeCatalog.extensionCoverage), plain(built.coverage));
  // 80 карточек от 2026-09-30 и 9 простых карточек с клетчаткой от 2026-10-12.
  assert.deepEqual(plain(built.coverage), {
    total: 89,
    byMenu: { simple: 25, protein: 44, budget: 52, vegan: 24, paleo: 24 },
    bySlot: { breakfast: 26, lunch: 36, dinner: 0, snack1: 27 },
    freezable: 64,
    withoutPhoto: 89,
  });
});

/* Правило направления проверено дважды: сборщиком и здесь, по другим признакам.
   Сборщик смотрит на категорию и аллергены профиля, тест — ещё и на слова в
   названии продукта и в специях, которые в расчёт КБЖУ не входят. */
test("a vegan card has nothing of animal origin, a paleo card no grain, legume or dairy", () => {
  const animal = /мяс|куриц|курин|индей|говя|свин|фарш|печен[ьи]|рыб|тунец|лосос|минтай|треск|кревет|яйц|яйко|молок|творог|сыр|йогурт|сливк|сливочн|сметан|кефир|мёд|желатин/iu;
  const plantException = /соев|кокос|овсян(?:ое|ого) молок|миндальн(?:ое|ого) молок/iu;
  const notPaleo = /рис|греч|овсян|пшен|перлов|булгур|кускус|макарон|паст[аы]\b|лапш|хлеб|мук[аи] пшен|фасол|нут|чечев|горох|соев|тофу|арахис|молок|творог|сыр|йогурт|сливк|сметан|сахар|картоф/iu;
  const paleoException = /кокосов|миндальн(?:ая|ой) мук|цветн(?:ая|ой) капуст/iu;
  const failures = [];
  for (const card of source.recipes) {
    const names = [
      ...card.ingredients.map((item) => item.name),
      ...(card.pantryIngredients ?? []).map((item) => item.name),
    ];
    const products = card.ingredients.map((item) => engine.canonicalIngredients[item.canonicalIngredientId]);
    if (card.menus.includes("vegan")) {
      for (const name of names)
        if (animal.test(name) && !plantException.test(name)) failures.push(`${card.id}: ${name}`);
      for (const product of products)
        if (["meat", "fish", "seafood", "egg", "dairy"].includes(product.category) || product.allergens.some((allergen) => ["milk", "egg", "fish"].includes(allergen)))
          failures.push(`${card.id}: ${product.canonicalName}`);
    }
    if (card.menus.includes("paleo")) {
      for (const name of names)
        if (notPaleo.test(name) && !paleoException.test(name)) failures.push(`${card.id}: ${name}`);
      for (const product of products)
        if (["grain", "legume", "dairy"].includes(product.category) || product.allergens.some((allergen) => ["milk", "gluten", "soy", "peanuts"].includes(allergen)))
          failures.push(`${card.id}: ${product.canonicalName}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.equal(source.recipes.some((card) => card.menus.includes("vegan") && card.menus.includes("paleo")), false);
});

test("the builder refuses a card that breaks what its direction promises", () => {
  assert.throws(
    () => projectExtensionRecipe(changed("mise-vegan-tofu-scramble", (card) => {
      const grams = engine.canonicalIngredients.egg_raw.unit.gramsPerUnit;
      card.ingredients.push({ name: "Яйцо", grams, canonicalIngredientId: "egg_raw", role: "protein", range: [1, 1] });
    })),
    /веганское/u,
    "an egg in a vegan card",
  );
  assert.throws(
    () => projectExtensionRecipe(changed("mise-paleo-salmon-vegetables", (card) => {
      card.ingredients.push({ name: "Рис", grams: 60, canonicalIngredientId: "rice_raw", role: "carb", range: [0.5, 1.5] });
    })),
    /палео/u,
    "rice in a paleo card",
  );
  assert.throws(
    () => projectExtensionRecipe(changed("mise-vegan-hummus-carrot", (card) => {
      card.menus.push("protein");
    })),
    /high-protein/u,
    "a dish with little protein cannot be called high-protein",
  );
  assert.throws(
    () => projectExtensionRecipe(changed("mise-simple-oven-omelette", (card) => {
      card.steps[0] = `${card.steps[0]} Добавьте 200 г молока.`;
    })),
    /fixed amount/u,
    "a step cannot fix an amount the plan scales",
  );
  assert.throws(
    () => projectExtensionRecipe(changed("mise-simple-oven-omelette", (card) => {
      card.activeMinutes = 25;
      card.totalMinutes = Math.max(card.totalMinutes, 25);
    })),
    /time/u,
    "a simple dish takes at most twenty minutes of work",
  );
  assert.throws(
    () => projectExtensionRecipe(changed("mise-vegan-chickpea-tahini-salad", (card) => {
      card.storage.refrigeratorDays = 6;
    })),
    /refrigerator/u,
    "no dish is kept in the fridge for six days",
  );
});

test("a card's numbers are the sum of its products, nothing else", () => {
  const round = (value) => Math.round(value * 10) / 10;
  for (const recipe of runtimeCatalog.extensionRecipes) {
    const card = cardById.get(recipe.id);
    const expected = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (const item of card.ingredients) {
      const profile = engine.canonicalIngredients[item.canonicalIngredientId].nutritionPer100g;
      for (const key of Object.keys(expected)) expected[key] += (profile[key] * item.grams) / 100;
    }
    for (const key of Object.keys(expected))
      assert.ok(
        Math.abs(recipe.macros[key] - expected[key]) <= (key === "kcal" ? 1 : 0.15),
        `${recipe.id} ${key}: card ${recipe.macros[key]}, products ${round(expected[key])}`,
      );
    assert.deepEqual(plain(recipe.recipeFamily.miseCalculatedNutrition), plain(recipe.macros));
    const appRecipe = app.recipesById[recipe.id];
    assert.deepEqual(plain(appRecipe.macros), plain(recipe.macros), `${recipe.id}: the app shows the calculated numbers`);
    assert.equal(appRecipe.provenance.imageUrl ?? null, null, `${recipe.id}: no photo is claimed`);
  }
});

test("a card names the cookware it declares, not what a verb in a step suggests", () => {
  const words = { pot: "кастрюля", pan: "сковорода", oven: "духовка", blender: "блендер", multicooker: "мультиварка" };
  for (const card of source.recipes) {
    const description = app.recipesById[card.id].effortDescription.toLowerCase();
    for (const [equipment, word] of Object.entries(words))
      assert.equal(
        description.includes(word),
        card.equipment.includes(equipment),
        `${card.id}: «${description}» against ${card.equipment.join(", ") || "no appliance"}`,
      );
  }
});

test("every card is solved inside the calorie corridor over its whole working range", (t) => {
  const failures = [];
  let solved = 0;
  engine.resetRecipeSolverCache();
  for (const recipe of runtimeCatalog.extensionRecipes) {
    const family = recipe.recipeFamily;
    assert.ok(family.maxViableCalories > family.minViableCalories * 1.5, `${recipe.id}: the range is wide enough to serve different people`);
    // The lower end is included: it is where a small snack for a 1200 kcal
    // day lands. The upper end follows the engine's convention for every
    // family (largest reachable portion / 0.9), so the last few percent are
    // decided by the viability check of the cooking session, not promised here.
    for (const position of [0, 0.3, 0.6, 0.9]) {
      const targetCalories = Math.round(
        family.minViableCalories + (family.maxViableCalories - family.minViableCalories) * position,
      );
      const result = engine.solveRecipeFamily(family, { targetCalories, proteinGoalMode: "soft", proteinFloor: 0 });
      solved += 1;
      if (!result.viable) {
        failures.push(`${recipe.id} at ${targetCalories}: ${result.reason ?? "not viable"}`);
        continue;
      }
      if (result.nutrition.kcal < targetCalories * 0.9 || result.nutrition.kcal > targetCalories * 1.05)
        failures.push(`${recipe.id} at ${targetCalories}: solved ${result.nutrition.kcal}`);
      for (const ingredient of family.ingredients) {
        const amount = result.amounts[ingredient.sourceIngredientId];
        if (amount < ingredient.minAmount - 0.51 || amount > ingredient.maxAmount + 0.51)
          failures.push(`${recipe.id} at ${targetCalories}: ${ingredient.canonicalIngredientId} ${amount} is outside ${ingredient.minAmount}…${ingredient.maxAmount}`);
      }
    }
  }
  t.diagnostic(`solved=${solved}`);
  assert.deepEqual(failures, []);
});

test("vegan and paleo menus can be assembled for every meal and batch length", (t) => {
  const failures = [];
  for (const style of ["vegan", "paleo"])
    for (const kcal of [1600, 2000, 2400, 2800])
      for (const days of [3, 4, 5, 7])
        for (const slot of app.allMealSlots) {
          const person = {
            id: "p1", name: "Я",
            daily: { kcal, protein: Math.round((kcal * 0.25) / 4), fat: Math.round((kcal * 0.3) / 9), carbs: Math.round((kcal * 0.45) / 4) },
            includedSlots: [...app.allMealSlots],
          };
          const options = app.candidateRecipes(slot, style, [person], days, { limit: "all" });
          t.diagnostic(`${style} ${kcal} d${days} ${slot}: ${options.length}`);
          if (options.length < 2) failures.push(`${style} ${kcal}kcal d${days} ${slot}: ${options.length}`);
          for (const recipe of options) {
            if (!recipe.tags.includes(style)) failures.push(`${recipe.id} is offered as ${style}`);
            const session = app.recipeCookingSession([person], slot, recipe, days);
            const portion = session.portions[0];
            if (!session.viable) failures.push(`${recipe.id}: offered but cannot be cooked`);
            if (recipe.storageDays < days && !recipe.freezable)
              failures.push(`${recipe.id}: a ${days}-day batch outlives the dish`);
            if (!Number.isFinite(portion.actual.kcal)) failures.push(`${recipe.id}: no calculated portion`);
          }
        }
  assert.deepEqual(failures, []);
});

/* Дополнение от 2026-10-12 по комментариям на Пикабу («Где овощи? Где
   клетчатка?»). Неделя «Простых» завтракала творожной запеканкой и сырниками
   с 1 г клетчатки: из простых завтраков на партию в 3 дня проходило всего
   шесть, а овсяные проигрывали по совпадению с БЖУ из-за недобора белка.
   Новый простой завтрак обязан выдерживать и белок, и клетчатку, и партию. */
test("the fiber cards of 2026-10-12 hold protein, fiber and a three-day batch", () => {
  const pack = source.recipes.filter((card) => card.editorialStatus === "authored_and_calculated_2026-10-12");
  assert.deepEqual(
    Object.fromEntries(["breakfast", "lunch", "snack1"].map((slot) => [slot, pack.filter((card) => card.slot === slot).length])),
    { breakfast: 6, lunch: 1, snack1: 2 },
  );
  const failures = [];
  const canonicalSet = (record) => new Set(record.recipeFamily.ingredients.map((item) => item.canonicalIngredientId));
  const others = [...runtimeCatalog.recipes, ...(runtimeCatalog.simpleRecipes ?? []), ...runtimeCatalog.extensionRecipes];
  for (const card of pack) {
    const record = runtimeCatalog.extensionRecipes.find((recipe) => recipe.id === card.id);
    const { kcal, protein } = record.macros;
    const fiberPerThousand = (engine.fiberForFamily(record.recipeFamily) / kcal) * 1000;
    if (!card.menus.includes("simple")) failures.push(`${card.id}: not a simple card`);
    if (card.storage.refrigeratorDays < 3 && !card.storage.freezable) failures.push(`${card.id}: does not survive a three-day batch`);
    // Не дубль: не больше 80% продуктов карточки встречаются в одной другой.
    const own = canonicalSet(record);
    for (const other of others) {
      if (other.id === card.id) continue;
      const shared = [...canonicalSet(other)].filter((id) => own.has(id)).length;
      if (shared / own.size >= 0.8) failures.push(`${card.id}: ${Math.round((shared / own.size) * 100)}% of its products repeat ${other.id}`);
    }
    // Льняного семени не больше 15 г на порцию даже на верхней границе: в
    // ночной овсянке оно сырое, а BfR советует не больше 15 г за приём.
    const flax = record.recipeFamily.ingredients.find((item) => item.canonicalIngredientId === "flaxseed_raw");
    if (flax && flax.maxAmount > 15) failures.push(`${card.id}: up to ${flax.maxAmount} g of flaxseed a portion`);
    // Замороженные ягоды переносят норовирус и гепатит A: блюдо, которое не
    // греют, не предлагает их без кипячения.
    const heated = card.equipment.some((item) => ["stove", "oven", "multicooker", "air_fryer", "microwave"].includes(item));
    const text = [...card.steps, card.substitution, card.flavourTip].join(" ");
    if (!heated && /заморож/iu.test(text) && !/кипени/iu.test(text)) failures.push(`${card.id}: offers frozen fruit for a dish that is never heated`);
    if (card.slot !== "breakfast") {
      if (fiberPerThousand < 20) failures.push(`${card.id}: ${fiberPerThousand.toFixed(1)} g fiber per 1000 kcal`);
      continue;
    }
    if ((protein * 4) / kcal < 0.28) failures.push(`${card.id}: ${Math.round((protein * 400) / kcal)}% of energy from protein`);
    if (fiberPerThousand < 15) failures.push(`${card.id}: ${fiberPerThousand.toFixed(1)} g fiber per 1000 kcal`);
    for (const daily of [1500, 1800, 2200]) {
      const person = {
        id: "p1", name: "Я",
        daily: nutrition.recalculateDailyMacros(daily, { kcal: 0, protein: 0, fat: 0, carbs: 0 }, "balanced"),
        includedSlots: ["breakfast", "lunch", "dinner"],
      };
      const session = app.recipeCookingSession([person], "breakfast", app.recipesById[card.id], 3);
      const fit = app.fitScoreForSession(session);
      if (!session.viable || fit < 95) failures.push(`${card.id} at ${daily} kcal: ${session.viable ? `fit ${fit}` : "not viable"}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("a vegan or paleo plan is accepted by the server, an unknown direction is not", () => {
  const registryIds = new Set(registry.recipes.map((recipe) => recipe.id));
  for (const style of ["vegan", "paleo"]) {
    const recipe = app.productionRecipes.find((item) => item.tags.includes(style) && item.slot === "lunch" && item.id.startsWith("mise-"));
    assert.ok(recipe && registryIds.has(recipe.id));
    const plan = {
      id: `extension-${style}`, start: "2026-10-05", end: "2026-10-07", periodDays: 3, cookEveryDays: 3,
      menuStyle: style, mealSlots: ["lunch", "dinner"],
      kitchenEquipment: ["stove", "pot", "pan", "oven", "baking_dish"],
      recipeMethods: { [recipe.id]: "original" },
      people: [{ id: "p1", name: "Я", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch", "dinner"] }],
      batches: [{ id: "b1", index: 0, start: "2026-10-05", end: "2026-10-07", days: 3 }],
      // Обед и ужин могут быть одним блюдом: это решение владельца продукта.
      selections: { "b1:lunch": recipe.id, "b1:dinner": recipe.id },
      selectionAssignments: {
        "b1:lunch": [{ recipeId: recipe.id, personIds: ["p1"] }],
        "b1:dinner": [{ recipeId: recipe.id, personIds: ["p1"] }],
      },
      shopping: [],
    };
    const accepted = validatePlanForPersistence(plan);
    assert.equal(accepted.valid, true, `${style}: ${accepted.valid ? "" : accepted.error}`);
    const rejected = validatePlanForPersistence({ ...plan, menuStyle: "carnivore" });
    assert.equal(rejected.valid, false);
    assert.equal(rejected.status, 400);
  }
});
