import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildCookingActionCatalog } from "../scripts/build-cooking-action-catalog.mjs";
import { productionRecipes } from "../scripts/build-plan-recipe-registry.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { splitCookingActions, formatCookingActionText } = await loadTypeScriptModule(
  new URL("../domain/cooking-actions.ts", import.meta.url),
);

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
  const [first, second, recipes, stored] = await Promise.all([
    buildCookingActionCatalog(),
    buildCookingActionCatalog(),
    productionRecipes(),
    readFile(new URL("../data/cooking-action-catalog.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(stored, first);
  assert.equal(first.recipeCount, recipes.length);
  assert.equal(first.methodCount, recipes.reduce((sum, recipe) => sum + recipe.equipmentOptions.length, 0));
  for (const recipe of first.recipes) for (const method of recipe.methods) {
    assert.match(method.fingerprint, /^[a-f0-9]{64}$/u);
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
