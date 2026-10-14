import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMobileBootstrap } from "../domain/mobile.ts";
import { calculateChildNutritionTarget, childMacrosForCalories, macrosForCalories } from "../domain/nutrition.ts";
import { generateMobilePlan, recipeMatchesDislikes } from "../domain/plan-generator.ts";
import { mobileMenuScenarios, runMobileMenuScenario, summarizeMobileMenuMatrix } from "../scripts/mobile-menu-matrix.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const audit = JSON.parse(await readFile(new URL("../data/recipe-release-audit.json", import.meta.url), "utf8"));
const simpleManifest = JSON.parse(await readFile(new URL("../data/simple-recipe-images.json", import.meta.url), "utf8"));
const bootstrap = buildMobileBootstrap(catalog, audit, simpleManifest);
const person = (id = "p1", extra = {}) => ({ id, name: id, daily: { kcal: 2000, protein: 150, fat: 60, carbs: 215 }, includedSlots: ["lunch"], ...extra });
const allEquipment = [...bootstrap.limits.kitchenEquipment];
const draft = (extra = {}) => ({ id: "offline-plan", createdAt: "2026-09-25T12:00:00Z", start: "2026-09-25", periodDays: 1, cookEveryDays: 1, menuStyle: "protein", kitchenEquipment: allEquipment, mealSlots: ["lunch"], people: [person()], ...extra });

test("deterministic offline plans cover period and household limits and persist", () => {
  for (const days of [1, 14]) for (const count of [1, 4]) {
    const input = draft({ periodDays: days, cookEveryDays: 3, people: Array.from({ length: count }, (_, i) => person(`p${i}`)) });
    const plan = generateMobilePlan(bootstrap, input);
    assert.deepEqual(plan, generateMobilePlan(bootstrap, input));
    assert.equal(validatePlanForPersistence(plan).valid, true);
    assert.equal(plan.batches.reduce((sum, b) => sum + b.days, 0), days);
    assert.equal(plan.batches.at(-1).end, plan.end);
    assert.equal(plan.cooking.reduce((sum, c) => sum + c.personIds.length * plan.batches.find((b) => c.key.startsWith(`${b.id}:`)).days, 0), days * count);
    assert.equal(Object.keys(plan.selectionAssignments).length, Object.keys(plan.selections).length);
    assert.ok(Object.entries(plan.selectionAssignments).every(([key, groups]) => groups.length > 0 && groups[0].recipeId === plan.selections[key]));
    assert.ok(plan.shopping.every((i) => Number.isFinite(i.quantity) && i.quantity > 0));
    assert.ok(plan.cooking.every((c) => c.portions.every((p) => p.actual.kcal >= p.target.kcal * .9 && p.actual.kcal <= p.target.kcal * 1.05)));
  }
});

test("style gates recipes and all release styles can generate", () => {
  for (const menuStyle of ["simple", "protein", "budget"]) {
    const plan = generateMobilePlan(bootstrap, draft({ menuStyle }));
    for (const id of Object.values(plan.selections)) assert.ok(bootstrap.recipes.find((r) => r.id === id).menuTags.includes(menuStyle));
  }
});

test("simple main dishes can cover lunch and dinner like the web release", () => {
  const input = draft({ menuStyle: "simple", mealSlots: ["lunch", "dinner"], people: [person("p1", { includedSlots: ["lunch", "dinner"] })] });
  const plan = generateMobilePlan(bootstrap, input);
  assert.ok(plan.selections["batch-0:lunch"]);
  assert.ok(plan.selections["batch-0:dinner"]);
});

test("new plans use only the original recipe route supported by selected equipment", () => {
  const noHeatRecipes = bootstrap.recipes.filter((recipe) => recipe.slot === "breakfast" && recipe.menuTags.includes("protein") && recipe.equipmentOptions.find((method) => method.id === "original")?.requiredEquipment.length === 0);
  const noHeat = generateMobilePlan({ ...bootstrap, recipes: noHeatRecipes }, draft({ kitchenEquipment: [], mealSlots: ["breakfast"], people: [person("p1", { includedSlots: ["breakfast"] })] }));
  assert.ok(Object.values(noHeat.selections).every((id) => noHeatRecipes.some((recipe) => recipe.id === id)));

  const incompatible = bootstrap.recipes.find((recipe) => recipe.slot === "lunch" && recipe.menuTags.includes("protein") && recipe.equipmentOptions.find((method) => method.id === "original")?.requiredEquipment.length);
  assert.ok(incompatible);
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [incompatible] }, draft({ kitchenEquipment: [] })), { code: "no_candidate" });
});

