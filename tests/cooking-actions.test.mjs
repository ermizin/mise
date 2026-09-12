import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildCookingActionCatalog } from "../scripts/build-cooking-action-catalog.mjs";
import { buildCookingPlanCatalog, productionRecipes } from "../scripts/build-plan-recipe-registry.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { splitCookingActions, formatCookingActionText } = await loadTypeScriptModule(
  new URL("../domain/cooking-actions.ts", import.meta.url),
);
const { backgroundCandidateForAction } = await loadTypeScriptModule(
  new URL("../domain/cooking-evidence.ts", import.meta.url),
);

test("background evidence only accepts a single, source-explicit timer without intervention", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(backgroundCandidateForAction("Запекайте 8–10 минут.", ["oven"]))), {
    durationSeconds: 480,
    durationText: "8–10 минут",
    category: "oven",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(backgroundCandidateForAction("Накройте и томите 10 минут.", ["pot", "stove"]))), {
    durationSeconds: 600,
    durationText: "10 минут",
    category: "covered_simmer",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(backgroundCandidateForAction("Отварите пенне 12 минут.", ["pot", "stove"]))), {
    durationSeconds: 720,
    durationText: "12 минут",
    category: "boil",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(backgroundCandidateForAction("Оставьте в холодильнике на 6–8 часов.", []))), {
    durationSeconds: 21600,
    durationText: "6–8 часов",
    category: "cold_wait",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(backgroundCandidateForAction("Запекайте 25 минут до румяной корочки.", ["oven"]))), {
    durationSeconds: 1500,
    durationText: "25 минут",
    category: "oven",
  });
  for (const text of [
    "Если будете запекать, запекайте 20 минут.",
    "Запекайте 20 минут, или 40 минут из холодильника.",
    "Запекайте 8 минут, затем переверните и готовьте ещё 4 минуты.",
    "Томите 10 минут, помешивая.",
    "Запекайте около 40 минут.",
    "Выпекайте при 175 °C 22 минуты, полностью остудите и при желании покройте выбранной глазурью.",
    "И выпекайте 35–40 минут. Растопите оставшийся шоколад, нанесите сверху и разделите на 6 порций.",
    "Смешайте тесто и выпекайте 20 минут.",
    "Выпекайте 20 минут. При желании покройте глазурью.",
    "Запекайте 17–20 минут, лучше по одному противню за раз для румяности.",
  ]) assert.equal(backgroundCandidateForAction(text, ["oven", "pot", "stove"]), undefined, text);
  assert.equal(
    backgroundCandidateForAction("Запекайте 8 минут,", ["oven"], "Выпекайте 8 минут, переверните и готовьте ещё 4 минуты."),
    undefined,
  );
});

test("splitter preserves every source character and only cuts before an explicit next action", () => {
  const text = "Нарежьте лук, добавьте морковь и тимьян; затем томите 10 минут. Влейте соус и готовьте, помешивая, 8–10 минут.";
  const actions = splitCookingActions(text);
  assert.ok(actions.length >= 4);
  assert.equal(actions.map((action) => action.text).join(""), text);
  for (const action of actions) {
    assert.equal(action.text, text.slice(action.sourceStart, action.sourceEnd));
    assert.ok(action.sourceStart >= 0 && action.sourceEnd > action.sourceStart);
  }
  assert.equal(splitCookingActions("Запекайте 20 минут, или 40 минут из холодильника, помешивая.").length, 1);
  assert.equal(splitCookingActions("Для соуса оставьте 60 г мирина; если его нет, смешайте 45 г воды и 15 г сахара.").length, 1);
  assert.equal(splitCookingActions("Если будете замораживать, остудите и упакуйте.").length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitCookingActions("Нарежьте лук. В миске смешайте его с соусом."))),
    [
      { text: "Нарежьте лук.", sourceStart: 0, sourceEnd: 13 },
      { text: " В миске смешайте его с соусом.", sourceStart: 13, sourceEnd: 44 },
    ],
  );
  assert.equal(splitCookingActions("Промойте и сварите рис.").length, 1);
  assert.equal(splitCookingActions("Накройте и готовьте 20 минут.").length, 1);
  assert.equal(splitCookingActions("Нарежьте помидор и натрите сыр.").length, 2);
  assert.equal(splitCookingActions("Влейте яйца, добавьте помидор и сыр.").length, 2);
  assert.equal(splitCookingActions("Обжарьте лук до золотистости, добавьте морковь и тимьян.").length, 2);
  assert.equal(splitCookingActions("Отварите батат 15 минут до мягкости, разомните с маслом.").length, 2);
  assert.equal(formatCookingActionText(" нарежьте лук, "), "Нарежьте лук.");
  assert.equal(formatCookingActionText(" и добавьте морковь, "), "Добавьте морковь.");
});

