/*
 * Scenario matrix of the native menu (2026-10-13): the iOS client's automatic
 * assembly (`generateMobilePlan`) on the bundled catalog, so that a ranking
 * change is judged by measurements: fiber and fresh vegetables a day, macro
 * fit, protein against the target, one dish on lunch and dinner of a batch,
 * and separate dishes in families with children.
 *
 * Run: node scripts/mobile-menu-matrix.mjs [--json out.json]
 * To compare two variants, run it on both code states and compare the summary.
 */
import { readFile, writeFile } from "node:fs/promises";
import { buildMobileBootstrap } from "../domain/mobile.ts";
import { calculateChildNutritionTarget, calculateMealPlanTargets, macrosForCalories } from "../domain/nutrition.ts";
import { generateMobilePlan } from "../domain/plan-generator.ts";
import { canonicalIngredients, fiberForFamily, isFreshVegetableCanonical } from "../domain/recipe-engine.ts";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

export async function loadMobileBootstrap() {
  return buildMobileBootstrap(
    await readJson("data/recipe-runtime-catalog.json"),
    await readJson("data/recipe-release-audit.json"),
    await readJson("data/simple-recipe-images.json"),
  );
}

const threeMeals = ["breakfast", "lunch", "dinner"];
const fiveMeals = ["breakfast", "snack1", "lunch", "snack2", "dinner"];
const adult = (id, kcal, slots) => ({ id, name: id, daily: macrosForCalories(kcal, "balanced"), includedSlots: [...slots], dislikes: [], hardExclusions: [] });
/* A child with the person card's defaults: alcohol, sport protein and, under 12, spicy. */
const child = (id, age, sex, slots) => ({
  id, name: id, kind: "child", childEstimate: { sex, age, activity: "usual" }, nutritionTargetMode: "auto",
  daily: calculateChildNutritionTarget({ sex, age, activity: "usual" }).target, includedSlots: [...slots],
  dislikes: ["sportProtein", ...(age <= 11 ? ["spicy"] : [])], hardExclusions: ["alcohol"],
});

export function mobileMenuScenarios() {
  const scenarios = [];
  for (const style of ["simple", "protein", "budget"]) {
    for (const kcal of [1500, 1800, 2200])
      for (const slots of [threeMeals, fiveMeals])
        for (const days of [5, 7])
          scenarios.push({ name: `${style} ${kcal}, ${slots.length === 3 ? "3 приёма" : "5 приёмов"}, ${days} дн.`, group: "adult", style, days, slots, people: [adult("a", kcal, slots)] });
    scenarios.push({ name: `${style} пара 2200+1600`, group: "adult", style, days: 7, slots: threeMeals, people: [adult("a", 2200, threeMeals), adult("b", 1600, threeMeals)] });
    scenarios.push({ name: `${style} семья 1800 + девочка 9`, group: "family", style, days: 7, slots: threeMeals, people: [adult("a", 1800, threeMeals), child("c", 9, "female", threeMeals)] });
    scenarios.push({ name: `${style} семья 2200 + 1800 + мальчик 4 + девочка 13`, group: "family", style, days: 7, slots: threeMeals, people: [adult("a", 2200, threeMeals), adult("b", 1800, threeMeals), child("c", 4, "male", threeMeals), child("d", 13, "female", threeMeals)] });
    scenarios.push({ name: `${style} семья 1800 + девочка 3, 5 приёмов`, group: "family", style, days: 5, slots: fiveMeals, people: [adult("a", 1800, fiveMeals), child("c", 3, "female", fiveMeals)] });
  }
  return scenarios;
}

const gramsPerUnit = (ingredient, canonical) =>
  ingredient.unit === "piece" ? canonical.unit.gramsPerUnit : ingredient.unit === "ml" ? canonical.densityGPerMl ?? 1 : 1;
/* Portion fit as in the generator: an adult's surplus protein counts as a miss, a child's only a shortfall. */
function portionFit(child, target, actual) {
  const protein = child ? Math.max(0, target.protein - actual.protein) : Math.abs(actual.protein - target.protein);
  return Math.max(0, Math.round(100 - protein / Math.max(1, target.protein) * 45 - Math.abs(actual.fat - target.fat) / Math.max(1, target.fat) * 25 - Math.abs(actual.carbs - target.carbs) / Math.max(1, target.carbs) * 20));
}
const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

