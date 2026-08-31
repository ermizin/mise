import {
  canonicalIngredients,
  normalizeRawRecipeCandidate,
} from "../domain/recipe-engine.ts";
import { sourceAmount } from "./recipe-corpus-normalize.mjs";
import { loadMealPrepReleasePolicy } from "./mealprep-release-policy.mjs";


/**
 * Source sites round per-serving nutrition and may use a branded product that
 * differs slightly from a USDA profile.  These fixed tolerances are therefore
 * deliberately wider than display rounding, but narrow enough to expose a
 * missing oil, cheese, flour, or main carbohydrate:
 * - calories: max(50 kcal, 15% of source)
 * - protein: max(6 g, 20% of source)
 * - fat: max(5 g, 25% of source)
 * - carbs: max(8 g, 20% of source)
 *
 * Passing a tolerance only means the card can proceed past the nutrition
 * comparison.  It never overrides missing measurement or label verification.
 */
export const NUTRITION_TOLERANCE = Object.freeze({
  kcal: Object.freeze({ absolute: 50, relative: 0.15 }),
  protein: Object.freeze({ absolute: 6, relative: 0.2 }),
  fat: Object.freeze({ absolute: 5, relative: 0.25 }),
  carbs: Object.freeze({ absolute: 8, relative: 0.2 }),
});

export const NUTRITION_AUDIT_REASON = Object.freeze({
  INVALID_YIELD: "invalid_yield",
  INVALID_SOURCE_NUTRITION: "invalid_source_nutrition",
  UNRESOLVED_INGREDIENT: "unresolved_ingredient",
  REPLACEMENT_WITHOUT_DISTRIBUTION: "replacement_without_distribution",
  IGNORED_COMPONENT_NOT_CALCULABLE: "ignored_component_not_calculable",
  MISSING_INGREDIENT_AMOUNT: "missing_ingredient_amount",
  UNSUPPORTED_MEASUREMENT_UNIT: "unsupported_measurement_unit",
  ML_DENSITY_MISSING: "ml_density_missing",
  PIECE_WEIGHT_MISSING: "piece_weight_missing",
  INVALID_CANONICAL_NUTRITION: "invalid_canonical_nutrition",
  LABEL_REQUIRED: "label_required",
  FRACTIONAL_YIELD: "fractional_yield",
  DELTA_OUTSIDE_TOLERANCE: "nutrition_delta_outside_tolerance",
  DELTA_WITHIN_TOLERANCE: "nutrition_delta_within_tolerance",
  INDEPENDENT_CALCULATION_COMPLETE: "independent_calculation_complete",
});

const MACRO_KEYS = ["kcal", "protein", "fat", "carbs"];

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function reason(code, severity, detail) {
  return { code, severity, ...(detail ? { detail } : {}) };
}

function sourceNutritionFor(candidate) {
  // Rehabilitation preserves the publisher values in sourceNutrition and
  // stores independently calculated runtime macros in macros. The comparison
  // must always retain the publisher figure as the source side of the audit.
  const source = candidate.sourceNutrition ?? candidate.macros ?? {};
  return Object.fromEntries(MACRO_KEYS.map((key) => [key, Number(source[key])]));
}

function isValidNutrition(nutrition) {
  return MACRO_KEYS.every((key) => finiteNonNegative(nutrition[key])) && nutrition.kcal > 0;
}

/**
 * Converts an already-parsed source amount into grams.  A source gram amount
 * is direct mass; ml needs an explicit density, and pieces need a canonical
 * piece weight.  We intentionally do not assume water density or a generic
 * "one piece = 1 g" fallback.
 */
export function convertIngredientToGrams(measured, canonical) {
  if (!measured || !finitePositive(measured.amount)) {
    return { ok: false, code: NUTRITION_AUDIT_REASON.MISSING_INGREDIENT_AMOUNT };
  }
  if (!canonical) return { ok: false, code: NUTRITION_AUDIT_REASON.UNRESOLVED_INGREDIENT };
  const amount = Number(measured.amount);
  if (measured.unit === "g") return { ok: true, grams: amount };
  if (measured.unit === "ml") {
    if (!finitePositive(canonical.densityGPerMl)) {
      return { ok: false, code: NUTRITION_AUDIT_REASON.ML_DENSITY_MISSING };
    }
    return { ok: true, grams: amount * Number(canonical.densityGPerMl) };
  }
  if (measured.unit === "piece") {
    // A source may count an ingredient (for example cheese slices or lasagne
    // sheets) even when Mise presents it by mass. Values above the 1 g default
    // are explicit canonical piece weights and are safe for source conversion.
    if (!finitePositive(canonical.unit?.gramsPerUnit) || Number(canonical.unit.gramsPerUnit) <= 1) {
      return { ok: false, code: NUTRITION_AUDIT_REASON.PIECE_WEIGHT_MISSING };
    }
    return { ok: true, grams: amount * Number(canonical.unit.gramsPerUnit) };
  }
  return { ok: false, code: NUTRITION_AUDIT_REASON.UNSUPPORTED_MEASUREMENT_UNIT };
}

