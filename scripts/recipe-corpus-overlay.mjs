import { readFile } from "node:fs/promises";
import { applyGoodFoodRehabilitation } from "./apply-goodfood-rehabilitation.mjs";

const datasets = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
];

async function applyMealPrepOwnerDecisions({ document }) {
  const registry = JSON.parse(
    await readFile(new URL("../data/mealprep-owner-decisions.json", import.meta.url), "utf8"),
  );
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.decisions)) {
    throw new Error("Meal Prep owner decisions registry is missing or invalid.");
  }
  const decisions = new Map(registry.decisions.map((decision) => [decision.recipeId, decision]));
  const seen = new Set();
  const candidates = document.candidates.map((candidate) => {
    const decision = decisions.get(candidate.id);
    if (!decision) return candidate;
    seen.add(candidate.id);
    const ingredients = candidate.ingredients.map((ingredient) => ({ ...ingredient }));
    const steps = candidate.paraphrasedInstructionDraft.map((step) => ({ ...step }));
    if (decision.kind === "mirin_optional_alternative") {
      const replacementIndexes = ingredients
        .map((ingredient, index) => /Mise adaptation:.*replacing mirin/iu.test(ingredient.original ?? "") ? index : -1)
        .filter((index) => index >= 0);
      if (replacementIndexes.length !== 2) {
        throw new Error(`${candidate.id}: expected two historical mirin replacement ingredients.`);
      }
      const firstIndex = replacementIndexes[0];
      ingredients.splice(firstIndex, replacementIndexes.length, {
        name: decision.sourceIngredient,
        amountMetric: String(decision.sourceAmountGrams),
        unitMetric: "g",
        original: `${decision.sourceAmountGrams} g mirin`,
        displayNameRu: decision.displayNameRu,
      });
      steps[0] = { ...steps[0], text: `${decision.instructionNoteRu} ${steps[0].text}` };
    } else if (decision.kind === "compound_ingredient_breakdown") {
      const ingredient = ingredients.find((item) => item.name === decision.sourceIngredient);
      if (!ingredient) throw new Error(`${candidate.id}: compound ingredient is missing.`);
      ingredient.displayNameRu = decision.displayNameRu;
      steps[0] = { ...steps[0], text: `${decision.instructionNoteRu} ${steps[0].text}` };
    } else {
      throw new Error(`${candidate.id}: unsupported owner decision kind ${decision.kind}.`);
    }
    return {
      ...candidate,
      ingredients,
      paraphrasedInstructionDraft: steps,
      miseAdaptation: {
        kind: decision.kind,
        sourceIngredient: decision.sourceIngredient,
        sourceAmountGrams: decision.sourceAmountGrams,
        alternative: decision.alternative,
        reviewedAt: registry.reviewedAt,
        registry: "data/mealprep-owner-decisions.json",
      },
    };
  });
  const missing = [...decisions.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Meal Prep owner decisions reference missing cards: ${missing.join(", ")}`);
  return { ...document, candidates };
}

/**
 * The imported corpus remains immutable. This loader is the single, explicit
 * place where the reviewed Good Food rehabilitation overlay is applied before
 * an audit or runtime projection sees the cards.
 */
export async function loadRecipeCorpusWithOverlays({ cwd = process.cwd() } = {}) {
  const documents = await Promise.all(
    datasets.map(async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))),
  );
  const mealPrepIndex = documents.findIndex((document) => document.source === "The Meal Prep Manual");
  if (mealPrepIndex < 0) throw new Error("Meal Prep Manual corpus document is missing.");
  documents[mealPrepIndex] = await applyMealPrepOwnerDecisions({ document: documents[mealPrepIndex] });
  const goodFoodIndex = documents.findIndex((document) => document.source === "Good Food — Meal prep ideas");
  if (goodFoodIndex < 0) throw new Error("Good Food corpus document is missing.");
  const rehabilitation = await applyGoodFoodRehabilitation({ cwd, document: documents[goodFoodIndex] });
  const rehabilitated = {
    ...rehabilitation.document,
    candidates: rehabilitation.document.candidates.map((candidate) =>
      rehabilitation.registry.recipes.some((record) => record.id === candidate.id)
        ? {
            ...candidate,
            miseRehabilitation: {
              kind: "goodfood_measured_overlay_v1",
              registry: "data/goodfood-rehabilitation.json",
              sourceNutritionPreserved: true,
            },
          }
        : candidate,
    ),
  };
  documents[goodFoodIndex] = rehabilitated;
  return {
    documents,
    rehabilitation: {
      appliedCards: rehabilitation.reports.length,
      reports: rehabilitation.reports,
    },
  };
}

export async function loadRecipeCorpusEntries(options) {
  const { documents, rehabilitation } = await loadRecipeCorpusWithOverlays(options);
  return {
    rehabilitation,
    entries: documents.flatMap((dataset) => dataset.candidates.map((candidate) => ({
      candidate,
      publisher: dataset.source,
      accessedAt: dataset.importedAt,
    }))),
  };
}