test("all five meal slots remain complete for a fourteen-day plan", () => {
  const mealSlots = [...bootstrap.limits.mealSlots];
  const plan = generateMobilePlan(bootstrap, draft({ periodDays: 14, cookEveryDays: 3, mealSlots, people: [person("a", { includedSlots: mealSlots }), person("b", { includedSlots: ["lunch", "dinner"] })] }));
  assert.equal(validatePlanForPersistence(plan).valid, true);
  assert.equal(Object.keys(plan.selections).length, plan.batches.length * 5);
  assert.equal(plan.cooking.reduce((sum, c) => sum + c.personIds.length * plan.batches.find((b) => c.key.startsWith(`${b.id}:`)).days, 0), 14 * 7);
});

test("soft dislikes need explicit override; hard exclusions cannot be overridden", () => {
  const initial = generateMobilePlan(bootstrap, draft());
  const recipe = bootstrap.recipes.find((r) => r.id === initial.selections["batch-0:lunch"]);
  const single = { ...bootstrap, recipes: [recipe] };
  const disliked = draft({ people: [person("p1", { dislikes: [recipe.ingredients[0].canonicalIngredientId] })] });
  assert.throws(() => generateMobilePlan(single, disliked), { code: "no_candidate" });
  assert.equal(generateMobilePlan(single, { ...disliked, includeDisliked: true }).selections["batch-0:lunch"], recipe.id);
  const allergen = recipe.ingredients.flatMap((i) => i.allergens)[0];
  assert.ok(allergen, "fixture contains an allergen");
  assert.throws(() => generateMobilePlan(single, draft({ includeDisliked: true, people: [person("p1", { hardExclusions: [allergen] })] })), { code: "no_candidate" });
});

test("incompatible eaters get separate assignments with complete coverage", () => {
  // Synthetic presentation allergens isolate assignment logic while retaining real solver inputs.
  const first = generateMobilePlan(bootstrap, draft()).selections["batch-0:lunch"];
  const second = generateMobilePlan({ ...bootstrap, recipes: bootstrap.recipes.filter((r) => r.id !== first) }, draft()).selections["batch-0:lunch"];
  const splitCatalog = { ...bootstrap, recipes: [first, second].map((id, index) => {
    const r = structuredClone(bootstrap.recipes.find((x) => x.id === id));
    r.ingredients[0].allergens.push(`test-${index}`);
    return r;
  }) };
  const plan = generateMobilePlan(splitCatalog, draft({ people: [person("a", { hardExclusions: ["test-1"] }), person("b", { hardExclusions: ["test-1"] }), person("c", { hardExclusions: ["test-0"] })] }));
  assert.equal(validatePlanForPersistence(plan).valid, true);
  assert.deepEqual(plan.selectionAssignments["batch-0:lunch"], [{ recipeId: first, personIds: ["a", "b"] }, { recipeId: second, personIds: ["c"] }]);
});

test("quantities aggregate solved ingredients for people and days with cooking fat once", () => {
  const plan = generateMobilePlan(bootstrap, draft({ periodDays: 3, cookEveryDays: 3, people: [person(), person("p2")] }));
  const expected = new Map();
  for (const c of plan.cooking) {
    const recipe = bootstrap.recipes.find((r) => r.id === c.recipeId);
    for (const i of recipe.ingredients) {
      const key = `${i.canonicalIngredientId}:${{ g: "г", ml: "мл", piece: "шт." }[i.unit]}`;
      expected.set(key, (expected.get(key) ?? 0) + c.amounts[i.id]);
    }
    for (const i of recipe.solver.ingredients) {
      assert.equal(c.amounts[i.sourceIngredientId], i.role === "fat_cooking" ? i.baseAmount : Math.round(c.portions.reduce((sum, p) => sum + p.amounts[i.sourceIngredientId], 0) * 3 * 10) / 10);
    }
  }
  for (const item of plan.shopping) assert.equal(item.quantity, item.unit === "шт." ? Math.ceil(expected.get(item.key)) : Math.ceil(expected.get(item.key) / 10) * 10);
});