function nutritionForGrams(grams, canonical) {
  if (!isValidNutrition(canonical.nutritionPer100g)) return undefined;
  const factor = grams / 100;
  return Object.fromEntries(MACRO_KEYS.map((key) => [key, canonical.nutritionPer100g[key] * factor]));
}

function addNutrition(total, addition) {
  for (const key of MACRO_KEYS) total[key] += addition[key];
}

function toleranceFor(key, sourceValue) {
  const rule = NUTRITION_TOLERANCE[key];
  return Math.max(rule.absolute, sourceValue * rule.relative);
}

function deltaReport(calculated, source) {
  const delta = {};
  const thresholds = {};
  const outside = [];
  for (const key of MACRO_KEYS) {
    delta[key] = round(calculated[key] - source[key]);
    thresholds[key] = round(toleranceFor(key, source[key]));
    if (Math.abs(delta[key]) > thresholds[key]) outside.push(key);
  }
  return { delta, thresholds, outside };
}

function auditIngredient(sourceIngredient, mapping, policy, acceptsEditorialAverage) {
  const sourceName = String(sourceIngredient?.name ?? sourceIngredient?.id ?? "").trim();
  if (mapping.status === "unresolved") {
    return { complete: false, reason: reason(NUTRITION_AUDIT_REASON.UNRESOLVED_INGREDIENT, "blocked", { sourceName }) };
  }
  if (mapping.status === "replaced") {
    return {
      complete: false,
      reason: reason(NUTRITION_AUDIT_REASON.REPLACEMENT_WITHOUT_DISTRIBUTION, "blocked", {
        sourceName,
        replacements: mapping.replacementCanonicalIngredientIds ?? [],
      }),
    };
  }
  if (mapping.status === "ignored_noncaloric" || mapping.status === "ignored_microcomponent") {
    // The normalizer only assigns ignored statuses to water, salt, leaveners
    // and editorial micro-seasonings. Count them as zero in the independent
    // macro sum and keep an auditable note. A meaningful omitted ingredient
    // remains unresolved instead, so it still blocks the calculation.
    return {
      complete: true,
      nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      warnings: [reason(NUTRITION_AUDIT_REASON.IGNORED_COMPONENT_NOT_CALCULABLE, "info", { sourceName })],
    };
  }
  const canonical = canonicalIngredients[mapping.canonicalIngredientId];
  const measured = sourceAmount(sourceIngredient);
  const converted = convertIngredientToGrams(measured, canonical);
  if (!converted.ok) {
    return {
      complete: false,
      reason: reason(converted.code, "blocked", { sourceName, unit: measured?.unit ?? null }),
    };
  }
  const nutrition = nutritionForGrams(converted.grams, canonical);
  if (!nutrition) {
    return { complete: false, reason: reason(NUTRITION_AUDIT_REASON.INVALID_CANONICAL_NUTRITION, "blocked", { sourceName, canonicalId: canonical.id }) };
  }
  const warnings = [];
  if (canonical.reference?.dataType === "label_required") {
    const averaged = acceptsEditorialAverage && (
      policy?.labelProfiles?.canonicalIds?.has(canonical.id) ||
      acceptsEditorialAverage === "rehabilitated_goodfood" ||
      acceptsEditorialAverage === "simple_home_editorial"
    );
    warnings.push(reason(NUTRITION_AUDIT_REASON.LABEL_REQUIRED, averaged ? "info" : "review_required", { sourceName, canonicalId: canonical.id, policy: averaged ? "editorial_average_with_check_label" : null }));
  }
  return { complete: true, nutrition, warnings };
}

