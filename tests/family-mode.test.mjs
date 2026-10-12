import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

/* Семейный режим (решение владельца от 2026-10-12): дети 3–17 лет считаются
   по таблицам ВОЗ/ФАО 2004, без взрослой формулы и без дефицита, получают
   меньшую долю общего блюда, а сервер не пропускает ребёнка без возраста и
   взрослого «под видом ребёнка» ниже 1200 ккал. */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const modules = await Promise.all(
  ["recipe-engine", "cooking-duration", "nutrition-history", "recipe-cuisine", "nutrition", "portion-allocation", "meal-execution", "cooking-session"].map(
    (name) => loadTypeScriptModule(new URL(`../domain/${name}.ts`, import.meta.url)),
  ),
);
const nutrition = modules[4];
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const page = await read("app/page.tsx");
const registry = JSON.parse(await read("data/plan-recipe-registry.json"));

async function runtime() {
  const start = page.indexOf("const mealMeta");
  const end = page.indexOf("export default function Home");
  const output = ts.transpileModule(
    `${page.slice(start, end)}\nglobalThis.__runtime = { candidateRecipes, recipeCookingSession, newPerson, normalizePerson, automaticEstimateIssue, recipes, recipesById, defaultKitchenEquipment, crossContactWarnings };`,
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
const R = await runtime();

const kcal = (input) => nutrition.calculateChildNutritionTarget(input).target.kcal;

test("children are sized by the WHO/FAO 2004 tables, not by the adult formula", () => {
  // 9-летняя девочка с Пикабу: 1850 ккал, а не взрослые 2460.
  assert.equal(kcal({ sex: "female", age: 9, activity: "usual" }), 1850);
  assert.equal(kcal({ sex: "male", age: 9, activity: "usual" }), 1980);
  assert.equal(kcal({ sex: "female", age: 3, activity: "usual" }), 1150);
  assert.equal(kcal({ sex: "male", age: 3, activity: "usual" }), 1250);
  assert.equal(kcal({ sex: "male", age: 17, activity: "usual" }), 3400);
  assert.equal(kcal({ sex: "male", age: 17, activity: "active" }), 3910);
  assert.equal(kcal({ sex: "female", age: 15, activity: "calm" }), 2130);
  for (const age of [3, 4, 5])
    for (const sex of ["male", "female"])
      assert.equal(kcal({ sex, age, activity: "calm" }), kcal({ sex, age, activity: "active" }), `${sex} ${age}: activity starts at 6`);
  for (const age of [2, 18, 9.5])
    assert.ok("issues" in nutrition.calculateChildNutritionTarget({ sex: "female", age, activity: "usual" }), `age ${age} is not a supported child`);
});

test("child macros stay within МР shares and add up to the calories", () => {
  for (let age = 3; age <= 17; age += 1)
    for (const sex of ["male", "female"])
      for (const activity of ["calm", "usual", "active"]) {
        const target = nutrition.calculateChildNutritionTarget({ sex, age, activity }).target;
        const fromMacros = target.protein * 4 + target.fat * 9 + target.carbs * 4;
        assert.ok(Math.abs(fromMacros - target.kcal) <= 5, `${sex} ${age} ${activity}`);
        assert.ok(Math.abs(target.protein * 4 / target.kcal - 0.15) < 0.01);
        assert.ok(Math.abs(target.fat * 9 / target.kcal - 0.3) < 0.01);
      }
});

test("fiber references follow МР bands for children", () => {
  const floor = (age) => nutrition.childDailyFiberReference(age).floor;
  assert.deepEqual([3, 6, 7, 10, 11, 14, 15, 17].map(floor), [12, 12, 16, 16, 20, 20, 22, 22]);
  const child = { kind: "child", childEstimate: { sex: "female", age: 9, activity: "usual" }, daily: { kcal: 1850 } };
  assert.equal(nutrition.personFiberReference(child).floor, 16);
  assert.equal(nutrition.personFiberReference({ daily: { kcal: 1800 } }).floor, 18);
});

function plan(person) {
  return {
    id: "plan-1", start: "2026-08-29", end: "2026-08-29", periodDays: 1, cookEveryDays: 1,
    menuStyle: "protein", mealSlots: ["lunch"],
    people: [{ id: "person-1", name: "Маша", includedSlots: ["lunch"], ...person }],
    batches: [{ id: "batch-1", index: 0, start: "2026-08-29", end: "2026-08-29", days: 1 }],
    selections: { "batch-1:lunch": "tmpm-28584" },
    selectionAssignments: { "batch-1:lunch": [{ recipeId: "tmpm-28584", personIds: ["person-1"] }] },
    shopping: [],
  };
}
const macros = (value) => nutrition.childMacrosForCalories(value);

test("the server takes the calorie range from the child's age", () => {
  const child = (age, kcalValue) => plan({ kind: "child", childEstimate: { sex: "female", age, activity: "usual" }, nutritionTargetMode: "manual", daily: macros(kcalValue) });
  assert.equal(validatePlanForPersistence(child(5, 800)).valid, true, "a 5-year-old at 800 kcal");
  assert.equal(validatePlanForPersistence(child(16, 800)).valid, false, "a teenager is not cut below the adult floor");
  assert.equal(validatePlanForPersistence(child(16, 4500)).valid, true, "a training teenager may follow a doctor's figure");
  assert.equal(validatePlanForPersistence(child(9, 3100)).valid, false);
  assert.equal(validatePlanForPersistence(plan({ kind: "child", daily: macros(1000) })).valid, false, "a child needs an age");
  assert.equal(validatePlanForPersistence(plan({ kind: "child", childEstimate: { sex: "female", age: 2 }, daily: macros(1000) })).valid, false, "under 3 is not supported");
  assert.equal(validatePlanForPersistence(plan({ daily: macros(800) })).valid, false, "an adult stays at 1200+");
  assert.equal(validatePlanForPersistence(plan({ kind: "robot", daily: macros(2000) })).valid, false);
  for (let age = 3; age <= 17; age += 1) {
    const person = { kind: "child", childEstimate: { sex: "male", age } };
    const [minimum, maximum] = nutrition.personCalorieRange(person);
    assert.equal(validatePlanForPersistence(plan({ ...person, daily: macros(minimum) })).valid, true, `server floor at ${age}`);
    assert.equal(validatePlanForPersistence(plan({ ...person, daily: macros(minimum - 10) })).valid, false, `server floor at ${age}`);
    assert.equal(validatePlanForPersistence(plan({ ...person, daily: macros(maximum) })).valid, true, `server ceiling at ${age}`);
  }
});

test("a child never keeps an adult estimate, on the server or on load", () => {
  const adultEstimate = { sex: "male", age: 30, height: 178, weight: 78, activity: "medium", musclePriority: false, goal: "loss", monthlyWeightChangeKg: 1 };
  const saved = { people: [{ id: "c", name: "Маша", kind: "child", childEstimate: { sex: "female", age: 9, activity: "usual" }, estimate: adultEstimate, nutritionTargetMode: "auto", daily: { kcal: 2460, protein: 117, fat: 82, carbs: 313 } }] };
  const normalized = nutrition.normalizeAutomaticNutritionTargets(saved).people[0];
  assert.equal(normalized.daily.kcal, 1850);
  assert.equal("estimate" in normalized, false);
  const loaded = R.normalizePerson(saved.people[0]);
  assert.equal(loaded.daily.kcal, 1850);
  assert.equal(loaded.estimate, undefined);
});

test("an old adult with an impossible age keeps its saved norm and is flagged, not silently changed", () => {
  const old = { ...R.newPerson(1), estimate: { sex: "male", age: 9, height: 178, weight: 78, activity: "medium", musclePriority: false, goal: "loss", monthlyWeightChangeKg: 1 }, nutritionTargetMode: "auto", daily: { kcal: 2460, protein: 117, fat: 82, carbs: 313 } };
  assert.equal(R.normalizePerson(old).daily.kcal, 2460);
  assert.equal(nutrition.normalizeAutomaticNutritionTargets({ people: [old] }).people[0].daily.kcal, 2460);
  assert.match(R.automaticEstimateIssue(old), /Ребёнок 3–17 лет/);
  assert.match(page, /const unratedPeople = activePlan\.people\.filter\(\(item\) => automaticEstimateIssue\(item\)\);/);
});

function adult(index, daily) {
  const person = R.newPerson(index);
  person.daily = nutrition.recalculateDailyMacros(daily, person.daily, "balanced");
  person.includedSlots = ["breakfast", "lunch", "dinner", "snack1"];
  return person;
}
function child(index, age, sex) {
  const person = R.newPerson(index);
  delete person.estimate;
  person.kind = "child";
  person.childEstimate = { age, sex, activity: "usual" };
  person.daily = nutrition.calculateChildNutritionTarget(person.childEstimate).target;
  person.includedSlots = ["breakfast", "lunch", "dinner", "snack1"];
  return person;
}

test("a small child shares the family dish instead of shrinking the family's choice", () => {
  // Раньше девочка 3 лет (1150 ккал) оставляла «Простым» один завтрак и три ужина.
  for (const style of ["simple", "protein", "budget"]) {
    const alone = [adult(0, 1800)];
    const family = [adult(0, 1800), child(1, 3, "female")];
    for (const slot of ["breakfast", "lunch", "dinner", "snack1"]) {
      const adultOptions = R.candidateRecipes(slot, style, alone, 3, { limit: "all" }, [...R.defaultKitchenEquipment]);
      const familyOptions = R.candidateRecipes(slot, style, family, 3, { limit: "all" }, [...R.defaultKitchenEquipment]);
      assert.ok(familyOptions.length >= adultOptions.length * 0.9, `${style} ${slot}: ${familyOptions.length} vs ${adultOptions.length}`);
      for (const recipe of familyOptions.slice(0, 6)) {
        const session = R.recipeCookingSession(family, slot, recipe, 3);
        assert.ok(session.viable, `${recipe.id} is viable for the family`);
        for (const portion of session.portions)
          assert.ok(portion.actual.kcal >= portion.target.kcal * 0.9 - 0.5 && portion.actual.kcal <= portion.target.kcal * 1.05 + 0.5, `${style} ${slot} ${recipe.id}: ${portion.actual.kcal} for ${portion.target.kcal}`);
      }
    }
  }
});

test("egg-fixed breakfasts stay whole for the batch while the child's share is fractional", () => {
  const family = [adult(0, 1800), child(1, 3, "female")];
  for (const id of ["mise-simple-syrniki-oven", "mise-simple-tvorog-casserole"]) {
    const session = R.recipeCookingSession(family, "breakfast", R.recipesById[id], 3);
    assert.ok(session.viable, id);
    assert.ok(session.portions.every((portion) => (portion.sourceServingRepeat ?? 1) === 1), `${id}: the child's portion is one physical serving`);
    const [grown, small] = session.portions;
    assert.ok(small.actual.kcal < grown.actual.kcal * 0.8, `${id}: the child's share is smaller`);
  }
});

test("a child alone can still be planned within the corridor", () => {
  const options = R.candidateRecipes("lunch", "simple", [child(0, 4, "male")], 1, { limit: "all" }, [...R.defaultKitchenEquipment]);
  assert.ok(options.length >= 20, `${options.length} lunches for a 4-year-old alone`);
});

test("alcohol is a hard «мне нельзя» derived from wine and mirin, without cross-contact noise", () => {
  // Массив из vm-контекста сравнивается по значению.
  const marked = [...R.recipes.filter((recipe) => recipe.allergens.includes("alcohol")).map((recipe) => recipe.id)].sort();
  assert.deepEqual(Array.from(marked), [
    "goodfood-beef-red-wine-potato-pie",
    "goodfood-slow-cooker-beef-bourguignon",
    "goodfood-veggie-shepherds-pie-sweet-potato-mash",
    "src-teriyaki-tray",
    "tmpm-26441",
    "tmpm-28247",
  ]);
  assert.equal(R.recipesById["mise-simple-syrniki-oven"].allergens.includes("alcohol"), false, "vanilla is not alcohol");
  assert.ok(registry.recipes.find((recipe) => recipe.id === "goodfood-slow-cooker-beef-bourguignon").allergens.includes("alcohol"), "the server enforces it");
  assert.match(page, /\.filter\(\(allergen\) => allergen !== "alcohol" && prepared\.has\(allergen\)\)/);
});

test("the server rejects a wine dish for a child who must not have alcohol", () => {
  const value = plan({ kind: "child", childEstimate: { sex: "female", age: 9, activity: "usual" }, nutritionTargetMode: "auto", daily: macros(1850), hardExclusions: ["alcohol"] });
  value.mealSlots = ["dinner"];
  value.people[0].includedSlots = ["dinner"];
  value.menuStyle = "budget";
  value.selections = { "batch-1:dinner": "goodfood-slow-cooker-beef-bourguignon" };
  value.selectionAssignments = { "batch-1:dinner": [{ recipeId: "goodfood-slow-cooker-beef-bourguignon", personIds: ["person-1"] }] };
  const result = validatePlanForPersistence(value);
  assert.equal(result.valid, false);
  assert.equal(result.error, "plan violates a hard exclusion");
});

test("the child editor speaks to a parent, not to a dieter", () => {
  const people = page.slice(page.indexOf("function PeopleStep("), page.indexOf("function CookingStep("));
  assert.match(people, /Ребёнок 3–17 лет/);
  assert.match(people, /Ориентир по возрастным нормам ВОЗ\/ФАО \(2004\), а не медицинская рекомендация\. Детям Mise не урезает калории\./);
  assert.match(people, /child \? \([\s\S]*?Мальчик[\s\S]*?Девочка/);
  assert.match(people, /hardExclusions: \[\.\.\.new Set<Allergen>\(\[\.\.\.\(person\.hardExclusions \?\? \[\]\), "alcohol"\]\)\]/);
  assert.match(people, /dislikes: \[\.\.\.new Set\(\[\.\.\.\(person\.dislikes \?\? \[\]\), "sportProtein"\]\)\]/);
  assert.match(people, /До 5 лет: орехи и семечки — только молотыми или рублеными/);
  assert.match(people, /Для детей до 3 лет Mise пока не считает порции/);
  assert.match(people, /!child && people\[0\]\.kind !== "child"/, "adult goals are never copied onto a child");
  const balance = page.slice(page.indexOf("function DailyBalance("), page.indexOf("function AnimatedNumber("));
  assert.match(balance, /child\s*\? "Остальное — еда в саду, школе и перекусы вне плана\."/);
  const dislikes = page.slice(page.indexOf("const dislikeOptions = ["), page.indexOf("] as const;", page.indexOf("const dislikeOptions = [")));
  assert.match(dislikes, /id: "spicy",[\s\S]*?"hot-sauce"/);
  assert.match(dislikes, /id: "sportProtein",[\s\S]*?"casein-powder"/);
});