test("storage rejects unsafe batches and explicitly counts freezing", () => {
  const recipe = bootstrap.recipes.find((r) => r.id === generateMobilePlan(bootstrap, draft()).selections["batch-0:lunch"]);
  const cold = { ...recipe, storage: { ...recipe.storage, refrigeratorDays: 1, freezerDays: 30, freezable: false } };
  const input = draft({ periodDays: 3, cookEveryDays: 3 });
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [cold] }, input), { code: "no_candidate" });
  const plan = generateMobilePlan({ ...bootstrap, recipes: [{ ...cold, storage: { ...cold.storage, freezable: true } }] }, input);
  assert.equal(plan.cooking[0].frozenDays, 2);
});

test("replace-one keeps every reviewed slot except the requested slot", () => {
  const input = draft({ periodDays: 4, cookEveryDays: 2, mealSlots: ["lunch", "dinner"], people: [person("p1", { includedSlots: ["lunch", "dinner"] })] });
  const original = generateMobilePlan(bootstrap, input);
  const targetKey = "batch-0:lunch";
  const pinnedSelections = Object.fromEntries(
    Object.entries(original.selections).filter(([key]) => key !== targetKey),
  );
  const pinnedAssignments = Object.fromEntries(
    Object.entries(original.selectionAssignments).filter(([key]) => key !== targetKey),
  );
  const replaced = generateMobilePlan(bootstrap, {
    ...input,
    pinnedSelections,
    pinnedAssignments,
    excludedRecipeIds: { [targetKey]: [original.selections[targetKey]] },
  });
  assert.notEqual(replaced.selections[targetKey], original.selections[targetKey]);
  for (const [key, recipeId] of Object.entries(original.selections)) {
    if (key !== targetKey) assert.equal(replaced.selections[key], recipeId);
  }
});

test("no candidates and bad input fail without partial plans", () => {
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [] }, draft()), { code: "no_candidate" });
  assert.throws(() => generateMobilePlan({ ...bootstrap, schemaVersion: 999 }, draft()), { code: "unsupported_catalog" });
  for (const extra of [{ periodDays: 0 }, { periodDays: 15 }, { people: [] }, { people: Array.from({ length: 5 }, (_, i) => person(`p${i}`)) }, { start: "2026-02-30" }, { people: [person("a"), person("a")] }, { mealSlots: ["lunch", "lunch"] }, { kitchenEquipment: ["invalid"] }]) assert.throws(() => generateMobilePlan(bootstrap, draft(extra)), { code: "invalid_draft" });
});

/* Семейный режим в iOS-клиенте (2026-10-13): те же правила, что в PWA, — дети
   3–17 лет по возрастным нормам, меньшая доля общего блюда, «Алкоголь в блюде»,
   «Острое» и «Спортивный протеин» по умолчанию. */
const kid = (id, age, sex = "female", extra = {}) => person(id, {
  kind: "child", childEstimate: { sex, age, activity: "usual" }, nutritionTargetMode: "auto",
  daily: calculateChildNutritionTarget({ sex, age, activity: "usual" }).target,
  dislikes: ["sportProtein", ...(age <= 11 ? ["spicy"] : [])], hardExclusions: ["alcohol"], ...extra,
});

test("a child's calories follow the age, an adult stays at 1200+ and a child needs an age", () => {
  const manualChild = (age, kcal, childEstimate = { sex: "female", age, activity: "usual" }) => person("c", { kind: "child", childEstimate, nutritionTargetMode: "manual", daily: childMacrosForCalories(kcal) });
  for (const [age, kcal] of [[5, 800], [16, 4500], [10, 3000], [11, 1200]]) {
    const plan = generateMobilePlan(bootstrap, draft({ people: [manualChild(age, kcal)] }));
    assert.equal(validatePlanForPersistence(plan).valid, true, `${age} y at ${kcal} kcal`);
  }
  for (const people of [
    [manualChild(16, 800)], [manualChild(9, 3100)], [manualChild(11, 1190)],
    [person("c", { kind: "child", nutritionTargetMode: "manual", daily: childMacrosForCalories(1500) })], [manualChild(2, 1000)], [manualChild(9, 1500, { sex: "female" })],
    [person("a", { daily: childMacrosForCalories(800) })], [person("r", { kind: "robot" })],
  ]) assert.throws(() => generateMobilePlan(bootstrap, draft({ people })), { code: "invalid_draft" });
});

