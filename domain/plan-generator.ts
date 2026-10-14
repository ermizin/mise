import type { MobileBootstrap, MobileKitchenEquipment, MobileRecipe, MobileMealSlot, MobileMenuStyle } from "./mobile.ts";
import { MOBILE_BOOTSTRAP_SCHEMA_VERSION, MOBILE_CATALOG_SCHEMA_VERSION } from "./mobile.ts";
import { calculateMealPlanTargets, mealProteinFloor, normalizeAutomaticNutritionTargets, personCalorieRange } from "./nutrition.ts";
import type { ChildNutritionInput, Macros, NutritionTargetMode, NutritionWizardInput } from "./nutrition.ts";
import { aggregateCookingAmounts, canonicalIngredients, familyFiberProfile, solveChildShare, solveRecipeFamily } from "./recipe-engine.ts";
import type { RecipeFamilySolverInput, SolveRecipeFamilyInput } from "./recipe-engine.ts";

export type PlanPerson = {
  id: string; name: string; daily: Macros; includedSlots: MobileMealSlot[]; dislikes?: string[]; hardExclusions?: string[];
  /** No field: an adult, as in every plan saved before family mode. */
  kind?: "adult" | "child";
  /** A child is sized by sex, age and activity only; height, weight and an adult estimate are never kept. */
  childEstimate?: Partial<ChildNutritionInput>;
  nutritionTargetMode?: NutritionTargetMode;
  estimate?: NutritionWizardInput;
};
export type PlanDraft = {
  id: string;
  createdAt: string;
  start: string;
  periodDays: number;
  cookEveryDays: number;
  menuStyle: MobileMenuStyle;
  kitchenEquipment: MobileKitchenEquipment[];
  mealSlots: MobileMealSlot[];
  people: PlanPerson[];
  includeDisliked?: boolean;
  /** Keep already-reviewed slots stable while one slot is regenerated. */
  pinnedSelections?: Record<string, string>;
  pinnedAssignments?: Record<string, Assignment[]>;
  /** Recipe ids to skip for a specific batch:slot replacement. */
  excludedRecipeIds?: Record<string, string[]>;
};
export type PlanBatch = { id: string; index: number; start: string; end: string; days: number };
export type Assignment = { recipeId: string; personIds: string[] };
type EngineRecipe = MobileRecipe & { solver: RecipeFamilySolverInput };
export type ShoppingEntry = { id: string; key: string; name: string; group: string; unit: string; quantity: number; checked: boolean; batchIds: string[] };
export class PlanGenerationError extends Error {
  code: "invalid_draft" | "unsupported_catalog" | "no_candidate";
  constructor(code: PlanGenerationError["code"], message: string) { super(message); this.code = code; this.name = "PlanGenerationError"; }
}
/* «Не люблю» uses the PWA's products (`dislikeOptions` in app/page.tsx) and its
   alias lookup to canonical IDs. These legacy IDs used to be compared with
   canonical ones ("salmon" with "salmon_raw"), so no option chosen in the app
   ever matched. «Острое» also catches spicy blends, measured chili and spicy
   titles (`MobileRecipe.spicy`). An unknown code is compared as a canonical ID. */
const dislikeLegacyIds: Readonly<Record<string, readonly string[]>> = {
  fish: ["salmon", "cod", "tuna"], cottage: ["cottage"], egg: ["egg"], tofu: ["tofu"], broccoli: ["broccoli"], buckwheat: ["buckwheat"],
  legumes: ["lentils", "white-beans", "red-beans", "black-beans", "green-beans", "beans", "peas", "chickpeas"], avocado: ["avocado"],
  coconut: ["coconut-milk", "coconut-oil", "coconut-flakes"], turkey: ["turkey", "turkey-mince", "turkey-slices"],
  spicy: ["jalapeno", "hot-sauce", "gochujang", "green-chiles", "buffalo-sauce", "chili-garlic-oil", "kimchi", "curry-paste", "taco-seasoning"],
  sportProtein: ["protein-powder", "casein-powder", "protein-pancake-mix"],
};
const canonicalIdByAlias = new Map(Object.values(canonicalIngredients).flatMap((ingredient) => [[ingredient.id, ingredient.id] as const, ...ingredient.aliases.map((alias) => [alias, ingredient.id] as const)]));
const dislikeGroups: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries(dislikeLegacyIds).map(([code, ids]) => [code, new Set(ids.map((id) => canonicalIdByAlias.get(id) ?? id))]),
);
export function recipeMatchesDislikes(recipe: Pick<MobileRecipe, "ingredients" | "spicy">, dislikes: readonly string[]) {
  return dislikes.some((code) =>
    (code === "spicy" && recipe.spicy) ||
    recipe.ingredients.some((ingredient) => dislikeGroups[code]?.has(ingredient.canonicalIngredientId) ?? ingredient.canonicalIngredientId === code));
}
/** The card's list is what the server checks (procedure ingredients and alcohol included); it already
 * covers every ingredient code, the union only guards hand-built catalogs. */
