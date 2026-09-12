import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

import { recipeCatalog } from "./recipe-session-fixture.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const root = new URL("..", import.meta.url);

async function loadTs(path, dependencies = {}) {
  const url = new URL(path, root);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true },
  }).outputText;
  const moduleBox = { exports: {} };
  vm.runInNewContext(output, {
    module: moduleBox, exports: moduleBox.exports, JSON, Object, Array, Map, Set, Math, Number, String,
    require: id => dependencies[id] ?? createRequire(url)(id),
  }, { filename: url.pathname });
  return moduleBox.exports;
}

const [browser, engine, nutrition, context, planCatalog, actionCatalog] = await Promise.all([
  recipeCatalog(),
  loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url)),
  loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url)),
  loadTs("lib/cooking-session-context.ts"),
  readFile(new URL("../data/cooking-plan-catalog.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/cooking-action-catalog.json", import.meta.url), "utf8").then(JSON.parse),
]);
const amounts = await loadTs("domain/cooking-plan-amounts.ts", {
  "./recipe-engine": engine,
  "./nutrition": nutrition,
});
const descriptors = new Map(actionCatalog.recipes.flatMap(recipe => recipe.methods.map(method => [
  `${recipe.recipeId}:${method.methodId}`,
  { fingerprint: method.graphFingerprint, sourceSteps: method.sourceSteps },
])));
const resolver = await loadTs("lib/cooking-plan-resolver.ts", {
  "../data/cooking-plan-catalog.json": { __esModule: true, default: planCatalog },
  "../domain/cooking-plan-amounts": amounts,
  "../domain/cooking/compile": { cookingSourceDescriptor: (recipeId, methodId) => descriptors.get(`${recipeId}:${methodId}`) },
  "./cooking-session-context": context,
});

const slots = ["breakfast", "snack1", "lunch", "snack2", "dinner"];
const person = (id, daily, hardExclusions = undefined) => ({ id, name: id, daily, includedSlots: slots, hardExclusions });
const daily2000 = { kcal: 2000, protein: 150, fat: 65, carbs: 204 };

function planFor(recipe, people, days, tuning = undefined, methodId = undefined) {
  const batchId = "batch";
  const key = `${batchId}:${recipe.slot}`;
  return {
    id: "plan", mealSlots: [recipe.slot], people, batches: [{ id: batchId, days }],
    selections: { [key]: recipe.id },
    ...(methodId ? { recipeMethods: { [recipe.id]: methodId } } : {}),
    ...(tuning ? { tuning } : {}),
    // Deliberately forged UI data: the resolver must recompute from the plan.
    cookingAmounts: { forged: { amount: 99999, unit: "g", canonicalId: "forged" } },
  };
}

function assertAmountsEqual(actual, expected, family, label) {
  assert.ok(actual, label);
  assert.deepEqual(Object.keys(actual).sort(), Array.from(family.ingredients, item => item.sourceIngredientId).sort(), label);
  for (const ingredient of family.ingredients) {
    const value = actual[ingredient.sourceIngredientId];
    assert.equal(value.unit, ingredient.unit, `${label}:${ingredient.sourceIngredientId}:unit`);
    assert.equal(value.canonicalId, ingredient.canonicalIngredientId, `${label}:${ingredient.sourceIngredientId}:canonical`);
    assert.ok(Math.abs(value.amount - expected[ingredient.sourceIngredientId]) < 1e-6, `${label}:${ingredient.sourceIngredientId}`);
  }
}

test("server resolver matches the browser physical batch for every production recipe and every method keeps canonical metadata", () => {
  assert.equal(planCatalog.recipeCount, 260);
  assert.equal(actionCatalog.methodCount, 310);
  let viable = 0;
  let coveredPiece = false;
  let coveredFat = false;
  for (const recipe of browser.productionRecipes) {
    const family = browser.recipeFamilyFor(recipe);
    assert.ok(family, recipe.id);
    const session = browser.recipeCookingSession([person("p", daily2000)], recipe.slot, recipe, 1);
    const resolved = resolver.resolvePlannedCookingRecipes(planFor(recipe, [person("p", daily2000)], 1), "batch");
    if (!session.viable) {
      assert.equal(resolved, null, `${recipe.id}: unviable browser batch must not be resolved`);
      continue;
    }
    viable += 1;
    coveredPiece ||= family.ingredients.some(item => item.unit === "piece");
    coveredFat ||= family.ingredients.some(item => item.role === "fat" || item.role === "cooking_fat");
    assert.equal(resolved.length, 1, recipe.id);
    assert.equal(resolved[0].methodId, "original", `${recipe.id}: default method`);
    assertAmountsEqual(resolved[0].cookingAmounts, session.cookingAmounts, family, recipe.id);
    const actionRecipe = actionCatalog.recipes.find(item => item.recipeId === recipe.id);
    const planRecipe = planCatalog.recipes.find(item => item.recipeId === recipe.id);
    for (const method of actionRecipe.methods) {
      assert.deepEqual(method.sourceDefinition.ingredients, planRecipe.ingredients, `${recipe.id}:${method.methodId}`);
      assert.deepEqual(actionRecipe.ingredientDefinitions, planRecipe.ingredients, `${recipe.id}:${method.methodId}:definitions`);
    }
  }
  assert.ok(viable >= 200, "the audited production catalogue remains materially covered");
  assert.ok(coveredPiece, "at least one resolved batch covers structural pieces");
  assert.ok(coveredFat, "at least one resolved batch covers a fat allocation");
});

test("two people, days and tuned ratios use the same shared physical batch as the browser", () => {
  const recipe = browser.recipesById["src-light-stroganoff"];
  const people = [person("a", { kcal: 1600, protein: 130, fat: 55, carbs: 155 }), person("b", { kcal: 2800, protein: 190, fat: 90, carbs: 340 })];
  const tuning = {
    "batch:lunch:a": { protein: 1.1, fat: 0.9, carbs: 0.85 },
    "batch:lunch:b": { protein: 0.95, fat: 1.1, carbs: 1.15 },
  };
  const session = browser.recipeCookingSession(people, "lunch", recipe, 3, item => tuning[`batch:lunch:${item.id}`]);
  assert.ok(session.viable, "chosen mixed-goal recipe is browser-viable");
  const resolved = resolver.resolvePlannedCookingRecipes(planFor(recipe, people, 3, tuning), "batch");
  assert.equal(resolved.length, 1);
  assertAmountsEqual(resolved[0].cookingAmounts, session.cookingAmounts, browser.recipeFamilyFor(recipe), "mixed batch");
});

test("hard exclusions are recomputed server-side and client amount tampering has no effect", () => {
  const recipe = browser.recipesById["foodru-blogger-chicken-bombs"];
  const excluded = person("p", daily2000, ["milk"]);
  assert.equal(browser.recipeCookingSession([excluded], recipe.slot, recipe, 1).viable, false);
  assert.equal(resolver.resolvePlannedCookingRecipes(planFor(recipe, [excluded], 1), "batch"), null);

  const safe = person("p", daily2000);
  const clean = resolver.resolvePlannedCookingRecipes(planFor(recipe, [safe], 1), "batch");
  const tampered = planFor(recipe, [safe], 1);
  tampered.cookingAmounts = { "source-ingredient-1": { amount: 1, unit: "piece", canonicalId: "forged" } };
  assert.deepEqual(resolver.resolvePlannedCookingRecipes(tampered, "batch"), clean);
});