export function runMobileMenuScenario(bootstrap, scenario) {
  const draft = {
    id: "matrix", createdAt: "2026-10-13T00:00:00.000Z", start: "2026-10-13", periodDays: scenario.days, cookEveryDays: 3,
    menuStyle: scenario.style, kitchenEquipment: ["stove", "pot", "pan", "oven", "baking_dish"], mealSlots: scenario.slots, people: scenario.people,
  };
  let plan;
  try {
    plan = generateMobilePlan(bootstrap, draft);
  } catch (error) {
    return { name: scenario.name, group: scenario.group, error: error.message };
  }
  const recipes = new Map(bootstrap.recipes.map((recipe) => [recipe.id, recipe]));
  const children = new Set(scenario.people.filter((person) => person.kind === "child").map((person) => person.id));
  const daysOf = (key) => plan.batches.find((batch) => key.startsWith(`${batch.id}:`)).days;
  const people = scenario.people.map((person) => {
    let fiber = 0, vegetables = 0, protein = 0;
    for (const session of plan.cooking) {
      const portion = session.portions.find((item) => item.personId === person.id);
      if (!portion) continue;
      const recipe = recipes.get(session.recipeId);
      const days = daysOf(session.key);
      fiber += fiberForFamily(recipe.solver, portion.amounts) * days;
      for (const ingredient of recipe.solver.ingredients) {
        const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
        if (canonical && isFreshVegetableCanonical(canonical)) vegetables += (portion.amounts[ingredient.sourceIngredientId] ?? 0) * gramsPerUnit(ingredient, canonical) * days;
      }
      protein += portion.actual.protein * days;
    }
    const planned = calculateMealPlanTargets(person.daily, person.includedSlots).planned;
    return {
      id: person.id,
      child: children.has(person.id),
      fiber: Math.round((fiber / scenario.days) * 10) / 10,
      vegetables: Math.round(vegetables / scenario.days),
      proteinShare: Math.round((protein / scenario.days / Math.max(1, planned.protein)) * 1000) / 1000,
    };
  });
  const fits = (child) => plan.cooking.flatMap((session) => session.portions.filter((portion) => children.has(portion.personId) === child).map((portion) => portionFit(child, portion.target, portion.actual)));
  const adultFits = fits(false), childFits = fits(true);
  let sameDish = 0;
  for (const batch of plan.batches) {
    const lunch = plan.selectionAssignments[`${batch.id}:lunch`] ?? [], dinner = plan.selectionAssignments[`${batch.id}:dinner`] ?? [];
    if (lunch.some((item) => dinner.some((other) => other.recipeId === item.recipeId))) sameDish += 1;
  }
  return {
    name: scenario.name,
    group: scenario.group,
    people,
    adultFit: Math.round(average(adultFits) * 10) / 10,
    adultMinFit: Math.min(...adultFits),
    childFit: childFits.length ? Math.round(average(childFits) * 10) / 10 : null,
    childMinFit: childFits.length ? Math.min(...childFits) : null,
    sameDish,
    splitSlots: Object.values(plan.selectionAssignments).filter((groups) => groups.length > 1).length,
    selections: plan.selectionAssignments,
  };
}

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};
export function summarizeMobileMenuMatrix(results) {
  const built = results.filter((result) => !result.error);
  const adults = built.filter((result) => result.group === "adult");
  const families = built.filter((result) => result.group === "family");
  const first = (result) => result.people[0];
  return {
    scenarios: results.length,
    failed: results.filter((result) => result.error).map((result) => result.name),
    adult: {
      plans: adults.length,
      fiberMedian: median(adults.map((result) => first(result).fiber)),
      fiberMin: Math.min(...adults.map((result) => first(result).fiber)),
      vegetablesMedian: median(adults.map((result) => first(result).vegetables)),
      fitAverage: Math.round(average(adults.map((result) => result.adultFit)) * 10) / 10,
      fitMin: Math.min(...adults.map((result) => result.adultMinFit)),
      proteinShareMin: Math.min(...adults.flatMap((result) => result.people.map((person) => person.proteinShare))),
      sameDish: adults.reduce((sum, result) => sum + result.sameDish, 0),
    },
    family: {
      plans: families.length,
      adultFiberMedian: median(families.flatMap((result) => result.people.filter((person) => !person.child).map((person) => person.fiber))),
      childFiberMedian: median(families.flatMap((result) => result.people.filter((person) => person.child).map((person) => person.fiber))),
      adultFitAverage: Math.round(average(families.map((result) => result.adultFit)) * 10) / 10,
      adultFitMin: Math.min(...families.map((result) => result.adultMinFit)),
      childFitMin: Math.min(...families.map((result) => result.childMinFit)),
      adultProteinShareMin: Math.min(...families.flatMap((result) => result.people.filter((person) => !person.child).map((person) => person.proteinShare))),
      childProteinShareMin: Math.min(...families.flatMap((result) => result.people.filter((person) => person.child).map((person) => person.proteinShare))),
      splitSlots: families.reduce((sum, result) => sum + result.splitSlots, 0),
    },
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const bootstrap = await loadMobileBootstrap();
  const results = mobileMenuScenarios().map((scenario) => runMobileMenuScenario(bootstrap, scenario));
  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex >= 0) await writeFile(process.argv[jsonIndex + 1], `${JSON.stringify(results, null, 1)}\n`);
  for (const result of results)
    console.log(result.error
      ? `${result.name}: не собрано — ${result.error}`
      : `${result.name}: ${result.people.map((person) => `${person.child ? "ребёнок" : "взрослый"} ${person.fiber} г клетчатки, ${person.vegetables} г овощей, белок ×${person.proteinShare}`).join("; ")}; попадание ${result.adultFit} (мин. ${result.adultMinFit})${result.childFit === null ? "" : `, у детей ${result.childFit} (мин. ${result.childMinFit})`}`);
  console.log(JSON.stringify(summarizeMobileMenuMatrix(results), null, 1));
}
