import { normalizeRawRecipeCandidate } from "../domain/recipe-engine.ts";

const fractionValues = new Map([
  ["¼", 0.25], ["½", 0.5], ["¾", 0.75], ["⅓", 1 / 3], ["⅔", 2 / 3],
  ["⅛", 0.125], ["⅜", 0.375], ["⅝", 0.625], ["⅞", 0.875],
]);

function numeric(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const source = String(value ?? "").trim();
  if (!source) return undefined;
  const mixed = source.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = source.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  let total = 0;
  let remaining = source;
  for (const [glyph, amount] of fractionValues) {
    if (remaining.includes(glyph)) {
      total += amount;
      remaining = remaining.replaceAll(glyph, "");
    }
  }
  const whole = remaining.match(/\d+(?:[.,]\d+)?/)?.[0];
  if (whole) total += Number(whole.replace(",", "."));
  return total > 0 ? total : undefined;
}

function metricAmount(original) {
  const text = String(original ?? "").replaceAll(" ", " ");
  const matches = [...text.matchAll(/([\d\s.,/¼½¾⅓⅔⅛⅜⅝⅞]+)\s*(kg|g|ml|litres?|liters?|l|lbs?|pounds?|oz|ounces?|pints?)\b/gi)];
  if (!matches.length) return undefined;
  const preferred = matches.find((match) => /[()]/.test(text.slice(Math.max(0, match.index - 2), (match.index ?? 0) + match[0].length + 2))) ?? matches.at(-1);
  const value = numeric(preferred[1]);
  if (!value) return undefined;
  const unit = preferred[2].toLowerCase();
  if (unit === "kg") return { amount: value * 1000, unit: "g", status: "exact_metric" };
  if (unit === "l" || unit.startsWith("lit")) return { amount: value * 1000, unit: "ml", status: "exact_metric" };
  if (/^(?:lb|lbs|pound|pounds)$/.test(unit)) return { amount: value * 453.59237, unit: "g", status: "standard_imperial" };
  if (/^(?:oz|ounce|ounces)$/.test(unit)) return { amount: value * 28.3495, unit: "g", status: "standard_household" };
  if (/^pints?$/.test(unit)) return { amount: value * 568.261, unit: "ml", status: "standard_imperial" };
  return { amount: value, unit, status: "exact_metric" };
}

function householdAmount(original) {
  const text = String(original ?? "").replaceAll(" ", " ").trim();
  const leading = text.match(/^([\d\s./¼½¾⅓⅔⅛⅜⅝⅞-]+)/)?.[1];
  const amount = numeric(leading);
  if (!amount) return undefined;
  // These are fixed kitchen-standard conversions, not a guessed serving size.
  // Volume still remains volume: the nutrition audit must require a density
  // before converting ml to grams for a particular ingredient.
  if (/(?:tbsp|tablespoons?)\b/i.test(text)) return { amount: amount * 15, unit: "ml", status: "standard_household" };
  if (/(?:tsp|teaspoons?)\b/i.test(text)) return { amount: amount * 5, unit: "ml", status: "standard_household" };
  if (/(?:cups?)\b/i.test(text)) return { amount: amount * 240, unit: "ml", status: "standard_household" };
  if (/(?:oz|ounces?)\b/i.test(text)) return { amount: amount * 28.3495, unit: "g", status: "standard_household" };
  return { amount, unit: "piece", status: "count" };
}

const averagePortionGrams = {
  herbs: { handful: 15, large: 30, pack: 30 },
  spinach: { handful: 50, large: 100, pack: 200 },
  rocket: { handful: 30, large: 60, pack: 60 },
  cheese: { handful: 30, large: 50, pack: 100 },
  corn: { handful: 100, large: 200, pack: 200 },
  peas: { handful: 75, large: 150, pack: 300 },
  peanuts: { handful: 30, large: 50, pack: 100 },
};

function averageAmount(ingredient) {
  const original = String(ingredient.original ?? "").replaceAll(" ", " ").trim();
  const name = String(ingredient.name ?? "").toLowerCase();
  const text = original.toLowerCase();
  const standard = (amount, unit) => ({ amount, unit, status: "standard_average" });

  if (/\bthumb-sized piece (?:of )?ginger\b/.test(text)) return standard(25, "g");
  if (/\blarge knob of butter\b/.test(text)) return standard(25, "g");
  if (/\bknob (?:of )?butter\b/.test(text)) return standard(15, "g");
  if (/\bgood squeeze (?:of )?lemon juice\b/.test(text)) return standard(15, "ml");
  if (/\bsqueeze (?:of )?lemon juice\b/.test(text)) return standard(10, "ml");
  if (/\bsplash (?:of )?milk\b/.test(text)) return standard(30, "ml");
  if (/\bdrop (?:of )?(?:olive )?oil\b/.test(text)) return standard(5, "ml");
  if (/\bjuice of 2 lemons\b/.test(text)) return standard(60, "ml");
  if (/\bjuice (?:of )?1(?:½|\.5|\s+1\/2)?\s*-\s*2 lemons?\b/.test(text)) return standard(50, "ml");
  if (/\blarge glass (?:of )?(?:red |white )?wine\b/.test(text)) return standard(250, "ml");
  if (/\bflour for dusting\b/.test(text)) return standard(30, "g");
  if (/\b(?:olive |vegetable |rapeseed |sunflower )?oil for frying\b/.test(text)) return standard(30, "ml");
  if (/\b(?:olive |vegetable |rapeseed |sunflower )?oil (?:for )?drizzl(?:e|ing)\b|\bdrizzle of (?:olive )?oil\b/.test(text)) return standard(15, "ml");
  if (/\bketchup(?:,)? optional\b/.test(text)) return standard(40, "g");

  // A source line such as "rice, naan and lime" is not one ingredient. Do
  // not turn it into a guessed serving merely because one word looks familiar.
  const unparenthesized = text.replace(/\([^)]*\)/g, "");
  if (/\b(?:and|or)\b/.test(unparenthesized)) return undefined;
  const portion = text.match(/\b(?:(small|big|large)\s+pack|(?:(big|large)\s+)?handful)\b/);
  if (!portion) return undefined;
  const product = [
    ["herbs", /\b(?:herbs?|coriander|parsley|mint|basil|dill|chives)\b/],
    ["spinach", /\bspinach\b/],
    ["rocket", /\brocket\b/],
    ["cheese", /\b(?:cheese|cheddar|parmesan|feta)\b/],
    ["corn", /\b(?:sweetcorn|corn)\b/],
    ["peas", /\bpeas?\b/],
    ["peanuts", /\bpeanuts?\b/],
  ].find(([, pattern]) => pattern.test(name));
  if (!product) return undefined;
  const size = portion[1] ? "pack" : portion[2] ? "large" : "handful";
  return standard(averagePortionGrams[product[0]][size], "g");
}

