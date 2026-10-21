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
    `${source.slice(start, end)}\nglobalThis.__runtime = { automaticAssignmentsFor, mainMenuRecipes, sameBatchMainRecipeIds, menuVarietyOf, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById, recipeCookingSession, fitScoreForSession };`,
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
function assemble(days, cookEveryDays, { seed, previousRecipeIds } = {}) {
  const { automaticAssignmentsFor, mainMenuRecipes, sameBatchMainRecipeIds, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById } = runtime;
  const people = [newPerson(0)];
  const slots = ["breakfast", "lunch", "dinner"];
  const used = new Map(slots.map((slot) => [slot, new Set()]));
  const assignments = {};
  const menu = [];
  for (const batch of buildBatches("2026-10-07", days, cookEveryDays))
    for (const slot of slots) {
      const key = selectionKey(batch, slot);
      const selected = Object.values(assignments).flatMap((items) => items.map((item) => recipesById[item.recipeId]));
      // Ключ позиции — как в мастере: ключ сборки плана и позиция.
      const choice = seed === undefined ? {} : { seed: `${seed}:${key}`, previousRecipeIds };
      const picked = automaticAssignmentsFor(slot, "protein", people, batch.days, used.get(slot), new Set(), selected, [...defaultKitchenEquipment], mainMenuRecipes(assignments, key), sameBatchMainRecipeIds(assignments, key), choice);
      assert.ok(picked.length, `${key} gets a dish`);
      assignments[key] = picked;
      picked.forEach((item) => used.get(slot).add(item.recipeId));
      const recipe = recipesById[picked[0].recipeId];
      menu.push({ batch: batch.index, slot, recipe, fit: runtime.fitScoreForSession(runtime.recipeCookingSession(people, slot, recipe, batch.days)) });
    }
  return menu;
}

/* Без ключа — прежний детерминированный порядок; с ключами — меню разных
   новых планов. Правила разнообразия обязаны выполняться для всех. */
const planSeeds = [undefined, "flow-a", "flow-b", "flow-c", "flow-d", "flow-e", "flow-f"];
const label = (seed) => seed ?? "no seed";
const ids = (menu) => menu.map((item) => item.recipe.id);

test("the default protein week is not built around one pasta", () => {
  for (const seed of planSeeds) {
    const mains = assemble(7, 3, { seed }).filter((item) => item.slot !== "breakfast");
    const pasta = mains.filter((item) => runtime.menuVarietyOf(item.recipe).base === "pasta");
    assert.ok(pasta.length <= 2, `${label(seed)}: pasta in ${pasta.length} of ${mains.length}: ${pasta.map((item) => item.recipe.title).join(", ")}`);
    const proteins = new Set(mains.map((item) => runtime.menuVarietyOf(item.recipe).protein).filter(Boolean));
    assert.ok(proteins.size >= 3, `${label(seed)}: main proteins: ${[...proteins].join(", ")}`);
  }
});

test("lunch and dinner of one batch are different dishes", () => {
  for (const seed of planSeeds)
    for (const cookEveryDays of [3, 4, 7]) {
      const menu = assemble(7, cookEveryDays, { seed });
      for (const batch of new Set(menu.map((item) => item.batch))) {
        const [lunch, dinner] = ["lunch", "dinner"].map((slot) => menu.find((item) => item.batch === batch && item.slot === slot).recipe.id);
        assert.notEqual(lunch, dinner, `${label(seed)}: batch ${batch + 1} with ${cookEveryDays}-day batches repeats ${lunch}`);
      }
      for (const slot of ["breakfast", "lunch", "dinner"]) {
        const slotIds = menu.filter((item) => item.slot === slot).map((item) => item.recipe.id);
        assert.equal(new Set(slotIds).size, slotIds.length, `${label(seed)}: ${slot} repeats a dish across batches: ${slotIds.join(", ")}`);
      }
    }
});

/* «В визарде всегда собирается одно и то же меню» (2026-10-21): порядок
   кандидатов был детерминирован, и человек по умолчанию, человек на 1500 ккал
   и пара получали 7–9 одних и тех же блюд из 9. Ключ сборки выбирает среди
   почти равных по счёту блюд: разные планы — разное меню, тот же план
   (черновик, правка) — то же самое. */
test("each new plan gets its own menu, the same plan the same menu", () => {
  const menus = planSeeds.slice(1).map((seed) => ids(assemble(7, 3, { seed })));
  const distinct = new Set(menus.map((menu) => menu.join(",")));
  assert.ok(distinct.size >= 5, `only ${distinct.size} different menus from ${menus.length} plans`);
  const baseline = ids(assemble(7, 3));
  const sameAsBaseline = menus.map((menu) => menu.filter((id, index) => id === baseline[index]).length);
  assert.ok(Math.max(...sameAsBaseline) < baseline.length, `a seeded plan repeats the unseeded menu: ${sameAsBaseline.join(", ")}`);
  assert.deepEqual(ids(assemble(7, 3, { seed: "flow-a" })), menus[0], "the same key assembles the same menu");
});

test("a varied menu does not trade away the macro fit", () => {
  const meanFit = (menu) => menu.reduce((sum, item) => sum + item.fit, 0) / menu.length;
  const baseline = assemble(7, 3);
  for (const seed of planSeeds.slice(1)) {
    const menu = assemble(7, 3, { seed });
    assert.ok(meanFit(menu) >= meanFit(baseline) - 2, `${seed}: mean fit ${meanFit(menu).toFixed(1)} vs ${meanFit(baseline).toFixed(1)}`);
    for (const item of menu) assert.ok(item.fit >= 85, `${seed}: ${item.slot} «${item.recipe.title}» fits only ${item.fit}`);
  }
});

/* «Собрать новый план» раньше открывал прошлый план с его блюдами. Теперь
   меню собирается заново, а блюда прошлого плана понижаются в очереди. */
test("a new plan after the last one changes most of its dishes", () => {
  for (const [previousSeed, seed] of [["flow-a", "flow-b"], ["flow-c", "flow-d"], ["flow-e", "flow-f"]]) {
    const previousRecipeIds = new Set(ids(assemble(7, 3, { seed: previousSeed })));
    const next = ids(assemble(7, 3, { seed, previousRecipeIds }));
    const repeated = next.filter((id) => previousRecipeIds.has(id));
    assert.ok(repeated.length <= 2, `${seed} after ${previousSeed} repeats ${repeated.length} of ${next.length}: ${repeated.join(", ")}`);
  }
});

test("variety is read from canonical products, not from the title", () => {
  const { menuVarietyOf, recipesById } = runtime;
  // «Сытная паста с говяжьим фаршем» — бывшая «с ветчиной»: в составе говяжий фарш.
  assert.deepEqual({ ...menuVarietyOf(recipesById["tmpm-22968"]) }, { base: "pasta", protein: "beef" });
  assert.equal(recipesById["tmpm-22968"].title, "Сытная паста с говяжьим фаршем");
  assert.equal(menuVarietyOf(recipesById["tmpm-27306"]).protein, "pork");
  assert.equal(recipesById["tmpm-27306"].title, "Паста со свиным фаршем и перцем в одной кастрюле");
  // Цельнозерновые макароны и кускус — та же основа, что и белые.
  for (const id of ["goodfood-apple-penne-slaw-walnuts", "goodfood-scandi-beetroot-salmon-pasta"])
    assert.equal(menuVarietyOf(recipesById[id]).base, "pasta", id);
  assert.equal(menuVarietyOf(recipesById["goodfood-pork-with-cucumber-apricot-couscous"]).base, "bulgur");
});
