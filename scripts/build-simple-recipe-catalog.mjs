import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalIngredients, nutritionForFamily, recipeEffortDifficulty, recipeEffortLevel } from "../domain/recipe-engine.ts";

const date = "2026-09-05";
const groups = { meat: "Мясо и птица", seafood: "Рыба", egg: "Молочное", dairy: "Молочное", grain: "Крупы и макароны", legume: "Крупы и бобовые", vegetable: "Овощи и фрукты", fruit: "Овощи и фрукты", fat: "Масла и соусы" };
const round = (n) => Math.round(n * 100) / 100;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Simple catalog: ${message}`);
}

export function projectSimpleRecipe(card, media) {
  requireValue(/^simple-(?:generated|parsed)-[a-z0-9-]+$/.test(card.id), `${card.id}: id`);
  requireValue(["generated", "parsed"].includes(card.origin), `${card.id}: origin`);
  requireValue(["breakfast", "lunch", "dinner", "snack1"].includes(card.slot), `${card.id}: slot`);
  requireValue(card.steps.length >= 3 && card.steps.length <= 5, `${card.id}: steps`);
  requireValue(card.activeMinutes > 0 && card.activeMinutes <= 20 && card.totalMinutes >= card.activeMinutes, `${card.id}: time`);
  requireValue(card.cuisine && card.flavourTip && card.substitution, `${card.id}: editorial metadata`);
  const used = new Set();
  const ingredients = card.ingredients.map((item, index) => {
    const canonical = canonicalIngredients[item.canonicalIngredientId];
    requireValue(canonical && !used.has(canonical.id), `${card.id}: missing/duplicate canonical ${item.canonicalIngredientId}`);
    used.add(canonical.id);
    requireValue(item.grams > 0 && Number.isFinite(item.grams), `${card.id}: invalid grams`);
    requireValue(item.canonicalIngredientId !== "rice_cooked_cooked", `${card.id}: dry rice required`);
    requireValue(["protein", "carb", "vegetable", "fat", "fat_cooking", "flavour_fixed", "sauce"].includes(item.role), `${card.id}: role for ${item.name}`);
    const discrete = canonical.unit.structuralDiscrete;
    const base = discrete ? item.grams / canonical.unit.gramsPerUnit : item.grams;
    requireValue(!discrete || Number.isInteger(base), `${card.id}: whole structural unit`);
    const range = item.range;
    requireValue(Array.isArray(range) && range.length === 2 && range[0] > 0 && range[0] <= 1 && range[1] >= 1, `${card.id}: reviewed bounds required`);
    const fixed = item.role === "fat_cooking" || item.role === "flavour_fixed";
    return {
      sourceIngredientId: `simple-ingredient-${index + 1}`,
      canonicalIngredientId: canonical.id,
      baseAmount: round(base), unit: discrete ? "piece" : "g", role: item.role,
      minAmount: fixed ? base : round(base * range[0]),
      preferredMin: fixed ? base : round(base * Math.max(range[0], 0.8)),
      preferredMax: fixed ? base : round(base * Math.min(range[1], 1.25)),
      maxAmount: fixed ? base : round(base * range[1]),
      scalable: !fixed && range[0] !== range[1], scalingPriority: item.role === "carb" ? 1 : item.role === "protein" ? 2 : 3,
      substitutions: [], optional: false,
    };
  });
  const macros = nutritionForFamily({ ingredients });
  const minimum = nutritionForFamily({ ingredients }, Object.fromEntries(ingredients.map(i => [i.sourceIngredientId, i.minAmount])));
  const maximum = nutritionForFamily({ ingredients }, Object.fromEntries(ingredients.map(i => [i.sourceIngredientId, i.maxAmount])));
  const procedureIngredients = (card.pantryIngredients ?? []).map((item, index) => {
    requireValue(item.amount > 0 && ["g", "ml"].includes(item.unit), `${card.id}: pantry amount`);
    const anchor = item.ratioToCanonicalIngredientId ? ingredients.find(i => i.canonicalIngredientId === item.ratioToCanonicalIngredientId) : null;
    requireValue(!item.ratioToCanonicalIngredientId || (anchor?.unit === "g" && item.ratio > 0), `${card.id}: pantry ratio anchor`);
    return { ...(anchor ? { ratioToSourceIngredientId: anchor.sourceIngredientId, ratio: item.ratio } : {}), sourceIngredientId: `simple-pantry-${index + 1}`, nameRu: item.name, reason: item.note ?? "Отмерьте вместе с основными продуктами.", classification: "pantry", quantityPerServing: item.amount, unit: item.unit, allergens: [] };
  });
  const storage = card.storage;
  requireValue(storage && storage.refrigeratorDays > 0 && storage.refrigeratorDays <= 3 && storage.refrigerator && storage.freezer && storage.thaw, `${card.id}: storage`);
  const effort = { level: recipeEffortLevel(card.activeMinutes, card.cookware), difficulty: recipeEffortDifficulty(card.activeMinutes, card.cookware), knifeActions: card.knifeActions ?? 1, cookware: card.cookware, activeActions: card.steps.length, activeMinutes: card.activeMinutes, parallelProcesses: card.cookware > 1 ? 2 : 1 };
  const image = media?.localPath;
  requireValue(image, `${card.id}: image required`);
  requireValue(media.origin === (card.origin === "generated" ? "generated" : "source") && media.rightsStatus, `${card.id}: photo provenance and rights decision required`);
  requireValue(card.origin !== "parsed" || /^https:\/\//.test(card.sourceUrl), `${card.id}: source URL required`);
  const provenance = {
    kind: card.origin,
    sourceTitle: card.origin === "parsed" ? card.sourceTitle : "Mise",
    sourceUrl: card.origin === "parsed" ? card.sourceUrl : "",
    sourceQuery: card.title,
    adaptation: card.adaptation ?? "",
    preview: { kind: card.origin === "generated" ? "generated_preview" : "source_preview", imageUrl: image },
    imageOrigin: card.origin === "generated" ? "generated" : "source",
    editoriallyApproved: true,
  };
  const recipeFamily = {
    id: card.id, title: card.title,
    mealSlots: card.slot === "lunch" || card.slot === "dinner" ? ["lunch", "dinner"] : card.slot === "snack1" ? ["snack1", "snack2"] : [card.slot],
    provenance, image: { imageUrl: image, source: provenance.sourceTitle, sourceUrl: provenance.sourceUrl, usageStatus: card.origin === "generated" ? "owned" : "reference_only", confidenceMatch: 1, manuallyApproved: false, photoType: card.origin === "generated" ? "generated" : "source" },
    ingredients, minViableCalories: Math.floor(minimum.kcal), maxViableCalories: Math.floor(maximum.kcal / 0.9),
    minimumProtein: Math.floor(macros.protein * 0.5),
    sourceNutrition: null, comparisonNutrition: null, legacyEditorialNutrition: macros, miseCalculatedNutrition: macros, nutritionDelta: null, nutritionDeltaKcal: null,
    editorialAudit: {
      ingredientMapping: { source: "recipe_catalog", reviewedAt: date, sourceIngredientCount: ingredients.length, note: "Measured Mise adaptation; original source facts retained in simple-recipes.json. Canonical profiles and bounds reviewed separately." },
      nutrition: { scope: "unavailable", quantitativeCoverage: "verified", comparableToMise: false, reviewedAt: date, note: "Independently calculated from canonical ingredient profiles; source macros are retained as evidence, not claimed as adaptation macros." },
    },
    miseInstructions: [
      { id: "simple-measure", text: "Отмерьте рассчитанные количества продуктов на всю готовку.", ingredientIds: ingredients.map(i => i.sourceIngredientId), action: "measure", dependsOn: [] },
      ...card.steps.map((text, index) => ({ id: `simple-step-${index + 1}`, text, ingredientIds: ingredients.map(i => i.sourceIngredientId), dependsOn: [index ? `simple-step-${index}` : "simple-measure"] })),
    ],
    storage, freezing: { freezable: storage.freezable, storageDays: storage.refrigeratorDays }, complexity: effort,
    activeTime: card.activeMinutes, totalTime: card.totalMinutes, equipment: card.equipment,
    localization: { fit: "familiar", availability: "common" }, substitutions: {}, reviewStatus: "pilot",
  };
  return {
    id: card.id, title: card.title, slot: card.slot, cuisine: card.cuisine, macros,
    timeMinutes: card.totalMinutes, menuTags: ["simple"], costTier: { value: 1 },
    servingMass: { grams: card.ingredients.reduce((sum, item) => sum + item.grams, 0), basis: "input_mass_not_cooked_yield" },
    shoppingIngredients: ingredients.map((item, index) => ({ sourceIngredientId: item.sourceIngredientId, sourceIngredientIds: [item.sourceIngredientId], canonicalIngredientId: item.canonicalIngredientId, nameRu: card.ingredients[index].name, quantityGrams: card.ingredients[index].grams, group: groups[canonicalIngredients[item.canonicalIngredientId].category] ?? "Бакалея", allergens: canonicalIngredients[item.canonicalIngredientId].allergens, checkLabel: ["label_required", "brand_label"].includes(canonicalIngredients[item.canonicalIngredientId].reference.dataType) })),
    procedureIngredients, steps: card.steps, storage,
    packing: { portion: "После готовки взвесьте фактический выход и разложите рассчитанные порции в отдельные подписанные контейнеры.", separate: card.separate ?? "", label: `${card.title} · имя · дата готовки · приём пищи` },
    localization: { fit: "familiar", availability: "common", reviewNote: card.flavourTip },
    flavourTip: card.flavourTip, substitution: card.substitution,
    effort, provenance, visualFallback: { emoji: card.slot === "breakfast" ? "🍳" : card.slot === "snack1" ? "🥣" : "🍲" }, recipeFamily,
  };
}

export async function buildSimpleRecipeCatalog() {
  const source = JSON.parse(await readFile(new URL("../data/simple-recipes.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../data/simple-recipe-images.json", import.meta.url), "utf8"));
  requireValue(source.recipes.length === 50 && new Set(source.recipes.map(r => r.id)).size === 50, "exactly 50 unique recipes required");
  for (const origin of ["generated", "parsed"]) requireValue(source.recipes.filter(r => r.origin === origin).length === 25, `25 ${origin} required`);
  const images = new Map();
  for (const item of manifest.images) {
    requireValue(/^\/recipe-images\/simple-[a-z0-9-]+\.(?:png|webp|jpg)$/.test(item.localPath), `${item.id}: local image path`);
    const bytes = await readFile(new URL(`../public${item.localPath}`, import.meta.url));
    requireValue(bytes.length === item.bytes && createHash("sha256").update(bytes).digest("hex") === item.sha256, `${item.id}: media checksum`);
    requireValue(!images.has(item.id), `${item.id}: duplicate media`);
    images.set(item.id, item);
  }
  requireValue(images.size === 50, "50 verified images required");
  const recipes = source.recipes.map(card => projectSimpleRecipe(card, images.get(card.id)));
  return { schemaVersion: 1, recipes, coverage: { total: 50, generated: 25, parsed: 25 }, sourceEvidence: "data/simple-recipes.json", mediaEvidence: "data/simple-recipe-images.json" };
}