export function sourceAmount(ingredient) {
  const metric = numeric(ingredient.amountMetric);
  if (metric && /^(?:g|kg|ml|l)$/i.test(String(ingredient.unitMetric ?? ""))) {
    const unit = String(ingredient.unitMetric).toLowerCase();
    if (unit === "kg") return { amount: metric * 1000, unit: "g", status: "exact_metric" };
    if (unit === "l") return { amount: metric * 1000, unit: "ml", status: "exact_metric" };
    return { amount: metric, unit, status: "exact_metric" };
  }
  return metricAmount(ingredient.original) ?? householdAmount(ingredient.original) ?? averageAmount(ingredient);
}

function perServingIngredient(source, mapping, servings) {
  const measured = sourceAmount(source);
  return {
    sourceName: String(source.name ?? "").trim(),
    original: String(source.original ?? "").trim(),
    canonicalIngredientId: mapping.canonicalIngredientId,
    replacementCanonicalIngredientIds: mapping.replacementCanonicalIngredientIds ?? [],
    mappingStatus: mapping.status,
    mappingReason: mapping.reason,
    amount: measured?.amount,
    unit: measured?.unit,
    amountStatus: measured?.status ?? "missing",
    quantityPerServing: measured && servings > 0 ? measured.amount / servings : undefined,
  };
}

function reasonsFor(card) {
  const reasons = [];
  if (!Number.isFinite(card.servings) || card.servings <= 0) reasons.push("invalid_servings");
  if (!Number.isInteger(card.servings)) reasons.push("fractional_source_yield");
  if (!card.sourceUrl) reasons.push("missing_source_url");
  if (!card.imageUrl) reasons.push("missing_source_image");
  if (!Number.isFinite(card.totalTime) || card.totalTime <= 0) reasons.push("invalid_total_time");
  if (Object.values(card.sourceNutrition).some((value) => !Number.isFinite(value))) reasons.push("invalid_source_nutrition");
  if (card.sourceNutrition.kcal < 120 || card.sourceNutrition.kcal > 900) reasons.push("extreme_source_calories");
  if (card.ingredients.some((item) => item.mappingStatus === "unresolved")) reasons.push("unresolved_ingredient");
  if (card.ingredients.some((item) => item.mappingStatus !== "ignored" && item.amountStatus === "missing")) reasons.push("missing_ingredient_amount");
  if (!card.instructionFacts.length && !card.paraphrasedInstructionDraft.length) reasons.push("missing_instruction_facts");
  if (!card.paraphrasedInstructionDraft.length) reasons.push("missing_russian_instructions");
  if (card.localization.excludeSuggested) reasons.push("niche_localization");
  return [...new Set(reasons)];
}

export function normalizeCorpusDataset(dataset) {
  return dataset.candidates.map((candidate) => {
    const draft = normalizeRawRecipeCandidate(candidate, {
      publisher: dataset.source,
      accessedAt: dataset.importedAt,
    });
    const servings = Number(candidate.servings);
    const card = {
      id: candidate.id,
      publisher: dataset.source,
      sourceTitle: draft.sourceTitle,
      sourceUrl: draft.sourceUrl,
      imageUrl: draft.imageUrl,
      sourceQuery: String(candidate.sourceQuery ?? ""),
      slot: String(candidate.slot ?? ""),
      course: String(candidate.course ?? ""),
      servings,
      totalTime: Number(candidate.time?.totalMinutes),
      sourceNutrition: draft.sourceNutrition,
      localization: candidate.localization ?? {},
      ingredients: draft.sourceIngredients.map((ingredient, index) =>
        perServingIngredient(ingredient, draft.ingredientMappings[index], servings),
      ),
      instructionFacts: draft.instructionFacts,
      paraphrasedInstructionDraft: draft.paraphrasedInstructionDraft,
      legacyEditorialStatus: draft.editorial.legacyStatus,
    };
    const reasons = reasonsFor(card);
    const blockedReasons = new Set([
      "invalid_servings", "missing_source_url", "missing_source_image", "invalid_total_time",
      "invalid_source_nutrition", "unresolved_ingredient", "missing_ingredient_amount",
      "missing_instruction_facts", "missing_russian_instructions",
    ]);
    return {
      ...card,
      verdict: reasons.some((reason) => blockedReasons.has(reason)) ? "blocked" : reasons.length ? "review_required" : "ready",
      reasons,
    };
  });
}

export function normalizeRecipeCorpus(datasets) {
  const cards = datasets.flatMap(normalizeCorpusDataset);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Recipe corpus IDs must be unique.");
  return cards;
}
