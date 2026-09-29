import { readFile } from "node:fs/promises";
import { canonicalIngredients, nutritionForFamily, nutritionReachForIngredients, recipeEffortDifficulty, recipeEffortLevel, solveRecipeFamily } from "../domain/recipe-engine.ts";

/*
 * Catalog extension of 2026-09-30: Mise-authored cards that close measured
 * gaps (snacks, dishes for 4–7 day batches, breakfasts that keep) and open the
 * vegan and paleo directions. Input: data/extension-recipes.json. Every card
 * is calculated from canonical product profiles; nothing is taken on trust
 * from a source page.
 */

const reviewedAt = "2026-09-30";
const menus = ["simple", "protein", "budget", "vegan", "paleo"];
const slots = ["breakfast", "lunch", "dinner", "snack1"];
const roles = ["protein", "carb", "vegetable", "fat", "fat_cooking", "flavour_fixed", "sauce"];
const equipmentIds = ["stove", "pot", "pan", "oven", "baking_dish", "multicooker", "air_fryer", "blender", "microwave"];
const cuisines = ["russian", "georgian", "asian", "indian", "mexican", "italian", "mediterranean", "american", "european", "international"];
const shelves = {
  meat: "Мясо и птица", fish: "Рыба и морепродукты", seafood: "Рыба и морепродукты",
  egg: "Молочное", dairy: "Молочное", grain: "Крупы и макароны", legume: "Крупы и бобовые",
  vegetable: "Овощи и фрукты", fruit: "Овощи и фрукты", fat: "Масла и соусы", sauce: "Соусы и специи",
};

/** What a direction promises. A card that breaks the promise does not build. */
const dietRules = {
  vegan: {
    label: "веганское",
    forbiddenCategories: ["meat", "fish", "seafood", "egg", "dairy"],
    forbiddenAllergens: ["milk", "egg", "fish", "crustaceans", "molluscs", "shrimp"],
    forbiddenIngredients: ["honey_processed", "worcestershire_processed", "fish_sauce_processed", "oyster_sauce_processed", "dark_chocolate_processed", "pesto_processed", "mayonnaise_processed"],
  },
  paleo: {
    label: "палео",
    forbiddenCategories: ["grain", "legume", "dairy", "protein", "potato", "snack", "leavener"],
    forbiddenAllergens: ["milk", "gluten", "soy", "peanuts"],
    forbiddenIngredients: [
      "white_sugar_processed", "brown_sugar_processed", "splenda_processed", "butter_processed", "ghee_processed",
      "mayonnaise_processed", "vegetable_oil_processed", "sunflower_oil_processed", "canola_oil_processed",
      "potato_raw", "corn_cooked", "peanut_butter_processed", "peanuts_raw", "dark_chocolate_processed",
    ],
  },
};