test("an automatic child is sized by age, never by a stale adult estimate", () => {
  // Пикабу: девочке 9 лет оставалась взрослая норма 2460 ккал.
  const stale = kid("c", 9, "female", { daily: { kcal: 2460, protein: 117, fat: 82, carbs: 313 }, estimate: { sex: "male", age: 30, height: 178, weight: 78, activity: "medium", musclePriority: false, goal: "loss", monthlyWeightChangeKg: 1 } });
  const plan = generateMobilePlan(bootstrap, draft({ people: [stale] }));
  assert.equal(plan.people[0].daily.kcal, 1850);
  assert.equal("estimate" in plan.people[0], false);
  assert.equal(validatePlanForPersistence(plan).valid, true);
});

test("a small child takes a smaller share of the family dish instead of splitting the table", () => {
  const slots = ["breakfast", "lunch", "dinner"];
  for (const menuStyle of ["simple", "protein", "budget"]) {
    const people = [person("mom", { daily: macrosForCalories(1800, "balanced"), includedSlots: slots }), kid("masha", 3, "female", { includedSlots: slots })];
    const plan = generateMobilePlan(bootstrap, draft({ menuStyle, periodDays: 6, cookEveryDays: 3, mealSlots: slots, people }));
    assert.equal(validatePlanForPersistence(plan).valid, true, menuStyle);
    assert.ok(Object.values(plan.selectionAssignments).every((groups) => groups.length === 1), `${menuStyle}: one dish for the family`);
    let shared = 0;
    for (const session of plan.cooking) {
      const [grown, small] = session.portions;
      for (const portion of session.portions) assert.ok(portion.actual.kcal >= portion.target.kcal * 0.9 - 0.5 && portion.actual.kcal <= portion.target.kcal * 1.05 + 0.5, `${menuStyle} ${session.key}`);
      assert.ok(small.actual.kcal < grown.actual.kcal * 0.8, `${menuStyle} ${session.key}: the child's share is smaller`);
      // Ниже минимальной порции рецепта ребёнок получает долю, решённую на опорную калорийность.
      if (small.actual.kcal < bootstrap.recipes.find((recipe) => recipe.id === session.recipeId).solver.minViableCalories * 0.9) shared += 1;
    }
    assert.ok(shared > 0, `${menuStyle}: some child portions are a share below the recipe minimum`);
  }
});

test("a family with a child shares dishes without wine, spice or sport protein, and the server accepts them", () => {
  const slots = ["breakfast", "lunch", "dinner"];
  for (const menuStyle of ["simple", "protein", "budget"]) {
    const people = [person("dad", { daily: macrosForCalories(2200, "balanced"), includedSlots: slots }), kid("sasha", 6, "male", { includedSlots: slots })];
    const plan = generateMobilePlan(bootstrap, draft({ menuStyle, periodDays: 7, cookEveryDays: 3, mealSlots: slots, people }));
    assert.equal(validatePlanForPersistence(plan).valid, true, menuStyle);
    for (const groups of Object.values(plan.selectionAssignments)) for (const group of groups) {
      const recipe = bootstrap.recipes.find((item) => item.id === group.recipeId);
      assert.equal(recipe.allergens.includes("alcohol") || recipe.spicy || recipeMatchesDislikes(recipe, ["sportProtein"]), false, `${menuStyle}: ${recipe.title}`);
    }
  }
  const wine = bootstrap.recipes.find((recipe) => recipe.id === "goodfood-slow-cooker-beef-bourguignon");
  const dinner = (people) => draft({ menuStyle: "budget", mealSlots: ["dinner"], people: people.map((item) => ({ ...item, includedSlots: ["dinner"] })) });
  assert.equal(generateMobilePlan({ ...bootstrap, recipes: [wine] }, dinner([person("dad")])).selections["batch-0:dinner"], wine.id);
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [wine] }, { ...dinner([kid("sasha", 9)]), includeDisliked: true }), { code: "no_candidate" }, "alcohol is a hard exclusion");
});