function recipeAllergens(recipe: MobileRecipe): string[] {
  return [...recipe.allergens, ...recipe.ingredients.flatMap((ingredient) => ingredient.allergens)];
}
const engineAllergenCodes: Readonly<Record<string, string[]>> = {
  crustaceans: ["crustaceans", "shrimp"],
  peanut: ["peanut", "peanuts"],
  treeNuts: ["treeNuts", "nuts"],
};
function engineHardExclusions(values: string[] | undefined) {
  return [...new Set((values ?? []).flatMap((value) => engineAllergenCodes[value] ?? [value]))];
}
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
function addDays(start: string, days: number) { const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && addDays(value, 0) === value; }

/** Same whole-recipe repeat policy as the web client, without a proportional fallback. */
function solveMeal(family: RecipeFamilySolverInput, input: SolveRecipeFamilyInput) {
  const direct = solveRecipeFamily(family, input);
  if (direct.viable || direct.reason === "hard_exclusion") return direct;
  const options = [];
  for (let repeat = 2; repeat <= Math.min(8, Math.floor(family.geometryLockedMax ?? 8)); repeat++) {
    const targetCalories = Math.floor(input.targetCalories / repeat);
    if (targetCalories < family.minViableCalories || targetCalories > family.maxViableCalories) continue;
    const variant = solveRecipeFamily(family, { ...input, targetCalories, targetProtein: (input.targetProtein ?? 0) / repeat, proteinFloor: (input.proteinFloor ?? 0) / repeat, targetFat: (input.targetFat ?? 0) / repeat, targetCarbs: (input.targetCarbs ?? 0) / repeat, cookingFatShare: (input.cookingFatShare ?? 1) / repeat });
    if (!variant.viable) continue;
    const nutrition = Object.fromEntries(Object.entries(variant.nutrition).map(([key, value]) => [key, round(value * repeat, 1)])) as Macros;
    if (nutrition.kcal > input.targetCalories + 0.2) continue;
    options.push({ ...variant, nutrition, amounts: Object.fromEntries(Object.entries(variant.amounts).map(([key, value]) => [key, round(value * repeat)])) });
  }
  return options.sort((a, b) => b.nutrition.kcal - a.nutrition.kcal)[0] ?? direct;
}
/* A child's norm takes 15% of energy from protein and a family dish carries
   more; the PWA's fit counts only a protein shortfall. Counting the child's
   excess as a miss steered the shared choice to leaner, poorer dishes (family
   scenarios of scripts/mobile-menu-matrix.mjs: fiber median 20.3 → 18.9 g for
   adults, 18.0 → 16.5 g for children), so for a child only a shortfall counts. */
