import { readFile } from "node:fs/promises";
import { applyGoodFoodRehabilitation } from "./apply-goodfood-rehabilitation.mjs";

const datasets = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
];

/**
 * The imported corpus remains immutable. This loader is the single, explicit
 * place where the reviewed Good Food rehabilitation overlay is applied before
 * an audit or runtime projection sees the cards.
 */
export async function loadRecipeCorpusWithOverlays({ cwd = process.cwd() } = {}) {
  const documents = await Promise.all(
    datasets.map(async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))),
  );
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