export function auditNutritionEntry(candidate, { publisher = "unknown", accessedAt = "unknown", policy } = {}) {
  const reasons = [];
  const isMealPrep = String(candidate.id ?? "").startsWith("tmpm-");
  const isRehabilitatedGoodFood = candidate.miseRehabilitation?.kind === "goodfood_measured_overlay_v1";
  const isMeasuredEditorial = candidate.miseEditorialAdaptation?.kind === "simple_home_measured_adaptation_v1";
  const acceptsEditorialAverage = isRehabilitatedGoodFood
    ? "rehabilitated_goodfood"
    : isMeasuredEditorial ? "simple_home_editorial" : isMealPrep;
  const sourceNutrition = sourceNutritionFor(candidate);
  const servings = Number(candidate.servings);
  if (!finitePositive(servings)) reasons.push(reason(NUTRITION_AUDIT_REASON.INVALID_YIELD, "blocked", { servings: candidate.servings ?? null }));
  else if (!Number.isInteger(servings)) reasons.push(reason(NUTRITION_AUDIT_REASON.FRACTIONAL_YIELD, isMealPrep ? "info" : "review_required", { servings }));
  if (!isValidNutrition(sourceNutrition)) reasons.push(reason(NUTRITION_AUDIT_REASON.INVALID_SOURCE_NUTRITION, "blocked"));

  const normalized = normalizeRawRecipeCandidate(candidate, { publisher, accessedAt });
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  let complete = finitePositive(servings) && isValidNutrition(sourceNutrition);
  for (const [index, ingredient] of normalized.sourceIngredients.entries()) {
    const audited = auditIngredient(ingredient, normalized.ingredientMappings[index], policy, acceptsEditorialAverage);
    if (!audited.complete) {
      complete = false;
      reasons.push(audited.reason);
      continue;
    }
    addNutrition(total, audited.nutrition);
    reasons.push(...audited.warnings);
  }

  // A result is available only if every non-ignored source ingredient was
  // mapped, converted to mass, and included in the independent total.
  const calculatedNutrition = complete
    ? Object.fromEntries(MACRO_KEYS.map((key) => [key, round(total[key] / servings)]))
    : null;
  let comparison = null;
  if (calculatedNutrition) {
    comparison = deltaReport(calculatedNutrition, sourceNutrition);
    reasons.push(comparison.outside.length
      ? reason(NUTRITION_AUDIT_REASON.DELTA_OUTSIDE_TOLERANCE, (isMealPrep || isRehabilitatedGoodFood || isMeasuredEditorial) ? "info" : "review_required", { fields: comparison.outside, ...((isMealPrep || isRehabilitatedGoodFood || isMeasuredEditorial) ? { policy: "independent_calculation_is_runtime_truth" } : {}) })
      : reason(NUTRITION_AUDIT_REASON.DELTA_WITHIN_TOLERANCE, "info"));
    if (!comparison.outside.length) reasons.push(reason(NUTRITION_AUDIT_REASON.INDEPENDENT_CALCULATION_COMPLETE, "info"));
  }

  const hasBlocked = reasons.some((item) => item.severity === "blocked");
  const hasReview = reasons.some((item) => item.severity === "review_required");
  return {
    id: String(candidate.id ?? ""),
    title: String(candidate.title ?? candidate.sourceTitle ?? candidate.id ?? ""),
    sourceUrl: String(candidate.sourceUrl ?? ""),
    servings: Number.isFinite(servings) ? servings : null,
    sourceNutrition,
    calculatedNutrition,
    comparison: comparison && {
      delta: comparison.delta,
      thresholds: comparison.thresholds,
      outside: comparison.outside,
    },
    calculationComplete: Boolean(calculatedNutrition),
    verdict: hasBlocked ? "blocked" : hasReview ? "review_required" : "ready",
    reasons,
  };
}

async function loadEntries() {
  const { loadRecipeCorpusEntries } = await import("./recipe-corpus-overlay.mjs");
  return (await loadRecipeCorpusEntries()).entries;
}

export async function auditRecipeNutritionCorpus() {
  const [entries, policy] = await Promise.all([loadEntries(), loadMealPrepReleasePolicy()]);
  const cards = entries.map(({ candidate, publisher, accessedAt }) => auditNutritionEntry(candidate, { publisher, accessedAt, policy }));
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Recipe corpus IDs must be unique.");
  const byVerdict = Object.fromEntries(["ready", "review_required", "blocked"].map((verdict) => [verdict, cards.filter((card) => card.verdict === verdict).length]));
  const byReason = Object.fromEntries(
    [...new Set(cards.flatMap((card) => card.reasons.map((item) => item.code)))].sort().map((code) => [
      code,
      cards.filter((card) => card.reasons.some((item) => item.code === code)).length,
    ]),
  );
  return {
    schemaVersion: 1,
    policy: { tolerances: NUTRITION_TOLERANCE, completeCalculationRequiredForReady: true },
    total: cards.length,
    counts: { ...byVerdict, independentlyCalculable: cards.filter((card) => card.calculationComplete).length },
    reasonCounts: byReason,
    cards,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  auditRecipeNutritionCorpus()
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