function portionFit(person: PlanPerson, target: Macros, actual: Macros) {
  const proteinMiss = person.kind === "child" ? Math.max(0, target.protein - actual.protein) : Math.abs(actual.protein - target.protein);
  return Math.max(0, Math.round(100 - proteinMiss / Math.max(1, target.protein) * 45 - Math.abs(actual.fat - target.fat) / Math.max(1, target.fat) * 25 - Math.abs(actual.carbs - target.carbs) / Math.max(1, target.carbs) * 20));
}
function session(recipe: EngineRecipe, people: PlanPerson[], slot: MobileMealSlot, days: number) {
  const portions = people.map((person) => {
    const target = calculateMealPlanTargets(person.daily, person.includedSlots).slots[slot];
    const protein = Math.min(target.kcal / 8, target.protein);
    const input: SolveRecipeFamilyInput = { targetCalories: target.kcal, targetProtein: protein, proteinFloor: mealProteinFloor(target.kcal, protein), targetFat: target.fat, targetCarbs: target.carbs, hardExclusions: engineHardExclusions(person.hardExclusions), cookingFatShare: 1 / (people.length * days) };
    const direct = solveMeal(recipe.solver, input);
    // A child whose own portion is below the recipe's minimum takes a smaller share of the same dish.
    const variant = direct.viable || person.kind !== "child" ? direct : solveChildShare(recipe.solver, input) ?? direct;
    return { personId: person.id, target, actual: variant.nutrition, amounts: variant.amounts, viable: variant.viable };
  });
  const viable = portions.length > 0 && portions.every((portion) => portion.viable);
  const fit = viable ? Math.round(portions.reduce((sum, portion, index) => sum + portionFit(people[index], portion.target, portion.actual), 0) / portions.length) : 0;
  return { viable, portions, fit, amounts: viable ? aggregateCookingAmounts(recipe.solver.ingredients, portions.map((p) => p.amounts), days) : {} };
}
/* Fiber and fresh vegetables (2026-10-13). As in the PWA this only orders
   candidates: points per gram of fiber per 1000 kcal of the base serving and
   per gram of fresh vegetables, in full from a macro fit of 90 and fading to
   nothing at 80. The weights come from the native generator's own matrix,
   not from the PWA: here fit also penalises surplus protein, one score picks
   the dish without a top-five chooser, and the catalog has no extension pack.
   scripts/mobile-menu-matrix.mjs, 29 plans for one or two adults that the
   native catalog can complete plus 8 families with children: with the PWA
   weights (3 and 0.2) the fiber median rose 16.2 → 20.2 g a day; with 5 and
   0.4 it is 21.0 g, fresh vegetables 223 → 298 g, fit −0.9 on average and
   at most −3 in one plan, adult protein never below target, adults' fit in
   families unchanged. Weights of 6 and more add at most 0.5 g and cost fit. */
const fiberRankWeight = 5;
const fiberRankCapPerThousandKcal = 20;
const vegetableRankWeight = 0.4;
const vegetableRankCapGrams = 150;
const fiberProfiles = new WeakMap<RecipeFamilySolverInput, ReturnType<typeof familyFiberProfile>>();
function fiberRankBonus(recipe: EngineRecipe, fit: number) {
  let profile = fiberProfiles.get(recipe.solver);
  if (!profile) fiberProfiles.set(recipe.solver, profile = familyFiberProfile(recipe.solver));
  const fade = Math.min(1, Math.max(0, (fit - 80) / 10));
  return fade * (fiberRankWeight * Math.min(fiberRankCapPerThousandKcal, profile.perThousandKcal) + vegetableRankWeight * Math.min(vegetableRankCapGrams, profile.vegetableGrams));
}

/**
 * Deterministic offline core. Caller owns persistence and recipe-ID validation.
 * Nutrition, cooking-fat pooling and whole-recipe repeats use the web policies.
 * Ranking is intentionally independent of the web's top-five presentation and
 * ingredient-overlap bonus; this does not claim identical selected recipe IDs.
 * Shopping keeps distinct units separate: package-size/piece-weight estimates
 * are presentation metadata and are not inferred from unverified cooked yields.
 */
