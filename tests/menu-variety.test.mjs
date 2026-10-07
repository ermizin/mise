import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const modules = await Promise.all(
  ["recipe-engine", "cooking-duration", "nutrition-history", "recipe-cuisine", "nutrition", "portion-allocation", "meal-execution", "cooking-session"].map(
    (name) => loadTypeScriptModule(new URL(`../domain/${name}.ts`, import.meta.url)),
  ),
);
const nutrition = modules[4];

async function menuRuntime() {
  const source = await read("app/page.tsx");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  const output = ts.transpileModule(
    `${source.slice(start, end)}\nglobalThis.__runtime = { automaticAssignmentsFor, mainMenuRecipes, menuVarietyOf, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    ...Object.assign({}, ...modules.map((module) => ({ ...module }))),
    runtimeRecipeCatalogJson: JSON.parse(await read("data/recipe-runtime-catalog.json")),
    portionComponentsJson: JSON.parse(await read("data/recipe-portion-components.json")),
    legacyRecipeImageDownloadSourcesJson: JSON.parse(await read("data/legacy-recipe-image-download-sources.json")),
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    nutritionRepairLegacyDailyMacros: nutrition.repairLegacyDailyMacros,
    togglePersonMealSlotSelection: nutrition.togglePersonMealSlot,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__runtime;
}

const runtime = await menuRuntime();

/* Та же последовательность, что у автосборки мастера: позиции по партиям,
   общие продукты считаются по всему плану, разнообразие — по обедам и ужинам. */
function assemble(days, cookEveryDays) {
  const { automaticAssignmentsFor, mainMenuRecipes, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById } = runtime;
  const people = [newPerson(0)];
  const slots = ["breakfast", "lunch", "dinner"];
  const used = new Map(slots.map((slot) => [slot, new Set()]));
  const assignments = {};
  const menu = [];
  for (const batch of buildBatches("2026-10-07", days, cookEveryDays))
    for (const slot of slots) {
      const key = selectionKey(batch, slot);
      const selected = Object.values(assignments).flatMap((items) => items.map((item) => recipesById[item.recipeId]));
      const picked = automaticAssignmentsFor(slot, "protein", people, batch.days, used.get(slot), new Set(), selected, [...defaultKitchenEquipment], mainMenuRecipes(assignments, key));
      assert.ok(picked.length, `${key} gets a dish`);
      assignments[key] = picked;
      picked.forEach((item) => used.get(slot).add(item.recipeId));
      menu.push({ batch: batch.index, slot, recipe: recipesById[picked[0].recipeId] });
    }
  return menu;
}

test("the default protein week is not built around one pasta", () => {
  const mains = assemble(7, 3).filter((item) => item.slot !== "breakfast");
  const pasta = mains.filter((item) => runtime.menuVarietyOf(item.recipe).base === "pasta");
  assert.ok(pasta.length <= 2, `pasta in ${pasta.length} of ${mains.length}: ${pasta.map((item) => item.recipe.title).join(", ")}`);
  const proteins = new Set(mains.map((item) => runtime.menuVarietyOf(item.recipe).protein).filter(Boolean));
  assert.ok(proteins.size >= 3, `main proteins: ${[...proteins].join(", ")}`);
});

test("lunch and dinner of one batch are different dishes", () => {
  for (const cookEveryDays of [3, 4, 7]) {
    const menu = assemble(7, cookEveryDays);
    for (const batch of new Set(menu.map((item) => item.batch))) {
      const [lunch, dinner] = ["lunch", "dinner"].map((slot) => menu.find((item) => item.batch === batch && item.slot === slot).recipe.id);
      assert.notEqual(lunch, dinner, `batch ${batch + 1} with ${cookEveryDays}-day batches repeats ${lunch}`);
    }
  }
});

test("variety is read from canonical products, not from the title", () => {
  const { menuVarietyOf, recipesById } = runtime;
  // «Сытная паста с говяжьим фаршем» — бывшая «с ветчиной»: в составе говяжий фарш.
  assert.deepEqual({ ...menuVarietyOf(recipesById["tmpm-22968"]) }, { base: "pasta", protein: "beef" });
  assert.equal(recipesById["tmpm-22968"].title, "Сытная паста с говяжьим фаршем");
  assert.equal(menuVarietyOf(recipesById["tmpm-27306"]).protein, "pork");
  assert.equal(recipesById["tmpm-27306"].title, "Паста со свиным фаршем и перцем в одной кастрюле");
});
