import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = async (path) => JSON.parse(await read(path));

const cuisineModule = await loadTypeScriptModule(
  new URL("../domain/recipe-cuisine.ts", import.meta.url),
);
const {
  cuisineOrder,
  cuisineLabels,
  recipeCuisine,
  lookupRecipeCuisine,
  recipeCuisineMarkup,
  matchesCuisine,
  filterByCuisine,
  availableCuisines,
  carryCuisineFilter,
} = cuisineModule;

const engine = await loadTypeScriptModule(
  new URL("../domain/recipe-engine.ts", import.meta.url),
);
const nutrition = await loadTypeScriptModule(
  new URL("../domain/nutrition.ts", import.meta.url),
);
const mealExecution = await loadTypeScriptModule(
  new URL("../domain/meal-execution.ts", import.meta.url),
);

/* Тот же приём, что и в остальных харнессах: кусок app/page.tsx исполняется в
   vm без резолвинга импортов, поэтому доменные функции кладутся в песочницу. */
async function catalogRuntime() {
  const source = await read("app/page.tsx");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(
    `${source.slice(start, end)}\nglobalThis.__catalog = { recipes, productionRecipes, candidateRecipes, allMealSlots };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    recipeCuisine,
    cuisineOrder,
    cuisineLabels,
    matchesCuisine,
    filterByCuisine,
    availableCuisines,
    carryCuisineFilter,
    runtimeRecipeCatalogJson: await readJson("data/recipe-runtime-catalog.json"),
    legacyRecipeImageDownloadSourcesJson: await readJson(
      "data/legacy-recipe-image-download-sources.json",
    ),
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutrition.MEAL_SLOT_SHARES,
    calculateMealPlanTargets: nutrition.calculateMealPlanTargets,
    calculateNutritionTarget: nutrition.calculateNutritionTarget,
    normalizeNutritionTargetMode: nutrition.normalizeNutritionTargetMode,
    capMacrosAtCalories: nutrition.capMacrosAtCalories,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionRepairLegacyDailyMacros: nutrition.repairLegacyDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    materializeInstructions: engine.materializeInstructions,
    canonicalIngredients: engine.canonicalIngredients,
    PILOT_RAW_SOURCE_SLUGS: engine.PILOT_RAW_SOURCE_SLUGS,
    recipeToFamily: engine.recipeToFamily,
    deriveRecipeFamilyFromCatalog: engine.deriveRecipeFamilyFromCatalog,
    solveRecipeFamily: engine.solveRecipeFamily,
    solveRecipeBatch: engine.solveRecipeBatch,
    normalizeRawRecipeCandidate: engine.normalizeRawRecipeCandidate,
    auditRawCandidateAgainstFamily: engine.auditRawCandidateAgainstFamily,
    aggregateCookingAmounts: engine.aggregateCookingAmounts,
    recipeEffortDifficulty: engine.recipeEffortDifficulty,
    recipeEffortLevel: engine.recipeEffortLevel,
    normalizeMealExecution: mealExecution.normalizeMealExecution,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}

const { recipes, productionRecipes, candidateRecipes } = await catalogRuntime();

/* ── Разметка ───────────────────────────────────────────────────────────── */

test("editorial cuisine markup is complete, unique and uses the declared vocabulary", () => {
  assert.equal(recipeCuisineMarkup.schemaVersion, 1);
  assert.equal(
    recipeCuisineMarkup.basis,
    "editorial_manual_assignment_not_keyword_inference",
  );
  assert.deepEqual([...recipeCuisineMarkup.cuisines], [...cuisineOrder]);

  const ids = new Set();
  for (const assignment of recipeCuisineMarkup.assignments) {
    assert.ok(assignment.id, "every assignment names a recipe");
    assert.ok(!ids.has(assignment.id), `no duplicate assignment: ${assignment.id}`);
    ids.add(assignment.id);
    assert.ok(
      cuisineOrder.includes(assignment.cuisine),
      `${assignment.id} uses a declared cuisine, got ${assignment.cuisine}`,
    );
    assert.ok(assignment.title?.trim(), `${assignment.id} records the reviewed title`);
    assert.ok(
      ["runtime", "legacy", "generated"].includes(assignment.origin),
      `${assignment.id} declares where the card comes from`,
    );
  }
  for (const cuisine of cuisineOrder)
    assert.ok(cuisineLabels[cuisine]?.trim(), `${cuisine} has a Russian label`);
});

test("every catalog recipe is marked, and every mark belongs to a catalog recipe", () => {
  const marked = new Set(recipeCuisineMarkup.assignments.map((item) => item.id));
  const catalogIds = new Set(recipes.map((recipe) => recipe.id));
  const unmarked = [...catalogIds].filter((id) => !marked.has(id));
  const orphans = [...marked].filter((id) => !catalogIds.has(id));
  assert.deepEqual(unmarked, [], "no recipe is left without an editorial cuisine");
  assert.deepEqual(orphans, [], "no assignment points at a recipe that no longer exists");
  assert.equal(recipeCuisineMarkup.assignments.length, recipes.length);
});

test("markup titles still match the recipes they were reviewed against", () => {
  const titleById = new Map(recipes.map((recipe) => [recipe.id, recipe.title]));
  const drifted = recipeCuisineMarkup.assignments
    .filter((assignment) => titleById.get(assignment.id) !== assignment.title)
    .map((assignment) => assignment.id);
  assert.deepEqual(
    drifted,
    [],
    "a retitled card must be re-reviewed, not silently inherit its old cuisine",
  );
});

test("cuisine lookup is a strict table, not an inference", async () => {
  const source = await read("domain/recipe-cuisine.ts");
  assert.doesNotMatch(
    source,
    /\btest\(|\bmatch\(|RegExp|\/[^\n/*]+\/[gimsuy]*\.test/,
    "the module never matches a title against a pattern",
  );
  assert.equal(lookupRecipeCuisine("no-such-recipe"), null);
  assert.throws(() => recipeCuisine("no-such-recipe"), /не размечен/);
  assert.equal(recipeCuisine("foodru-oblomov-borscht"), "russian");
  assert.equal(recipeCuisine("foodru-oblomov-chashushuli"), "georgian");
});

/* Ровно те четыре ошибки, из-за которых предыдущая версия была отклонена. */
test("the rejected keyword heuristics are not reproduced by the markup", () => {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const cuisineOf = (id) => {
    assert.ok(byId.has(id), `recipe exists: ${id}`);
    return byId.get(id).cuisine;
  };

  // «Цезарь» — не итальянское блюдо.
  assert.notEqual(cuisineOf("new-sandwich-caesar"), "italian");

  // halal — требование к продуктам, а не кухня, и уж точно не американская.
  assert.notEqual(cuisineOf("src-halal-chicken"), "american");

  // «Запеканка» в названии не делает блюдо русским.
  const bakes = recipes.filter((recipe) => /запеканк/i.test(recipe.title));
  assert.ok(bakes.length >= 3, "the catalog still has bakes to check");
  assert.ok(
    new Set(bakes.map((recipe) => recipe.cuisine)).size > 1,
    "bakes are not all filed as one cuisine",
  );
  assert.notEqual(cuisineOf("tmpm-26647"), "russian");
  assert.notEqual(cuisineOf("goodfood-chicken-pasta-bake"), "russian");

  // Имбирь и прочие «азиатские» специи не переводят блюдо в азиатскую кухню.
  const gingered = recipes.filter((recipe) =>
    recipe.ingredients.some((ingredient) => /имбир/i.test(ingredient.name)),
  );
  assert.ok(gingered.length > 0, "the catalog has recipes with ginger");
  assert.ok(
    gingered.some((recipe) => recipe.cuisine !== "asian"),
    "ginger alone does not make a recipe asian",
  );
});

/* ── Каталог ────────────────────────────────────────────────────────────── */

test("the runtime catalog carries the editorial cuisine and declares the new schema", async () => {
  const [catalog, schema] = await Promise.all([
    readJson("data/recipe-runtime-catalog.json"),
    readJson("data/recipe-runtime-catalog.schema.json"),
  ]);
  assert.equal(catalog.schemaVersion, 3, "adding a required field bumps the schema");
  assert.equal(schema.properties.schemaVersion.const, 3);
  assert.ok(schema.properties.recipes.items.required.includes("cuisine"));
  assert.deepEqual(
    [...schema.properties.recipes.items.properties.cuisine.enum],
    [...cuisineOrder],
  );
  assert.equal(catalog.coverage.runtimeReadyRecipes, 202, "the 202 ready cards are kept");
  assert.equal(catalog.recipes.length, 202);
  for (const record of catalog.recipes)
    assert.ok(
      cuisineOrder.includes(record.cuisine),
      `${record.id} has an editorial cuisine`,
    );
  assert.equal(
    Object.values(catalog.coverage.byCuisine).reduce((sum, count) => sum + count, 0),
    catalog.recipes.length,
  );
});

/* ── Фильтр ─────────────────────────────────────────────────────────────── */

test("the cuisine filter primitives are total and order-stable", () => {
  const items = [
    { id: "a", cuisine: "american" },
    { id: "b", cuisine: "russian" },
    { id: "c", cuisine: "american" },
  ];
  assert.deepEqual([...filterByCuisine(items, null)], items, "no filter shows everything");
  assert.deepEqual(
    filterByCuisine(items, "american").map((item) => item.id),
    ["a", "c"],
  );
  assert.deepEqual([...filterByCuisine(items, "georgian")], []);
  assert.equal(matchesCuisine("russian", null), true);
  assert.equal(matchesCuisine("russian", "russian"), true);
  assert.equal(matchesCuisine("russian", "italian"), false);
  assert.equal(matchesCuisine(undefined, "italian"), false);
  // Порядок меню задаётся cuisineOrder, а не порядком карточек.
  assert.deepEqual([...availableCuisines(items)], ["russian", "american"]);
});

test("the catalog filter returns only the chosen cuisine and never empties a present one", () => {
  const catalogCuisines = availableCuisines(productionRecipes);
  assert.ok(catalogCuisines.length >= 5, "the production catalog spans several cuisines");
  for (const cuisine of catalogCuisines) {
    const filtered = filterByCuisine(productionRecipes, cuisine);
    assert.ok(filtered.length > 0, `${cuisine} is offered only when it has recipes`);
    assert.ok(
      filtered.every((recipe) => recipe.cuisine === cuisine),
      `${cuisine} filter leaks no other cuisine`,
    );
  }
  assert.equal(filterByCuisine(productionRecipes, null).length, productionRecipes.length);
});

const person = (kcal, includedSlots) => ({
  id: "manual",
  name: "Manual",
  daily: {
    kcal,
    protein: Math.round((kcal * 0.3) / 4),
    fat: Math.round((kcal * 0.3) / 9),
    carbs: Math.round((kcal * 0.4) / 4),
  },
  includedSlots,
  hardExclusions: [],
  dislikes: [],
});

test("manual choice filters the slot's candidates by cuisine", () => {
  const slots = ["breakfast", "lunch", "dinner"];
  const eater = person(2100, slots);
  let checked = 0;
  for (const slot of slots) {
    const options = candidateRecipes(slot, "protein", [eater], 3, { limit: "all" });
    assert.ok(options.length > 0, `${slot} has candidates`);
    const offered = availableCuisines(options);
    assert.ok(offered.length > 1, `${slot} offers a real choice of cuisines`);
    for (const cuisine of offered) {
      const filtered = filterByCuisine(options, cuisine);
      assert.ok(filtered.length > 0, `${slot}/${cuisine} is not an empty menu entry`);
      assert.ok(filtered.every((recipe) => recipe.cuisine === cuisine));
      assert.ok(filtered.length <= options.length);
      checked += 1;
    }
    assert.equal(filterByCuisine(options, null).length, options.length);
  }
  assert.ok(checked > 0);
});

test("moving between wizard slots carries a cuisine that still exists and drops one that does not", () => {
  assert.equal(carryCuisineFilter(null, ["russian", "italian"]), null);
  assert.equal(carryCuisineFilter("italian", ["russian", "italian"]), "italian");
  assert.equal(carryCuisineFilter("georgian", ["russian", "italian"]), null);
  assert.equal(carryCuisineFilter("italian", []), null);

  // На настоящих данных: кухня, которой в следующем слоте нет, обязана уйти,
  // иначе пользователь увидит пустой список без видимой причины.
  const eater = person(2100, ["breakfast", "lunch", "dinner"]);
  const breakfast = candidateRecipes("breakfast", "protein", [eater], 3, { limit: "all" });
  const dinner = candidateRecipes("dinner", "protein", [eater], 3, { limit: "all" });
  const breakfastCuisines = availableCuisines(breakfast);
  const dinnerCuisines = availableCuisines(dinner);
  for (const cuisine of breakfastCuisines) {
    const carried = carryCuisineFilter(cuisine, dinnerCuisines);
    if (carried) {
      assert.ok(filterByCuisine(dinner, carried).length > 0, `${cuisine} survives with results`);
    } else {
      assert.equal(filterByCuisine(dinner, cuisine).length, 0, `${cuisine} is dropped only when empty`);
    }
  }
});

/* ── Проводка в интерфейсе ──────────────────────────────────────────────── */

test("the catalog screen and the manual step are wired to the shared filter", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /import \{\s*availableCuisines,[\s\S]*?\} from "@\/domain\/recipe-cuisine";/);
  assert.match(page, /cuisine: recipeCuisine\(id\),/, "the builder reads the editorial markup");
  assert.match(page, /cuisine: record\.cuisine,/, "runtime cards carry their catalog cuisine");

  // Каталог.
  assert.match(page, /if \(!matchesCuisine\(recipe\.cuisine, state\.cuisine\)\) return false;/);
  assert.match(page, /id: "cuisine",\n\s*label: cuisineLabels\[state\.cuisine\],/);
  assert.match(page, /clear: \(\) => \(\{ \.\.\.state, cuisine: null \}\),/);
  assert.match(page, /const catalogCuisines = useMemo\(\n\s*\(\) => availableCuisines\(productionRecipes\),/);
  assert.match(page, /<div className="catalog-cuisine-row">\n\s*<CuisineMenu\n\s*value=\{state\.cuisine\}/,
    "кухня стоит отдельной строкой, а не в ряду действий шапки");

  // Ручной выбор.
  assert.match(page, /function CuisineMenu\(/);
  assert.match(page, /const \[cuisineFilter, setCuisineFilter\] = useState<Cuisine \| null>\(null\);/);
  assert.match(
    page,
    /const activeCuisine = carryCuisineFilter\(cuisineFilter, slotCuisines\);/,
    "the slot transition rule is applied to the slot's own cuisines",
  );
  assert.match(page, /const allOptions = filterByCuisine\(slotOptions, activeCuisine\);/);
  assert.match(page, /<CuisineMenu\n\s*value=\{activeCuisine\}/);
  assert.match(page, /Показать все кухни — \{slotOptions\.length\}/);
  assert.match(
    page,
    /\{!options\.length && !activeCuisine && \(\n\s*<button\n\s*className="secondary-button manual-split-button"/,
    "the personal-split path stays tied to a real absence of candidates",
  );
});

test("the cuisine menu is animated and respects reduced motion", async () => {
  const css = await read("app/globals.css");
  // Панель обязана оставаться внутри экрана на 320 px.
  assert.match(css, /\.cuisine-menu-panel \{[\s\S]*?max-width: min\(268px, calc\(100vw - 32px\)\);/);
  assert.match(css, /\.catalog-cuisine-row \.cuisine-menu-panel \{[\s\S]*?left: 0;/);
  assert.match(css, /@keyframes mise-cuisine-panel-in \{/);
  assert.match(css, /@keyframes mise-cuisine-panel-out \{/);
  assert.match(css, /@keyframes mise-cuisine-option-in \{/);
  assert.match(css, /\.cuisine-menu-panel \{[\s\S]*?animation: mise-cuisine-panel-in/);
  assert.match(css, /\.cuisine-menu-option \{[\s\S]*?animation-delay: var\(--cuisine-delay, 0ms\);/);
  // Правила живут в общем блоке reduced-motion в конце файла, а не в своём.
  const reducedMotion = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(
    reducedMotion,
    /\.cuisine-menu-panel,\n\s*\.cuisine-menu-panel\.is-closing,\n\s*\.cuisine-menu-option \{\n\s*animation: none;/,
  );
  assert.match(
    reducedMotion,
    /\.cuisine-menu-trigger svg,[\s\S]*?transition: none;/,
  );
});
