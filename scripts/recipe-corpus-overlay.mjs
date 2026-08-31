import { readFile } from "node:fs/promises";
import { applyGoodFoodRehabilitation } from "./apply-goodfood-rehabilitation.mjs";

const datasets = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
  "data/simple-home-candidates.json",
];

async function assertSimpleHomeRuntimeApproval({ document }) {
  const approval = JSON.parse(
    await readFile(new URL("../data/simple-home-runtime-approval.json", import.meta.url), "utf8"),
  );
  if (
    approval.schemaVersion !== 1 ||
    approval.approvedBy !== "owner" ||
    !Array.isArray(approval.approvedRecipeIds) ||
    !Array.isArray(approval.rejectedRecipeIds)
  ) {
    throw new Error("Simple Home runtime approval registry is missing or invalid.");
  }
  const candidateIds = document.candidates.map((candidate) => candidate.id);
  const approvedIds = new Set(approval.approvedRecipeIds);
  if (approvedIds.size !== approval.approvedRecipeIds.length) {
    throw new Error("Simple Home runtime approval contains duplicate recipe ids.");
  }
  const missing = approval.approvedRecipeIds.filter((id) => !candidateIds.includes(id));
  const unapproved = candidateIds.filter((id) => !approvedIds.has(id));
  const rejected = candidateIds.filter((id) => approval.rejectedRecipeIds.includes(id));
  if (missing.length || unapproved.length || rejected.length) {
    throw new Error(
      `Simple Home runtime set does not match owner approval: missing=${missing.join(",") || "none"}; unapproved=${unapproved.join(",") || "none"}; rejected=${rejected.join(",") || "none"}`,
    );
  }
  return document;
}

async function applyGroupedReviewResolutions({ document }) {
  const registry = JSON.parse(
    await readFile(new URL("../data/simple-home-review-resolutions-v2.json", import.meta.url), "utf8"),
  );
  const resolution = registry.overnightOats?.find((item) => item.recipeId === "goodfood-banana-overnight-oats");
  if (!resolution || resolution.proteinGrams !== 20) {
    throw new Error("Grouped review resolution for Good Food banana overnight oats is missing or invalid.");
  }
  return {
    ...document,
    candidates: document.candidates.map((candidate) => {
      if (candidate.id !== resolution.recipeId) return candidate;
      const batchProteinGrams = resolution.proteinGrams * Number(candidate.servings);
      return {
        ...candidate,
        macros: {
          kcal: candidate.macros.kcal + resolution.proteinGrams * 4,
          protein: candidate.macros.protein + resolution.proteinGrams * 0.8,
          fat: candidate.macros.fat + resolution.proteinGrams * 0.06,
          carbs: candidate.macros.carbs + resolution.proteinGrams * 0.08,
        },
        ingredients: [
          ...candidate.ingredients,
          {
            id: "protein-powder",
            name: "vanilla protein powder",
            displayNameRu: "Протеиновый порошок",
            amountMetric: batchProteinGrams,
            unitMetric: "g",
            original: `${batchProteinGrams} g · grouped owner review`,
          },
        ],
        sourceIngredients: [
          ...candidate.sourceIngredients,
          {
            id: "protein-powder",
            name: "vanilla protein powder",
            displayNameRu: "Протеиновый порошок",
            amountMetric: batchProteinGrams,
            unitMetric: "g",
            original: `${batchProteinGrams} g · grouped owner review`,
          },
        ],
        paraphrasedInstructionDraft: [
          {
            ...candidate.paraphrasedInstructionDraft[0],
            text: "Разомните один банан вилкой. Смешайте его с овсянкой, корицей, кленовым сиропом, молоком, ореховой пастой и 20 г протеинового порошка на порцию до однородности.",
          },
          {
            ...candidate.paraphrasedInstructionDraft[1],
            text: "Накройте и оставьте в холодильнике на 6–8 часов. Утром перемешайте, разделите на порции, добавьте ломтики оставшегося банана, миндаль и щепотку корицы.",
          },
        ],
        miseGroupedReview: {
          kind: "simple_home_grouped_review_v2",
          registry: "data/simple-home-review-resolutions-v2.json",
          proteinPowderPerServingGrams: resolution.proteinGrams,
        },
      };
    }),
  };
}

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
    } else if (decision.kind === "recipe_flavour_restore") {
      ingredients.push(...decision.ingredients.map((ingredient) => ({ ...ingredient })));
      const ingredientIds = ingredients.map((_, index) => `source-ingredient-${index + 1}`);
      for (const step of steps) step.ingredientIds = ingredientIds;
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
  documents[goodFoodIndex] = await applyGroupedReviewResolutions({ document: rehabilitated });
  const simpleHomeIndex = documents.findIndex((document) => document.source === "Mise — Простые и домашние (owner-reviewed adaptations)");
  if (simpleHomeIndex < 0) throw new Error("Simple Home corpus document is missing.");
  documents[simpleHomeIndex] = await assertSimpleHomeRuntimeApproval({ document: documents[simpleHomeIndex] });
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