test("«Не люблю» options chosen in the app exclude their products; dislikes stay soft", () => {
  // Раньше нативный генератор сравнивал «salmon» с «salmon_raw», и отметки не работали.
  for (const code of ["fish", "cottage", "egg", "legumes", "spicy", "sportProtein"]) {
    const matching = bootstrap.recipes.filter((recipe) => recipeMatchesDislikes(recipe, [code]));
    assert.ok(matching.length > 0, `${code} matches some recipes`);
    const chosen = matching.flatMap((recipe) => {
      const style = recipe.menuTags[0];
      const input = draft({ menuStyle: style, mealSlots: [recipe.slot], people: [person("p", { daily: macrosForCalories(2400, "balanced"), includedSlots: [recipe.slot] })] });
      try { return [{ recipe, input, plan: generateMobilePlan({ ...bootstrap, recipes: [recipe] }, input) }]; } catch { return []; }
    })[0];
    assert.ok(chosen, `${code}: a matching recipe can be planned`);
    const disliked = { ...chosen.input, people: chosen.input.people.map((item) => ({ ...item, dislikes: [code] })) };
    assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [chosen.recipe] }, disliked), { code: "no_candidate" }, code);
    assert.equal(generateMobilePlan({ ...bootstrap, recipes: [chosen.recipe] }, { ...disliked, includeDisliked: true }).selections[`batch-0:${chosen.recipe.slot}`], chosen.recipe.id);
  }
});

test("a hard exclusion covers allergens of procedure ingredients, as on the server", () => {
  // Кальцоне смазывают молоком или яйцом: яйцо есть только в продуктах процедуры.
  const calzone = bootstrap.recipes.find((recipe) => recipe.id === "goodfood-mozzarella-pepper-aubergine-calzone");
  assert.equal(calzone.ingredients.some((ingredient) => ingredient.allergens.includes("egg")), false);
  assert.ok(calzone.allergens.includes("egg"));
  // Тот же случай на блюде, которое собирается: аллерген указан только у карточки.
  const lunch = structuredClone(bootstrap.recipes.find((recipe) => recipe.id === generateMobilePlan(bootstrap, draft()).selections["batch-0:lunch"]));
  lunch.ingredients.forEach((ingredient) => { ingredient.allergens = ingredient.allergens.filter((code) => code !== "sesame"); });
  lunch.allergens = [...new Set([...lunch.allergens, "sesame"])];
  assert.equal(generateMobilePlan({ ...bootstrap, recipes: [lunch] }, draft()).selections["batch-0:lunch"], lunch.id);
  assert.throws(() => generateMobilePlan({ ...bootstrap, recipes: [lunch] }, draft({ includeDisliked: true, people: [person("p1", { hardExclusions: ["sesame"] })] })), { code: "no_candidate" });
});

test("the fiber-aware ranking holds its measured scenario matrix", () => {
  const results = mobileMenuScenarios().map((scenario) => runMobileMenuScenario(bootstrap, scenario));
  const summary = summarizeMobileMenuMatrix(results);
  // Каталог без перекусов «Простых» и без перекусов на 150 ккал: эти планы не собирались и до клетчатки.
  const knownGaps = new Set([
    ...["1500", "1800", "2200"].flatMap((kcal) => [5, 7].map((days) => `simple ${kcal}, 5 приёмов, ${days} дн.`)),
    ...["protein", "budget"].flatMap((style) => [5, 7].map((days) => `${style} 1500, 5 приёмов, ${days} дн.`)),
    "simple семья 1800 + девочка 3, 5 приёмов",
  ]);
  assert.deepEqual(summary.failed.filter((name) => !knownGaps.has(name)), [], "no new failures");
  assert.ok(summary.adult.fiberMedian >= 20, `fiber median ${summary.adult.fiberMedian} g (16.2 without the bonus)`);
  assert.ok(summary.adult.vegetablesMedian >= 270, `vegetables median ${summary.adult.vegetablesMedian} g (223 without the bonus)`);
  assert.ok(summary.adult.fitAverage >= 92, `fit ${summary.adult.fitAverage}`);
  assert.ok(summary.adult.proteinShareMin >= 1, `protein ${summary.adult.proteinShareMin} of target`);
  assert.equal(summary.adult.sameDish, 0);
  assert.equal(summary.family.plans, 8);
  assert.equal(summary.family.splitSlots, 0, "families with children cook one dish per meal");
  assert.ok(summary.family.adultProteinShareMin >= 1 && summary.family.childProteinShareMin >= 1);
  assert.ok(summary.family.childFitMin >= 70, `child fit ${summary.family.childFitMin}`);
});
