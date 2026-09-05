import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../data/recipe-equipment.json", import.meta.url), "utf8"));
const runtime = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const runtimeById = new Map(runtime.recipes.map((recipe) => [recipe.id, recipe]));

function safetyTemperatureClaims(steps) {
  return steps.flatMap((step) => {
    const temperatures = new Set();
    const listedTemperatures = [...step.matchAll(/(\d+)\s*°C/gu)].map((match) => Number(match[1]));
    if (/(?:термометр|температур[аы]?|достиг\w*|фарш|фрикадел)/iu.test(step)) temperatures.add(listedTemperatures.at(-1));
    for (const match of step.matchAll(/до\s+(\d+)\s*°C\s+в центре/giu)) temperatures.add(Number(match[1]));
    for (const match of step.matchAll(/(\d+)\s*°C\s*(?:в центре|внутри)/giu)) temperatures.add(Number(match[1]));
    return [...temperatures].filter(Number.isFinite).map((temperature) => ({ step, temperature }));
  });
}

function expectedSafeTemperature(ingredientIds) {
  if (ingredientIds.some((id) => /^chicken_|^turkey_/.test(id))) return 74;
  if (ingredientIds.some((id) => /^beef_mince_|^pork_mince_/.test(id))) return 71;
  if (ingredientIds.some((id) => /^pork_fillet_/.test(id))) return 63;
  return undefined;
}

const explicitAnimalWords = [
  ["chicken", /куриц/iu],
  ["turkey", /индей/iu],
  ["beef", /говядин/iu],
  ["pork", /свинин/iu],
  ["lamb", /ягн[её]н/iu],
];

function permittedAnimals(ingredientIds) {
  const allowed = new Set();
  for (const id of ingredientIds) {
    if (/^chicken_/.test(id)) allowed.add("chicken");
    if (/^turkey_/.test(id)) allowed.add("turkey");
    if (/^beef_/.test(id)) allowed.add("beef");
    if (/^pork_/.test(id)) allowed.add("pork");
    if (/^lamb_/.test(id)) allowed.add("lamb");
  }
  return allowed;
}

test("all appliance safety cues match the canonical meat and its safe temperature", () => {
  const applianceRecipes = manifest.recipes.filter((recipe) => recipe.methods.some((method) => method.id !== "original"));
  assert.equal(applianceRecipes.length, 50, "the complete appliance set is reviewed");

  for (const entry of applianceRecipes) {
    const recipe = runtimeById.get(entry.recipeId);
    assert.ok(recipe, `${entry.recipeId}: canonical runtime recipe is missing`);
    const ingredientIds = recipe.shoppingIngredients.map((ingredient) => ingredient.canonicalIngredientId);
    const expectedTemperature = expectedSafeTemperature(ingredientIds);
    const allowedAnimals = permittedAnimals(ingredientIds);
    const claims = safetyTemperatureClaims(entry.methods.filter((method) => method.id !== "original").flatMap((method) => method.steps));

    for (const claim of claims) {
      assert.equal(claim.temperature, expectedTemperature, `${entry.recipeId}: ${claim.step}`);
      for (const [animal, pattern] of explicitAnimalWords) {
        assert.ok(!pattern.test(claim.step) || allowedAnimals.has(animal), `${entry.recipeId}: foreign ${animal} cue: ${claim.step}`);
      }
    }
  }
});

test("pork and beef mince appliance routes keep their own thermometer cues before storage", () => {
  const expected = new Map([
    ["tmpm-26920", { animal: /свин[а-яё]*\s+фарш/iu, temperature: 71 }],
    ["tmpm-26528", { animal: /говяж[а-яёь]*\s+фарш/iu, temperature: 71 }],
  ]);

  for (const [recipeId, requirement] of expected) {
    const entry = manifest.recipes.find((recipe) => recipe.recipeId === recipeId);
    const steps = entry.methods.find((method) => method.id === "air_fryer").steps;
    const index = steps.findIndex((step) => /термометр/iu.test(step));
    assert.ok(index >= 0 && index < steps.findIndex((step) => /Заморозьте|Храните/iu.test(step)), recipeId);
    const finalStep = steps[index];
    assert.match(finalStep, requirement.animal, recipeId);
    assert.match(finalStep, new RegExp(`не менее ${requirement.temperature} °C`, "u"), recipeId);
    assert.doesNotMatch(finalStep, /куриц/iu, recipeId);
  }
});
