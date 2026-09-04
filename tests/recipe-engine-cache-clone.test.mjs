import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));

test("a caller cannot mutate a cached solved variant through nutrition, amounts, or explanation", () => {
  const family = catalog.recipes.find((recipe) => recipe.id === "tmpm-24949")?.recipeFamily;
  assert.ok(family, "released sauce recipe is present");
  const input = { targetCalories: family.minViableCalories };

  engine.resetRecipeSolverCache();
  const first = engine.solveRecipeFamily(family, input);
  const expected = engine.solveRecipeFamily(family, input);

  first.amounts[Object.keys(first.amounts)[0]] = -1;
  first.nutrition.kcal = -1;
  first.nutrition.protein = -1;
  first.nutrition.fat = -1;
  first.nutrition.carbs = -1;
  first.explanation.push("подделка");

  assert.deepEqual(engine.solveRecipeFamily(family, input), expected);
});