test("action catalog is deterministic and covers every production recipe method losslessly", async () => {
  const [first, second, recipes, stored, cookingPlan, storedCookingPlan] = await Promise.all([
    buildCookingActionCatalog(),
    buildCookingActionCatalog(),
    productionRecipes(),
    readFile(new URL("../data/cooking-action-catalog.json", import.meta.url), "utf8").then(JSON.parse),
    buildCookingPlanCatalog(),
    readFile(new URL("../data/cooking-plan-catalog.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(stored, first);
  assert.equal(first.recipeCount, recipes.length);
  assert.equal(first.methodCount, recipes.reduce((sum, recipe) => sum + recipe.equipmentOptions.length, 0));
  assert.equal(cookingPlan.recipeCount, recipes.length);
  assert.deepEqual(storedCookingPlan, cookingPlan);
  assert.ok(cookingPlan.recipes.every((recipe) => recipe.cookingFamily));
  const planIngredientsByRecipe = new Map(cookingPlan.recipes.map((recipe) => [recipe.recipeId, recipe.ingredients]));
  for (const recipe of first.recipes) for (const method of recipe.methods) {
    assert.match(method.fingerprint, /^[a-f0-9]{64}$/u);
    assert.match(method.graphFingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(method.requiredEquipment, method.sourceDefinition.method.requiredEquipment);
    assert.deepEqual(recipe.ingredientDefinitions, method.sourceDefinition.ingredients);
    assert.deepEqual(recipe.ingredientDefinitions, planIngredientsByRecipe.get(recipe.recipeId));
    assert.ok(recipe.ingredientDefinitions.every((ingredient) => ["g", "ml", "piece"].includes(ingredient.unit)));
    assert.ok(method.sourceDefinition.ingredients.every((ingredient) => ingredient.id && ingredient.canonicalId && Number.isFinite(ingredient.amount) && ingredient.amount >= 0 && ingredient.unit));
    assert.ok(method.actions.length >= method.sourceSteps.length, `${recipe.recipeId}:${method.methodId}`);
    for (let index = 0; index < method.sourceSteps.length; index += 1) {
      const source = method.sourceSteps[index];
      const actions = method.actions.filter((action) => action.sourceStepIndex === index);
      assert.ok(actions.length, `${recipe.recipeId}:${method.methodId}:${index}`);
      assert.equal(actions.map((action) => action.text).join(""), source);
      assert.equal(actions[0].sourceStart, 0);
      assert.equal(actions.at(-1).sourceEnd, source.length);
    }
  }
});

test("catalog does not present a detached setup verb for reviewed regression recipes", async () => {
  const catalog = await buildCookingActionCatalog();
  const bareVerb = /^\s*(?:промойте|нарежьте|накройте|переверните|вмешайте|дайте)\s*[,;]?\s*$/iu;
  for (const recipeId of [
    "tmpm-28247",
    "tmpm-28083",
    "tmpm-26965",
    "goodfood-beef-red-wine-potato-pie",
    "tmpm-24619",
    "tmpm-24949",
    "tmpm-26429",
    "tmpm-26583",
  ]) {
    const actions = catalog.recipes.find((recipe) => recipe.recipeId === recipeId)?.methods.flatMap((method) => method.actions) ?? [];
    assert.ok(actions.length, recipeId);
    assert.ok(actions.every((action) => !bareVerb.test(action.text)), recipeId);
  }
});

test("catalog does not turn a source sentence with a later flip into a background timer", async () => {
  const catalog = await buildCookingActionCatalog();
  const method = catalog.recipes.find((recipe) => recipe.recipeId === "tmpm-26965")?.methods.find((item) => item.methodId === "original");
  assert.ok(method);
  assert.equal(method.actions.some((action) => action.backgroundCandidate), false);
});

test("catalog never makes a mixed heat-plus-manual source span into a background candidate", async () => {
  const catalog = await buildCookingActionCatalog();
  for (const recipeId of ["tmpm-23518", "tmpm-21976"]) {
    const recipe = catalog.recipes.find((item) => item.recipeId === recipeId);
    assert.ok(recipe, recipeId);
    const mixedActions = recipe.methods.flatMap((method) => method.actions).filter((action) =>
      /(?:выпекайте|выпекайте)/iu.test(action.text) && /(?:остудите|растопите|нанесите|разделите)/iu.test(action.text),
    );
    assert.ok(mixedActions.length, recipeId);
    assert.ok(mixedActions.every((action) => action.backgroundCandidate === undefined), recipeId);
  }
});

test("representative TMPM, Goodfood, Simple, and legacy cards gain detailed source-backed actions", async () => {
  const catalog = await buildCookingActionCatalog();
  const method = (recipeId) => catalog.recipes.find((recipe) => recipe.recipeId === recipeId)?.methods.find((item) => item.methodId === "original");
  for (const [recipeId, minimumActions] of [
    ["tmpm-28247", 10],
    ["goodfood-veggie-shepherds-pie-sweet-potato-mash", 6],
    ["simple-generated-b01", 4],
    ["src-light-stroganoff", 6],
  ]) {
    const item = method(recipeId);
    assert.ok(item, recipeId);
    assert.ok(item.actions.length >= minimumActions, `${recipeId}: ${item.actions.length}`);
    assert.equal(item.actions.map((action) => action.text).join(""), item.sourceSteps.join(""), "per-step reconstruction is checked above");
  }
});
