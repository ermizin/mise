import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { hasDocumentedLocalization, loadMealPrepReleasePolicy } from "./mealprep-release-policy.mjs";
import { loadRecipeCorpusEntries } from "./recipe-corpus-overlay.mjs";

export const AUDIT_REASON = Object.freeze({
  MISSING_YIELD: "missing_yield",
  INVALID_YIELD: "invalid_yield",
  INVALID_MACROS: "invalid_macros",
  INVALID_TIME: "invalid_time",
  MISSING_IMAGE: "missing_image",
  INVALID_IMAGE: "invalid_image",
  MISSING_SOURCE: "missing_source",
  INVALID_SOURCE: "invalid_source",
  EXTREME_KCAL: "extreme_kcal",
  UNRESOLVED_INGREDIENT_MAPPING: "unresolved_ingredient_mapping",
  MISSING_INSTRUCTIONS: "missing_instructions",
  MISSING_PARAPHRASED_INSTRUCTIONS: "missing_paraphrased_instructions",
  GENERIC_PROCEDURE_PLACEHOLDER: "generic_procedure_placeholder",
  MISSING_RUSSIAN_TITLE: "missing_russian_title",
  PROCEDURE_REVIEW_REQUIRED: "procedure_review_required",
  MISSING_STORAGE_PROFILE: "missing_storage_profile",
  MISSING_PACKING_PROFILE: "missing_packing_profile",
  FRACTIONAL_SERVINGS: "fractional_servings",
  LABEL_DEPENDENT_INGREDIENT: "label_dependent_ingredient",
  NICHE_LOCALIZATION: "niche_localization",
});

function reason(code, severity, detail) {
  return { code, severity, ...(detail ? { detail } : {}) };
}

function validUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "missing";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

async function loadNormalizer() {
  const url = new URL("../domain/recipe-engine.ts", import.meta.url);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports };
  vm.runInNewContext(output, sandbox, { filename: fileURLToPath(url) });
  return sandbox.module.exports;
}

export async function loadRecipeCorpus() {
  return (await loadRecipeCorpusEntries()).entries;
}

