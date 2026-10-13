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
    `${page.slice(start, end)}\nglobalThis.__runtime = { candidateRecipes, recipeCookingSession, newPerson, normalizePerson, automaticEstimateIssue, recipes, recipesById, defaultKitchenEquipment, crossContactWarnings, recipeIsSpicy, childServingNotes };`,
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
  assert.match(people, /const addedHard = \(\["alcohol"\] as Allergen\[\]\)/);
  assert.match(people, /const addedDislikes = \["sportProtein"\]/);
  // Ошибочное переключение возвращает взрослого как было: параметры, норму,
  // имя и без детских исключений, добавленных переключением.
  assert.match(people, /kindUndoRef\.current\.set\(person\.id, \{\s*adult: \{\s*estimate: person\.estimate,\s*daily: person\.daily,/);
  assert.match(people, /hardExclusions: \(person\.hardExclusions \?\? \[\]\)\.filter\(\(item\) => !undo\?\.addedHard\.includes\(item\)\)/);
  // Ребёнку не переходит взрослая норма, а ручная норма начинается от возрастной.
  assert.match(people, /daily: childMacrosForCalories\(0\),/);
  assert.match(people, /disabled=\{!computed && \(manual \|\| child\)\}/);
  assert.match(people, /child && computed\s*\? \{ nutritionTargetMode: "manual", daily: computed \}/);
  // Два ребёнка не получают одно имя на контейнерах.
  assert.match(people, /for \(let index = 2; takenNames\.has\(childName\); index \+= 1\) childName = `Ребёнок \$\{index\}`;/);
  // «Острое» по умолчанию — один раз; снятая родителем отметка не возвращается.
  assert.match(people, /if \(ageValid && !spicy\.applied\)/);
  assert.match(people, /spicyDefaultRef\.current\.set\(person\.id, \{ applied: true, added: false \}\)/);
  assert.match(people, /Норма введена вручную — например, по назначению врача или диетолога\./);
  assert.match(people, /announceAutoCalculation\(nextCalculation\.target, explanation\)/);
  assert.match(people, /До 5 лет: орехи и семечки — только молотыми или рублеными/);
  assert.match(people, /Для детей до 3 лет Mise пока не считает порции/);
  assert.match(people, /!child && people\[0\]\.kind !== "child"/, "adult goals are never copied onto a child");
  const balance = page.slice(page.indexOf("function DailyBalance("), page.indexOf("function AnimatedNumber("));
  assert.match(balance, /child\s*\? "Остальное — еда в саду, школе и перекусы вне плана\."/);
  const dislikes = page.slice(page.indexOf("const dislikeOptions = ["), page.indexOf("] as const;", page.indexOf("const dislikeOptions = [")));
  assert.match(dislikes, /id: "spicy",[\s\S]*?"hot-sauce"/);
  assert.match(dislikes, /id: "sportProtein",[\s\S]*?"casein-powder"/);
});

test("«Острое» covers spicy blends, measured chili and spicy titles, but not a pinch to taste", () => {
  const spicy = (id) => R.recipeIsSpicy(R.recipesById[id]);
  const options = R.candidateRecipes("lunch", "budget", [adult(0, 1500)], 3, { limit: "all" }, [...R.defaultKitchenEquipment]);
  const tacoPasta = options.find((recipe) => /Острая паста/u.test(recipe.title));
  if (tacoPasta) assert.equal(spicy(tacoPasta.id), true, "taco seasoning and the title make it spicy");
  const pinch = R.recipes.find((recipe) => (recipe.procedureIngredients ?? []).some((item) => item.classification === "to_taste" && /остр/iu.test(item.name) && (item.quantityPerServing ?? 0) < 1) && !/остр|чили|халап|чипотле/iu.test(recipe.title) && !recipe.ingredients.some((item) => /jalapeno|hot_sauce|taco|curry_paste|gochujang|chili|kimchi|buffalo/.test(item.canonicalIngredientId ?? item.id)));
  assert.ok(pinch, "a recipe with only a pinch of chili exists");
  assert.equal(spicy(pinch.id), false);
  const kid = child(1, 6, "female");
  kid.dislikes = ["spicy", "sportProtein"];
  kid.hardExclusions = ["alcohol"];
  const family = [adult(0, 1800), kid];
  for (const style of ["simple", "protein", "budget"])
    for (const slot of ["breakfast", "lunch", "dinner"]) {
      const shared = R.candidateRecipes(slot, style, family, 3, { limit: "all" }, [...R.defaultKitchenEquipment]);
      assert.ok(shared.length >= 3, `${style} ${slot}: ${shared.length} shared dishes with child defaults`);
      assert.ok(shared.every((recipe) => !R.recipeIsSpicy(recipe) && !recipe.allergens.includes("alcohol")), `${style} ${slot} keeps the child defaults`);
    }
});

test("recipe notes for a child are actionable and never decline a name", () => {
  const pinch = R.recipes.find((recipe) => !R.recipeIsSpicy(recipe) && (recipe.procedureIngredients ?? []).some((item) => /остр/iu.test(item.name)));
  const mom = adult(0, 1800);
  const masha = child(1, 4, "female");
  masha.dislikes = ["spicy"];
  const teen = child(2, 15, "male");
  const [adultNote] = R.childServingNotes(pinch, [mom, masha]);
  assert.match(adultNote, /положите меньше или не кладите вовсе — взрослые добавят его в свои порции/);
  assert.match(R.childServingNotes(pinch, [masha])[0], /для этой готовки его можно не класть/);
  assert.equal(R.childServingNotes(pinch, [mom, teen]).length, 0, "a teenager who eats spicy food gets no chili note");
  const nuts = R.recipes.find((recipe) => recipe.ingredients.some((item) => /walnuts|almonds|peanuts|cashews/.test(item.canonicalIngredientId ?? item.id)));
  const nutNotes = R.childServingNotes(nuts, [mom, masha, child(3, 3, "male")]);
  assert.ok(nutNotes.some((note) => /^Для детей до 5 лет \(Маша|^Для детей до 5 лет \(/u.test(note)), nutNotes.join(" | "));
  assert.equal(R.childServingNotes(nuts, [mom, child(2, 9, "female")]).filter((note) => /до 5 лет/.test(note)).length, 0);
});

test("the week names people without declining them", () => {
  assert.match(page, /Не рассчитана норма: \{unratedPeople\.map\(\(item\) => item\.name \|\| "без имени"\)\.join\(", "\)\}\./);
  assert.match(page, /в профиле нажмите «Изменить» и выберите «Ребёнок 3–17 лет»\./);
  assert.match(page, /<button type="button" className="text-button" onClick=\{onOpenProfile\}>/);
});