export function generateMobilePlan(bootstrap: MobileBootstrap, original: PlanDraft) {
  if (bootstrap.schemaVersion !== MOBILE_BOOTSTRAP_SCHEMA_VERSION || bootstrap.catalogSchemaVersion !== MOBILE_CATALOG_SCHEMA_VERSION) throw new PlanGenerationError("unsupported_catalog", "Обновите каталог рецептов.");
  const draft = normalizeAutomaticNutritionTargets(original) as PlanDraft;
  const fail = () => { throw new PlanGenerationError("invalid_draft", "Проверьте даты, людей, приёмы пищи и КБЖУ."); };
  const bounded = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!draft.id || draft.id.length > 100 || !validDate(draft.start) || !bounded(draft.periodDays, 14) || !bounded(draft.cookEveryDays, 14) || !bounded(draft.people.length, 4) || !bounded(draft.mealSlots.length, 5) || new Set(draft.mealSlots).size !== draft.mealSlots.length || !bootstrap.limits.menuStyles.includes(draft.menuStyle) || draft.mealSlots.some((slot) => !bootstrap.limits.mealSlots.includes(slot)) || !Array.isArray(draft.kitchenEquipment) || new Set(draft.kitchenEquipment).size !== draft.kitchenEquipment.length || draft.kitchenEquipment.some((item) => !bootstrap.limits.kitchenEquipment.includes(item))) fail();
  if (new Set(draft.people.map((p) => p.id)).size !== draft.people.length) fail();
  for (const p of draft.people) {
    // Adults 1200–5000 kcal; a child's range follows its age (personCalorieRange), and a child without an age 3–17 is invalid.
    const range = p.kind === undefined || p.kind === "adult" || p.kind === "child" ? personCalorieRange(p) : null;
    if (!range || !p.id || p.id.length > 100 || !p.name.trim() || p.name.length > 100 || !p.includedSlots.length || new Set(p.includedSlots).size !== p.includedSlots.length || p.includedSlots.some((s) => !draft.mealSlots.includes(s)) || !Object.values(p.daily).every((n) => Number.isFinite(n) && n >= 0) || p.daily.kcal < range[0] || p.daily.kcal > range[1] || Math.abs(p.daily.kcal - (p.daily.protein * 4 + p.daily.fat * 9 + p.daily.carbs * 4)) > 5) fail();
  }
  if (draft.mealSlots.some((slot) => !draft.people.some((p) => p.includedSlots.includes(slot)))) fail();
  const recipes = bootstrap.recipes.filter((r): r is EngineRecipe => "solver" in r && Boolean(r.solver));
  if (recipes.length !== bootstrap.recipes.length) throw new PlanGenerationError("unsupported_catalog", "В каталоге отсутствуют проверенные правила расчёта порций.");
  const batches: PlanBatch[] = [];
  for (let offset = 0; offset < draft.periodDays; offset += draft.cookEveryDays) {
    const days = Math.min(draft.cookEveryDays, draft.periodDays - offset);
    batches.push({ id: `batch-${batches.length}`, index: batches.length, start: addDays(draft.start, offset), end: addDays(draft.start, offset + days - 1), days });
  }
  const selections: Record<string, string> = {}, selectionAssignments: Record<string, Assignment[]> = {};
  const shopping = new Map<string, ShoppingEntry>();
  const cooking: { key: string; recipeId: string; personIds: string[]; portions: ReturnType<typeof session>["portions"]; amounts: Record<string, number>; frozenDays: number }[] = [];
  const used = new Set<string>();
  for (const batch of batches) for (const slot of draft.mealSlots) {
    const eaters = draft.people.filter((p) => p.includedSlots.includes(slot));
    const key = `${batch.id}:${slot}`;
    function candidates(people: PlanPerson[]) {
      return recipes.flatMap((recipe) => {
        if (draft.excludedRecipeIds?.[key]?.includes(recipe.id)) return [];
        const compatibleSlot = recipe.slot === slot
          || (recipe.slot.startsWith("snack") && slot.startsWith("snack"))
          || (draft.menuStyle === "simple" && [recipe.slot, slot].every((value) => value === "lunch" || value === "dinner"));
        const originalMethod = recipe.equipmentOptions.find((method) => method.id === "original");
        const supportsKitchen = Boolean(originalMethod && originalMethod.requiredEquipment.every((item) => draft.kitchenEquipment.includes(item)));
        if (!compatibleSlot || !supportsKitchen || !recipe.menuTags.includes(draft.menuStyle) || /(?:vegan|веган|keto|кето|paleo|палео)/iu.test(recipe.title) || (recipe.storage.refrigeratorDays < batch.days && (!recipe.storage.freezable || recipe.storage.freezerDays < batch.days))) return [];
        if (people.some((p) => recipeAllergens(recipe).some((a) => p.hardExclusions?.includes(a)))) return [];
        if (!draft.includeDisliked && people.some((p) => recipeMatchesDislikes(recipe, p.dislikes ?? []))) return [];
        const solved = session(recipe, people, slot, batch.days);
        if (!solved.viable) return [];
        const style = draft.menuStyle === "protein"
          ? recipe.macros.protein * 3 - recipe.macros.kcal * .025 + 50
          : draft.menuStyle === "budget"
            ? 470 - recipe.costTier.value
            : 0;
        return [{ recipe, solved, score: solved.fit * 4 + style + fiberRankBonus(recipe, solved.fit) - (used.has(recipe.id) ? 240 : 0) }];
      }).sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
    }
    const requestedGroups = draft.pinnedAssignments?.[key]
      ?? (draft.pinnedSelections?.[key]
        ? [{ recipeId: draft.pinnedSelections[key], personIds: eaters.map((person) => person.id) }]
        : undefined);
    const groups: Assignment[] = [];
    if (requestedGroups) {
      const covered = requestedGroups.flatMap((group) => group.personIds);
      const expected = eaters.map((person) => person.id);
      if (
        new Set(covered).size !== covered.length ||
        covered.length !== expected.length ||
        expected.some((personId) => !covered.includes(personId))
      ) {
        throw new PlanGenerationError("invalid_draft", `Сохранённые назначения неполны: ${key}.`);
      }
      for (const requested of requestedGroups) {
        const people = eaters.filter((person) => requested.personIds.includes(person.id));
        const pinned = candidates(people).find((candidate) => candidate.recipe.id === requested.recipeId);
        if (!pinned) {
          throw new PlanGenerationError("no_candidate", `Сохранённое блюдо больше не подходит: ${key}.`);
        }
        groups.push({ recipeId: requested.recipeId, personIds: [...requested.personIds] });
      }
    } else {
      const common = candidates(eaters)[0];
      if (common) groups.push({ recipeId: common.recipe.id, personIds: eaters.map((p) => p.id) });
      else {
      let remaining = [...eaters];
      while (remaining.length) {
        // Four eaters maximum: test every subgroup with its real cooking-fat share.
        const options = [];
        for (let mask = 1; mask < 2 ** remaining.length; mask++) {
          const group = remaining.filter((_, i) => mask & (1 << i));
          const candidate = candidates(group)[0];
          if (candidate) options.push({ ...candidate, group });
        }
        const best = options.sort((a, b) => b.group.length - a.group.length || b.score - a.score || a.recipe.id.localeCompare(b.recipe.id))[0];
        if (!best) throw new PlanGenerationError("no_candidate", `Нет подходящего блюда: ${batch.start}, ${slot}, ${remaining.map((p) => p.name).join(", ")}. Измените параметры или явно разрешите нелюбимые продукты.`);
        groups.push({ recipeId: best.recipe.id, personIds: best.group.map((p) => p.id) });
        remaining = remaining.filter((p) => !best.group.includes(p));
      }
      }
    }
    selections[key] = groups[0].recipeId;
    selectionAssignments[key] = groups;
    for (const group of groups) {
      const recipe = recipes.find((r) => r.id === group.recipeId)!;
      const solved = session(recipe, eaters.filter((p) => group.personIds.includes(p.id)), slot, batch.days);
      used.add(recipe.id);
      cooking.push({ key, recipeId: recipe.id, personIds: group.personIds, portions: solved.portions, amounts: solved.amounts, frozenDays: Math.max(0, batch.days - recipe.storage.refrigeratorDays) });
      for (const ingredient of recipe.ingredients) {
        const unit = { g: "г", ml: "мл", piece: "шт." }[ingredient.unit];
        const itemKey = `${ingredient.canonicalIngredientId}:${unit}`;
        const item = shopping.get(itemKey) ?? { id: ingredient.canonicalIngredientId, key: itemKey, name: ingredient.name, group: ingredient.group, unit, quantity: 0, checked: false, batchIds: [] };
        item.quantity += solved.amounts[ingredient.id] ?? 0;
        if (!item.batchIds.includes(batch.id)) item.batchIds.push(batch.id);
        shopping.set(itemKey, item);
      }
    }
  }
  return { id: draft.id, createdAt: draft.createdAt, start: draft.start, end: addDays(draft.start, draft.periodDays - 1), periodDays: draft.periodDays, cookEveryDays: draft.cookEveryDays, menuStyle: draft.menuStyle, kitchenEquipment: [...draft.kitchenEquipment], mealSlots: [...draft.mealSlots], people: draft.people, batches, selections, selectionAssignments, cooking, shopping: [...shopping.values()].filter((i) => i.quantity > 0).map((i) => ({ ...i, quantity: i.unit === "шт." ? Math.ceil(i.quantity) : Math.ceil(i.quantity / 10) * 10 })).sort((a, b) => a.group.localeCompare(b.group, "ru") || a.name.localeCompare(b.name, "ru")) };
}