const round = (value) => Math.round(value * 100) / 100;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Extension catalog: ${message}`);
}

function emojiFor(card) {
  if (card.slot === "breakfast") return "🥣";
  if (card.slot === "snack1") return "🍏";
  return card.menus.includes("vegan") ? "🥗" : "🍲";
}

export function projectExtensionRecipe(card) {
  requireValue(/^mise-(?:vegan|paleo|protein|simple)-[a-z0-9-]+$/.test(card.id), `${card.id}: id`);
  requireValue(Array.isArray(card.menus) && card.menus.length > 0 && card.menus.every((menu) => menus.includes(menu)) && new Set(card.menus).size === card.menus.length, `${card.id}: menus`);
  requireValue(card.menus.includes(card.id.split("-")[1]), `${card.id}: the id names a direction the card is not in`);
  requireValue(slots.includes(card.slot), `${card.id}: slot`);
  requireValue(cuisines.includes(card.cuisine), `${card.id}: cuisine`);
  requireValue(typeof card.title === "string" && card.title.length >= 6 && card.title.length <= 70, `${card.id}: title`);
  requireValue(Array.isArray(card.steps) && card.steps.length >= 3 && card.steps.length <= 6 && card.steps.every((step) => typeof step === "string" && step.length >= 30), `${card.id}: steps`);
  // Amounts are scaled per plan, so a step may name a time or a temperature but never grams of a product.
  requireValue(card.steps.every((step) => !/\d+(?:[.,]\d+)?\s*(?:г|мл|шт)(?![а-яё])/iu.test(step)), `${card.id}: a step names a fixed amount of a scaled product`);
  requireValue(card.activeMinutes > 0 && card.activeMinutes <= (card.menus.includes("simple") ? 20 : 35) && card.totalMinutes >= card.activeMinutes, `${card.id}: time`);
  requireValue(card.flavourTip?.length >= 20 && card.substitution?.length >= 20, `${card.id}: editorial notes`);
  requireValue(Array.isArray(card.equipment) && card.equipment.every((item) => equipmentIds.includes(item)) && new Set(card.equipment).size === card.equipment.length, `${card.id}: equipment`);
  requireValue(Number.isInteger(card.cookware) && card.cookware >= 1 && card.cookware <= 3, `${card.id}: cookware`);

  const used = new Set();
  const ingredients = card.ingredients.map((item, index) => {
    const canonical = canonicalIngredients[item.canonicalIngredientId];
    requireValue(canonical && !used.has(canonical.id), `${card.id}: missing or repeated product ${item.canonicalIngredientId}`);
    used.add(canonical.id);
    requireValue(Number.isFinite(item.grams) && item.grams > 0, `${card.id}: grams of ${item.name}`);
    requireValue(roles.includes(item.role), `${card.id}: role of ${item.name}`);
    const discrete = canonical.unit.structuralDiscrete;
    const base = discrete ? item.grams / canonical.unit.gramsPerUnit : item.grams;
    requireValue(!discrete || Number.isInteger(base), `${card.id}: ${item.name} must be whole units`);
    const fixed = item.role === "fat_cooking" || item.role === "flavour_fixed";
    const range = item.range;
    requireValue(Array.isArray(range) && range.length === 2 && range[0] > 0 && range[0] <= 1 && range[1] >= 1 && range[1] <= 2.5, `${card.id}: bounds of ${item.name}`);
    requireValue(!fixed || (range[0] === 1 && range[1] === 1), `${card.id}: ${item.name} is fixed and cannot have bounds`);
    // An egg is bought and cracked whole, so its bounds are whole eggs too:
    // 3 × 0.67 means "two", not a lower limit of 2.01 that rounds up to three.
    const bound = (factor) => (discrete ? Math.max(1, Math.round(base * factor)) : round(base * factor));
    return {
      sourceIngredientId: `extension-ingredient-${index + 1}`,
      canonicalIngredientId: canonical.id,
      baseAmount: round(base), unit: discrete ? "piece" : "g", role: item.role,
      minAmount: fixed ? base : bound(range[0]),
      preferredMin: fixed ? base : bound(Math.max(range[0], 0.8)),
      preferredMax: fixed ? base : bound(Math.min(range[1], 1.25)),
      maxAmount: fixed ? base : bound(range[1]),
      scalable: !fixed && range[0] !== range[1],
      scalingPriority: item.role === "carb" ? 1 : item.role === "protein" ? 2 : 3,
      substitutions: [], optional: false,
    };
  });
  requireValue(ingredients.length >= 3 && ingredients.some((item) => item.scalable), `${card.id}: at least three products, one of them adjustable`);

  for (const menu of card.menus) {
    const rule = dietRules[menu];
    if (!rule) continue;
    for (const item of ingredients) {
      const canonical = canonicalIngredients[item.canonicalIngredientId];
      requireValue(!rule.forbiddenCategories.includes(canonical.category), `${card.id}: ${canonical.canonicalName} (${canonical.category}) is not ${rule.label}`);
      requireValue(!canonical.allergens.some((allergen) => rule.forbiddenAllergens.includes(allergen)), `${card.id}: ${canonical.canonicalName} is not ${rule.label}`);
      requireValue(!rule.forbiddenIngredients.includes(canonical.id), `${card.id}: ${canonical.canonicalName} is not ${rule.label}`);
    }
  }

  const macros = nutritionForFamily({ ingredients });
  // The working range is what the solver can reach on its measuring grid, not
  // the bounds multiplied out: 12.5 g of oats is weighed as 15 g.
  const reach = nutritionReachForIngredients(ingredients);
  if (card.menus.includes("protein")) {
    const proteinShare = (macros.protein * 4) / macros.kcal;
    requireValue(proteinShare >= 0.25, `${card.id}: ${Math.round(proteinShare * 100)}% of energy from protein is not a high-protein dish`);
  }

  const procedureIngredients = (card.pantryIngredients ?? []).map((item, index) => {
    requireValue(item.amount > 0 && ["g", "ml"].includes(item.unit), `${card.id}: pantry amount`);
    const anchor = item.ratioToCanonicalIngredientId
      ? ingredients.find((candidate) => candidate.canonicalIngredientId === item.ratioToCanonicalIngredientId)
      : null;
    requireValue(!item.ratioToCanonicalIngredientId || (anchor?.unit === "g" && item.ratio > 0), `${card.id}: pantry ratio anchor`);
    return {
      ...(anchor ? { ratioToSourceIngredientId: anchor.sourceIngredientId, ratio: item.ratio } : {}),
      sourceIngredientId: `extension-pantry-${index + 1}`,
      nameRu: item.name,
      reason: item.note ?? "Отмерьте вместе с основными продуктами.",
      classification: "pantry",
      quantityPerServing: item.amount,
      unit: item.unit,
      allergens: [],
    };
  });

  const storage = card.storage;
  requireValue(storage && Number.isInteger(storage.refrigeratorDays) && storage.refrigeratorDays >= 1 && storage.refrigeratorDays <= 4, `${card.id}: refrigerator days`);
  requireValue(storage.refrigerator?.length > 20 && storage.freezer?.length > 20 && storage.thaw?.length > 20, `${card.id}: storage wording`);
  requireValue(storage.freezable ? storage.freezerDays >= 30 && storage.freezerDays <= 90 : storage.freezerDays === null, `${card.id}: freezer days`);
  requireValue(storage.freezable || (/^Не замораживать/u.test(storage.freezer) && /^Разморозка не предусмотрена/u.test(storage.thaw)), `${card.id}: a dish that is not frozen says so`);

  const effort = {
    level: recipeEffortLevel(card.activeMinutes, card.cookware),
    difficulty: recipeEffortDifficulty(card.activeMinutes, card.cookware),
    knifeActions: card.knifeActions ?? 1,
    cookware: card.cookware,
    activeActions: card.steps.length,
    activeMinutes: card.activeMinutes,
    parallelProcesses: card.cookware > 1 ? 2 : 1,
  };
  const emoji = emojiFor(card);
  const provenance = {
    kind: "generated",
    sourceTitle: "Mise",
    sourceUrl: "",
    sourceQuery: card.title,
    adaptation: card.adaptation ?? "",
    // No photograph yet: the card is drawn with the neutral fallback, and says so.
    preview: { kind: "graphic_fallback", emoji },
    imageOrigin: "none",
    editoriallyApproved: true,
  };
  const mealSlots = card.slot === "lunch" || card.slot === "dinner"
    ? ["lunch", "dinner"]
    : card.slot === "snack1" ? ["snack1", "snack2"] : [card.slot];
  const recipeFamily = {
    id: card.id, title: card.title, mealSlots, provenance,
    image: { usageStatus: "unknown", confidenceMatch: 0, manuallyApproved: false, photoType: "fallback" },
    ingredients,
    minViableCalories: Math.ceil(reach.minKcal),
    maxViableCalories: Math.floor(reach.maxKcal / 0.9),
    minimumProtein: Math.min(Math.floor(macros.protein * 0.5), Math.floor(reach.maxProtein)),
    sourceNutrition: null, comparisonNutrition: null,
    legacyEditorialNutrition: macros, miseCalculatedNutrition: macros,
    nutritionDelta: null, nutritionDeltaKcal: null,
    editorialAudit: {
      ingredientMapping: { source: "recipe_catalog", reviewedAt, sourceIngredientCount: ingredients.length, note: "Mise-authored card; every product is a canonical profile with a stated mass and reviewed bounds." },
      nutrition: { scope: "unavailable", quantitativeCoverage: "verified", comparableToMise: false, reviewedAt, note: "Calculated from canonical ingredient profiles; no source nutrition is claimed." },
    },
    miseInstructions: [
      { id: "extension-measure", text: "Отмерьте рассчитанные количества продуктов на всю готовку.", ingredientIds: ingredients.map((item) => item.sourceIngredientId), action: "measure", dependsOn: [] },
      ...card.steps.map((text, index) => ({
        id: `extension-step-${index + 1}`,
        text,
        ingredientIds: ingredients.map((item) => item.sourceIngredientId),
        dependsOn: [index ? `extension-step-${index}` : "extension-measure"],
      })),
    ],
    storage,
    freezing: { freezable: storage.freezable, storageDays: storage.refrigeratorDays },
    complexity: effort,
    activeTime: card.activeMinutes, totalTime: card.totalMinutes, equipment: card.equipment,
    localization: { fit: "familiar", availability: "common" }, substitutions: {}, reviewStatus: "pilot",
  };
  // The smallest portion is also held up by the protein floor, which the grid
  // alone does not show. The declared minimum is the first target the solver
  // really cooks, so the dish is never offered for a portion it cannot make.
  while (
    recipeFamily.minViableCalories < recipeFamily.maxViableCalories &&
    !solveRecipeFamily(recipeFamily, { targetCalories: recipeFamily.minViableCalories }).viable
  )
    recipeFamily.minViableCalories += 1;
  requireValue(recipeFamily.maxViableCalories >= recipeFamily.minViableCalories * 1.5, `${card.id}: the working range is too narrow to serve different people`);
  return {
    id: card.id, title: card.title, slot: card.slot, cuisine: card.cuisine, macros,
    equipmentOptions: [{ id: "original", label: "По рецепту", requiredEquipment: [...card.equipment] }],
    timeMinutes: card.totalMinutes,
    menuTags: [...card.menus],
    costTier: { value: card.costTier ?? 1 },
    servingMass: { grams: card.ingredients.reduce((sum, item) => sum + item.grams, 0), basis: "input_mass_not_cooked_yield" },
    shoppingIngredients: ingredients.map((item, index) => {
      const canonical = canonicalIngredients[item.canonicalIngredientId];
      return {
        sourceIngredientId: item.sourceIngredientId,
        sourceIngredientIds: [item.sourceIngredientId],
        canonicalIngredientId: item.canonicalIngredientId,
        nameRu: card.ingredients[index].name,
        quantityGrams: card.ingredients[index].grams,
        group: shelves[canonical.category] ?? "Бакалея",
        allergens: canonical.allergens,
        checkLabel: ["label_required", "brand_label"].includes(canonical.reference.dataType),
      };
    }),
    procedureIngredients,
    steps: card.steps,
    storage,
    packing: {
      portion: "После готовки взвесьте фактический выход и разложите рассчитанные порции в отдельные подписанные контейнеры.",
      separate: card.separate ?? "",
      label: `${card.title} · имя · дата готовки · приём пищи`,
    },
    localization: { fit: "familiar", availability: "common", reviewNote: card.flavourTip },
    flavourTip: card.flavourTip, substitution: card.substitution,
    effort, provenance, visualFallback: { emoji }, recipeFamily,
    viableCalories: { min: recipeFamily.minViableCalories, max: recipeFamily.maxViableCalories },
  };
}

export async function buildExtensionRecipeCatalog() {
  const source = JSON.parse(await readFile(new URL("../data/extension-recipes.json", import.meta.url), "utf8"));
  requireValue(source.schemaVersion === 1 && Array.isArray(source.recipes) && source.recipes.length > 0, "source document");
  requireValue(new Set(source.recipes.map((card) => card.id)).size === source.recipes.length, "recipe ids are unique");
  requireValue(new Set(source.recipes.map((card) => card.title.toLowerCase())).size === source.recipes.length, "recipe titles are unique");
  const recipes = source.recipes.map(projectExtensionRecipe);
  const count = (predicate) => recipes.filter(predicate).length;
  return {
    schemaVersion: 1,
    recipes,
    coverage: {
      total: recipes.length,
      byMenu: Object.fromEntries(menus.map((menu) => [menu, count((recipe) => recipe.menuTags.includes(menu))])),
      bySlot: Object.fromEntries(slots.map((slot) => [slot, count((recipe) => recipe.slot === slot)])),
      freezable: count((recipe) => recipe.storage.freezable),
      withoutPhoto: count((recipe) => recipe.provenance.preview.kind === "graphic_fallback"),
    },
    sourceEvidence: "data/extension-recipes.json",
  };
}