export async function auditRecipeCorpus() {
  const [entries, engine, policy] = await Promise.all([loadRecipeCorpus(), loadNormalizer(), loadMealPrepReleasePolicy()]);
  const seen = new Set();
  const verdicts = entries.map(({ candidate, publisher, accessedAt }) => {
    const reasons = [];
    const add = (code, severity, detail) => reasons.push(reason(code, severity, detail));
    const id = String(candidate.id ?? "");
    const isMealPrep = id.startsWith("tmpm-");
    if (seen.has(id)) throw new Error(`Duplicate recipe id in corpus: ${id}`);
    seen.add(id);

    const servings = Number(candidate.servings);
    if (candidate.servings == null || candidate.servings === "") add(AUDIT_REASON.MISSING_YIELD, "blocked");
    else if (!Number.isFinite(servings) || servings <= 0) add(AUDIT_REASON.INVALID_YIELD, "blocked", { value: candidate.servings });
    else if (!Number.isInteger(servings)) add(AUDIT_REASON.FRACTIONAL_SERVINGS, isMealPrep ? "info" : "review_required", { servings });

    const macros = candidate.macros ?? candidate.sourceNutrition;
    const macroKeys = ["kcal", "protein", "fat", "carbs"];
    if (!macros || !macroKeys.every((key) => isFiniteNonNegative(Number(macros[key]))) || Number(macros.kcal) <= 0) {
      add(AUDIT_REASON.INVALID_MACROS, "blocked");
    } else if (Number(macros.kcal) < 150 || Number(macros.kcal) > 800) {
      const adaptation = isMealPrep ? policy.servingAdaptations[candidate.id] : undefined;
      add(AUDIT_REASON.EXTREME_KCAL, adaptation ? "info" : "review_required", { kcal: Number(macros.kcal), expectedRange: [150, 800], adaptation: adaptation ?? null });
    }

    const time = candidate.time ?? candidate.sourceTimes;
    const totalMinutes = Number(time?.totalMinutes);
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0 || ["prepMinutes", "cookMinutes"].some((key) => time?.[key] != null && (!Number.isFinite(Number(time[key])) || Number(time[key]) < 0))) {
      add(AUDIT_REASON.INVALID_TIME, "blocked");
    }

    const sourceState = validUrl(candidate.sourceUrl);
    if (sourceState === "missing") add(AUDIT_REASON.MISSING_SOURCE, "blocked");
    if (sourceState === "invalid") add(AUDIT_REASON.INVALID_SOURCE, "blocked", { value: candidate.sourceUrl });
    // Photos are optional catalog decoration. Source provenance is mandatory;
    // a deliberate runtime fallback handles an absent preview.

    const normalized = engine.normalizeRawRecipeCandidate(candidate, { publisher, accessedAt });
    const isRehabilitatedGoodFood = candidate.miseRehabilitation?.kind === "goodfood_measured_overlay_v1";
    const unresolved = normalized.ingredientMappings.filter((mapping) => mapping.status === "unresolved").map((mapping) => mapping.sourceName);
    if (unresolved.length) add(AUDIT_REASON.UNRESOLVED_INGREDIENT_MAPPING, "review_required", { ingredients: unresolved });

    if (!Array.isArray(candidate.instructionFacts) || candidate.instructionFacts.length === 0) add(AUDIT_REASON.MISSING_INSTRUCTIONS, "blocked");
    if (!Array.isArray(candidate.paraphrasedInstructionDraft) || candidate.paraphrasedInstructionDraft.length === 0) add(AUDIT_REASON.MISSING_PARAPHRASED_INSTRUCTIONS, "blocked");
    else if (candidate.paraphrasedInstructionDraft.some((step) => [
      /подготовьте и отмерьте ингредиенты из карточки/i,
      /готовьте до полной готовности и нужной текстуры/i,
      /соедините готовые компоненты, перемешайте до равномерности/i,
    ].some((pattern) => pattern.test(String(step?.text ?? ""))))) {
      add(AUDIT_REASON.GENERIC_PROCEDURE_PLACEHOLDER, "blocked");
    }
    if (typeof candidate.titleRu !== "string" || !/[А-Яа-яЁё]/.test(candidate.titleRu)) add(AUDIT_REASON.MISSING_RUSSIAN_TITLE, "blocked");
    if (candidate.proceduralStatus === "review_required") {
      add(AUDIT_REASON.PROCEDURE_REVIEW_REQUIRED, "blocked", { blockers: candidate.proceduralBlockers ?? [] });
    }
    if (!candidate.storage || !Number.isFinite(Number(candidate.storage.refrigeratorDays)) || Number(candidate.storage.refrigeratorDays) <= 0) {
      add(AUDIT_REASON.MISSING_STORAGE_PROFILE, "blocked");
    }
    if (!candidate.packing || typeof candidate.packing.portion !== "string" || !candidate.packing.portion.trim()) {
      add(AUDIT_REASON.MISSING_PACKING_PROFILE, "blocked");
    }

    const labelDependent = normalized.ingredientMappings
      .filter((mapping) => mapping.canonicalIngredientId && engine.canonicalIngredients[mapping.canonicalIngredientId]?.reference?.dataType === "label_required")
      .map((mapping) => mapping.sourceName);
    if (labelDependent.length) {
      const allAveraged = (isMealPrep || isRehabilitatedGoodFood) && normalized.ingredientMappings
        .filter((mapping) => mapping.canonicalIngredientId && engine.canonicalIngredients[mapping.canonicalIngredientId]?.reference?.dataType === "label_required")
        .every((mapping) => isRehabilitatedGoodFood || policy.labelProfiles.canonicalIds.has(mapping.canonicalIngredientId));
      add(AUDIT_REASON.LABEL_DEPENDENT_INGREDIENT, allAveraged ? "info" : "review_required", { ingredients: labelDependent, policy: allAveraged ? "editorial_average_with_check_label" : null });
    }

    const localization = candidate.localization ?? {};
    if (localization.excludeSuggested || localization.fit === "unfamiliar" || localization.availability === "niche") {
      const documented = (isMealPrep || isRehabilitatedGoodFood) && hasDocumentedLocalization(candidate);
      add(AUDIT_REASON.NICHE_LOCALIZATION, documented ? "info" : "review_required", {
        fit: localization.fit,
        availability: localization.availability,
        excludeSuggested: Boolean(localization.excludeSuggested),
        documented,
      });
    }

    const verdict = reasons.some((item) => item.severity === "blocked")
      ? "blocked"
      : reasons.length ? "review_required" : "ready";
    return { id, sourceUrl: candidate.sourceUrl, title: candidate.title ?? candidate.sourceTitle ?? id, verdict, reasons };
  });
  const counts = Object.fromEntries(["ready", "review_required", "blocked"].map((key) => [key, verdicts.filter((item) => item.verdict === key).length]));
  return { schemaVersion: 1, total: verdicts.length, counts, verdicts };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(`${JSON.stringify(await auditRecipeCorpus(), null, 2)}\n`);
}
