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
const [engine] = modules;
const nutrition = modules[4];
const page = await read("app/page.tsx");

async function menuRuntime() {
  const start = page.indexOf("const mealMeta");
  const end = page.indexOf("export default function Home");
  const output = ts.transpileModule(
    `${page.slice(start, end)}\nglobalThis.__runtime = { automaticAssignmentsFor, mainMenuRecipes, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById, recipeCookingSession, fitScoreForSession, recipeFamilyFor, recipeFiber, starchyVegetableIds };`,
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

/* Та же последовательность, что у автосборки мастера. Клетчатка и овощи
   считаются из фактических порций общей готовки первого человека. */
function assemble({ style, kcal, days, cookEveryDays, slots }) {
  const { automaticAssignmentsFor, mainMenuRecipes, buildBatches, selectionKey, newPerson, defaultKitchenEquipment, recipesById, recipeCookingSession, fitScoreForSession, recipeFamilyFor, starchyVegetableIds } = runtime;
  const person = newPerson(0);
  person.daily = nutrition.recalculateDailyMacros(kcal, person.daily, "balanced");
  person.includedSlots = [...slots];
  const used = new Map(slots.map((slot) => [slot, new Set()]));
  const assignments = {};
  let fiber = 0;
  let vegetables = 0;
  let fit = 0;
  let positions = 0;
  const picks = [];
  for (const batch of buildBatches("2026-10-07", days, cookEveryDays))
    for (const slot of slots) {
      const key = selectionKey(batch, slot);
      const selected = Object.values(assignments).flatMap((items) => items.map((item) => recipesById[item.recipeId]));
      const picked = automaticAssignmentsFor(slot, style, [person], batch.days, used.get(slot), new Set(), selected, [...defaultKitchenEquipment], mainMenuRecipes(assignments, key));
      assert.ok(picked.length, `${key} gets a dish`);
      assignments[key] = picked;
      picked.forEach((item) => used.get(slot).add(item.recipeId));
      const recipe = recipesById[picked[0].recipeId];
      picks.push({ slot, recipe });
      const session = recipeCookingSession([person], slot, recipe, batch.days);
      const family = recipeFamilyFor(recipe);
      const amounts = session.portions[0].solvedAmounts;
      fit += fitScoreForSession(session);
      positions += 1;
      fiber += engine.fiberForFamily(family, amounts) * batch.days;
      for (const ingredient of family.ingredients) {
        const canonical = engine.canonicalIngredients[ingredient.canonicalIngredientId];
        if (canonical.category !== "vegetable" || starchyVegetableIds.has(canonical.id)) continue;
        const unitGrams = ingredient.unit === "piece" ? canonical.unit.gramsPerUnit : ingredient.unit === "ml" ? canonical.densityGPerMl ?? 1 : 1;
        vegetables += (amounts[ingredient.sourceIngredientId] ?? 0) * unitGrams * batch.days;
      }
    }
  return { fiber: fiber / days, vegetables: vegetables / days, fit: fit / positions, picks };
}

test("the Pikabu «Простые» week is no longer a mono-diet without fiber", () => {
  // 1 человек, 1800 ккал, завтрак-обед-ужин, 5 дней: было ≈ 14 г клетчатки
  // и ≈ 230 г овощей в день, в комментариях — «Где овощи? Где клетчатка?».
  // Порядок кандидатов поднял неделю до ≈ 20 г, но завтраки остались
  // творожной запеканкой и сырниками с 1 г клетчатки; простые завтраки
  // пакета 2026-10-12 дают ≈ 26 г в день.
  const result = assemble({ style: "simple", kcal: 1800, days: 5, cookEveryDays: 3, slots: ["breakfast", "lunch", "dinner"] });
  assert.ok(result.fiber >= 22, `fiber ${result.fiber.toFixed(1)} g/day`);
  for (const { recipe } of result.picks.filter((pick) => pick.slot === "breakfast"))
    assert.ok(runtime.recipeFiber(recipe).grams >= 5, `${recipe.id}: a breakfast with ${runtime.recipeFiber(recipe).grams} g of fiber`);
  assert.ok(result.vegetables >= 280, `vegetables ${Math.round(result.vegetables)} g/day`);
  assert.ok(result.fit >= 90, `menu fit ${result.fit.toFixed(1)}`);
});

test("protein and budget weeks keep their fit while reaching the fiber reference", () => {
  for (const scenario of [
    { style: "protein", kcal: 1800, days: 6, cookEveryDays: 3, slots: ["breakfast", "lunch", "dinner"], fiber: 20 },
    { style: "budget", kcal: 2000, days: 7, cookEveryDays: 3, slots: ["breakfast", "lunch", "dinner"], fiber: 22 },
    { style: "protein", kcal: 2200, days: 7, cookEveryDays: 3, slots: ["breakfast", "snack1", "lunch", "snack2", "dinner"], fiber: 25 },
  ]) {
    const result = assemble(scenario);
    const label = `${scenario.style} ${scenario.kcal} ${scenario.slots.length} slots`;
    assert.ok(result.fiber >= scenario.fiber, `${label}: fiber ${result.fiber.toFixed(1)} g/day`);
    assert.ok(result.fit >= 92, `${label}: fit ${result.fit.toFixed(1)}`);
  }
});

test("ranking rewards fiber density and fresh vegetables only within a bounded bonus", () => {
  const ranking = page.slice(page.indexOf("const starchyVegetableIds"), page.indexOf("function styleScore("));
  assert.match(ranking, /const fiberRankWeight = 3;/);
  assert.match(ranking, /const fiberRankCapPerThousandKcal = 20;/);
  assert.match(ranking, /const vegetableRankWeight = 0\.2;/);
  assert.match(ranking, /const vegetableRankCapGrams = 150;/);
  for (const id of ["potato_raw", "sweet_potato_raw", "corn_cooked"])
    assert.ok(runtime.starchyVegetableIds.has(id), `${id} is a side, not a vegetable`);
  const sort = page.slice(page.indexOf("function candidateRecipes("), page.indexOf("function combinationBonus("));
  assert.equal((sort.match(/fiberRankBonus\(/g) ?? []).length, 2, "both sides of the comparison get the bonus");
  // Простота «Простых» и бонус общих продуктов не меняются: на сетке
  // сценариев эти правки не дали прироста клетчатки.
  assert.match(page, /if \(style === "simple"\) return 100 - recipe\.effort\.activeMinutes - recipe\.ingredients\.length;/);
});

test("«Много клетчатки» marks dense, substantial portions only", () => {
  const property = page.slice(page.indexOf("function hasProperty("), page.indexOf("function missingCountFor("));
  assert.match(property, /fiber\.grams >= fiberRichMinimumGrams && fiber\.perThousandKcal >= fiberRichPerThousandKcal/);
  assert.match(page, /const fiberRichMinimumGrams = 3;\nconst fiberRichPerThousandKcal = 20;/);
  const { recipesById, recipeFiber } = runtime;
  const rich = (recipe) => recipeFiber(recipe).grams >= 3 && recipeFiber(recipe).perThousandKcal >= 20;
  const marked = Object.values(recipesById).filter(rich);
  assert.ok(marked.length > 40 && marked.length < Object.keys(recipesById).length / 3, `${marked.length} fiber-rich recipes`);
  assert.equal(rich(recipesById["mise-simple-tvorog-casserole"]), false, "a cottage-cheese casserole is not fiber-rich");
  assert.equal(rich(recipesById["mise-vegan-bean-chili"]), true, "a bean chili is");
});

test("fiber is shown as an estimate on the dish, on review and in the week assessment", () => {
  assert.match(page, /fiber: "Много клетчатки",/);
  assert.match(page, /displayFiber < 1 \? "Клетчатка — меньше 1 г" : `Клетчатка ≈ \$\{formatMacro\(displayFiber\)\} г`/);
  assert.match(page, /\$\{person && eaters\.length > 1 \? `Порция: \$\{person\.name\} · ` : ""\}|Порция: \$\{person\.name\} · /);
  assert.match(page, /fiberNote=\{reviewFiberNote\(plan\)\}/);
  assert.match(page, /Ориентир МР 2\.3\.1\.0253-21 — 20–25 г в день или 10 г на 1000 ккал/);
  assert.match(page, /<p className="week-balance">\{fiberAssessmentText\(planFiberAssessment\(activePlan, person\)\)\}<\/p>/);
  // Объекты из vm-контекста сравниваются по значению.
  // МР: «20–25 г/сутки или 10 г/1000 ккал» — нижняя граница не выше 10 г на 1000 ккал цели.
  assert.equal(JSON.stringify(nutrition.dailyFiberReference(1800)), JSON.stringify({ min: 20, max: 25, floor: 18 }));
  assert.equal(nutrition.dailyFiberReference(1500).floor, 15);
  assert.equal(nutrition.dailyFiberReference(3000).floor, 20);
  assert.equal(JSON.stringify(nutrition.fiberReferenceForSlots(nutrition.dailyFiberReference(1800), ["breakfast", "lunch", "dinner"])), JSON.stringify({ share: 0.8, floor: 14 }));
});
