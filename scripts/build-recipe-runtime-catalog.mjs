import { recipeEquipmentFor, equipmentCoverage } from "./recipe-equipment.mjs";
import { auditRecipeRelease } from "./audit-recipe-release.mjs";
import { sourceAmount } from "./recipe-corpus-normalize.mjs";
import {
  canonicalIngredients,
  deriveRecipeFamilyFromAuditedCandidate,
  normalizeRawRecipeCandidate,
  parallelRecipeProcesses,
  recipeEffortDifficulty,
  recipeEffortLevel,
  recipeStepsFromInstructions,
} from "../domain/recipe-engine.ts";
import { loadRecipeCorpusEntries } from "./recipe-corpus-overlay.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const allowedSlots = new Set(["breakfast", "lunch", "dinner", "snack1", "snack2"]);
const allowedTags = new Set(["protein", "budget"]);
const fallbackEmoji = ["🍲", "🥗", "🍛", "🥘", "🍝", "🥙", "🍳", "🥣", "🥪", "🍚"];

const categoryGroups = {
  meat: "Мясо и птица",
  seafood: "Рыба и морепродукты",
  vegetable: "Овощи и фрукты",
  fruit: "Овощи и фрукты",
  grain: "Крупы и макароны",
  legume: "Крупы и бобовые",
  dairy: "Молочное",
  egg: "Молочное",
  sauce: "Соусы и специи",
  sweetener: "Бакалея",
  fat: "Масла и соусы",
};

const pantryNameRu = [
  [/garlic powder/i, "Сушёный чеснок"],
  [/onion powder/i, "Сушёный лук"],
  [/baking powder/i, "Разрыхлитель"],
  [/baking soda/i, "Пищевая сода"],
  [/smoked paprika|sweet smoked paprika/i, "Копчёная паприка"],
  [/paprika/i, "Паприка"],
  [/gochugaru|chilli|chili|cayenne|red pepper flakes|jalape(?:ñ|n)o/i, "Острый перец"],
  [/cumin/i, "Кумин"],
  [/oregano/i, "Орегано"],
  [/cinnamon/i, "Корица"],
  [/coriander/i, "Кориандр"],
  [/ginger/i, "Имбирь"],
  [/turmeric/i, "Куркума"],
  [/vanilla/i, "Ваниль"],
  [/bay lea(?:f|ves)/i, "Лавровый лист"],
  [/sage/i, "Шалфей"],
  [/basil/i, "Базилик"],
  [/parsley/i, "Петрушка"],
  [/dill/i, "Укроп"],
  [/mint/i, "Мята"],
  [/thyme/i, "Тимьян"],
  [/rosemary/i, "Розмарин"],
  [/cardamom/i, "Кардамон"],
  [/nutmeg/i, "Мускатный орех"],
  [/lemon zest|zest(?: of)?\s*(?:1\s*)?lemon/i, "Цедра лимона"],
  [/orange zest/i, "Цедра апельсина"],
  [/dill pickle/i, "Маринованные огурцы"],
  [/garam masala|ras el hanout|sumac|fenugreek|fennel|curry powder|italian seasoning|pumpkin pie spice|mixed herbs|marjoram/i, "Смесь специй по рецепту"],
  [/msg/i, "Глутамат натрия"],
  [/tartlet tins/i, "Формочки для тарталеток"],
  [/saffron/i, "Шафран"],
  [/garlic granules/i, "Гранулированный чеснок"],
  [/milk or beaten egg/i, "Молоко или яйцо для смазывания"],
  [/oil spray/i, "Кулинарный спрей"],
  [/salt/i, "Соль"],
  [/pepper/i, "Перец"],
  [/water/i, "Вода"],
  [/cooking spray/i, "Кулинарный спрей"],
  [/garnish/i, "Для подачи"],
  [/seasoning|spice/i, "Приправа по вкусу"],
  [/herbs?/i, "Зелень по вкусу"],
];

function round(value, precision = 1) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function emojiFor(id) {
  return fallbackEmoji[stableHash(id) % fallbackEmoji.length];
}

function groupFor(canonical) {
  return categoryGroups[canonical.category] ?? "Бакалея";
}

function russianPantryName(sourceName) {
  const entry = pantryNameRu.find(([pattern]) => pattern.test(sourceName));
  return entry?.[1] ?? "Дополнение по рецепту";
}

function procedureAllergens(sourceName) {
  const normalized = sourceName.toLowerCase();
  const allergens = [];
  if (/\bmilk\b/.test(normalized)) allergens.push("milk");
  if (/\begg\b/.test(normalized)) allergens.push("egg");
  if (/\b(?:peanut|groundnut)\b/.test(normalized)) allergens.push("peanuts");
  if (/\b(?:almond|walnut|cashew|hazelnut|pistachio|nuts?)\b/.test(normalized)) allergens.push("nuts");
  if (/\bsesame\b/.test(normalized)) allergens.push("sesame");
  if (/\bsoy\b/.test(normalized)) allergens.push("soy");
  return [...new Set(allergens)];
}

function optionalServingSourceIngredient(sourceIngredient) {
  return /\b(?:optional|for garnish|to garnish|to serve|for serving|to finish)\b/i.test(
    String(sourceIngredient?.original ?? sourceIngredient?.name ?? ""),
  );
}

function procedureMeasurement(sourceIngredient, servings) {
  const measured = sourceAmount(sourceIngredient);
  if (!measured || !hasPositive(measured.amount) || !hasPositive(servings))
    return {};
  return {
    quantityPerServing: round(measured.amount / servings, 4),
    unit: measured.unit,
    amountStatus: measured.status,
  };
}

function nonRawRiceCanonicalId(value) {
  return /^rice(?:_|-)cooked(?:_|-|$)/iu.test(String(value ?? ""));
}

function hasPositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function hasNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function instructionEndMinutes(instructions) {
  return instructions.reduce(
    (latest, step) => Math.max(latest, Number(step.at) + Number(step.minutes)),
    0,
  );
}

function aggregateShoppingIngredients(sourceRows) {
  const byCanonicalId = new Map();
  for (const row of sourceRows) {
    const sourceAudit = {
      sourceIngredientIndex: row.sourceIngredientIndex,
      sourceIngredientId: row.sourceIngredientId,
      nameRu: row.nameRu,
      quantityGrams: row.quantityGrams,
      sourceMeasurement: row.sourceMeasurement,
      massStatus: row.massStatus,
      ...(row.measurementNormalization
        ? { measurementNormalization: row.measurementNormalization }
        : {}),
      ...(row.averagePieceWeightGrams !== undefined
        ? { averagePieceWeightGrams: row.averagePieceWeightGrams }
        : {}),
      ...(row.pieceEstimate !== undefined
        ? { pieceEstimate: row.pieceEstimate }
        : {}),
    };
    const existing = byCanonicalId.get(row.canonicalIngredientId);
    if (existing) {
      existing.quantityGrams = round(existing.quantityGrams + row.quantityGrams);
      existing.sourceIngredientIds.push(row.sourceIngredientId);
      existing.sourceIngredientIndexes.push(row.sourceIngredientIndex);
      existing.sourceAudit.push(sourceAudit);
      existing.nameRu = [...new Set(existing.sourceAudit.map((source) => source.nameRu))].join(" + ");
      existing.allergens = [...new Set([...existing.allergens, ...row.allergens])];
      existing.checkLabel ||= row.checkLabel;
      continue;
    }
    byCanonicalId.set(row.canonicalIngredientId, {
      ...row,
      // The first source remains available to older consumers. The arrays and
      // audit preserve every source row contributing to this canonical total.
      sourceIngredientIds: [row.sourceIngredientId],
      sourceIngredientIndexes: [row.sourceIngredientIndex],
      sourceAudit: [sourceAudit],
    });
  }
  return [...byCanonicalId.values()];
}

function sourceMass(ingredient, canonical) {
  const measured = sourceAmount(ingredient);
  if (!measured || !hasPositive(measured.amount)) return null;
  if (measured.unit === "g") {
    return { grams: round(measured.amount), sourceUnit: "g", sourceAmount: measured.amount, estimated: false };
  }
  if (measured.unit === "piece") {
    if (!hasPositive(canonical.unit.gramsPerUnit)) return null;
    return {
      grams: round(measured.amount * canonical.unit.gramsPerUnit),
      sourceUnit: "piece",
      sourceAmount: measured.amount,
      estimated: true,
    };
  }
  if (measured.unit === "ml") {
    const density = canonical.densityGPerMl ?? 1;
    return {
      grams: round(measured.amount * density),
      sourceUnit: "ml",
      sourceAmount: measured.amount,
      estimated: canonical.densityGPerMl === undefined,
    };
  }
  return null;
}

function retainedMass(grams, canonical) {
  // This is deliberately an estimate, never a claimed cooked yield. It keeps
  // raw animal proteins and vegetables conservative, and dry grains usable
  // as a plated-mass estimate after absorbing water.
  if (canonical.state === "cooked") return grams;
  if (canonical.category === "meat" || canonical.category === "seafood") return grams * 0.76;
  if (canonical.category === "grain" || canonical.category === "legume") return grams * 2.3;
  if (canonical.category === "vegetable" || canonical.category === "fruit") return grams * 0.9;
  return grams;
}

function estimateCostTier(ingredients) {
  const premium = new Set([
    "salmon", "salmon-cooked", "prawns-cooked", "beef", "beef-stewing", "lamb",
    "pine-nuts", "tuna-canned", "cod", "halloumi", "mascarpone",
  ]);
  const moderate = new Set([
    "chicken", "chicken-thigh", "turkey-mince", "beef-mince", "pork-fillet",
    "cheese", "mozzarella", "feta", "protein-powder", "avocado", "nuts",
  ]);
  const ids = new Set(ingredients.map((ingredient) => ingredient.canonicalIngredientId));
  if ([...ids].some((id) => premium.has(id))) return 3;
  if ([...ids].filter((id) => moderate.has(id)).length >= 2) return 2;
  return 1;
}

function releaseTags(macros, costTier) {
  const tags = [];
  if ((macros.protein * 4) / macros.kcal >= 0.2) tags.push("protein");
  if (costTier <= 2) tags.push("budget");
  return tags;
}

function effortFor(candidate, steps) {
  const total = Number(candidate.time?.totalMinutes ?? 0);
  // Even a no-cook snack needs one working vessel or serving container. Keep
  // the effort indicator honest without showing an impossible “0 посуды”.
  const cookware = Math.max(
    1,
    new Set(steps.flatMap((step) => step.equipment ?? [])).size,
  );
  const knifeActions = steps.filter((step) => /нареж|измельч|натр|поруб/i.test(step.text ?? "")).length;
  const activeActions = steps.length + knifeActions;
  const activeMinutes = Math.min(total, Math.max(3, activeActions * 3 + knifeActions * 2));
  const instructions = recipeStepsFromInstructions(steps);
  const parallelProcesses = parallelRecipeProcesses(instructions);
  return {
    level: recipeEffortLevel(activeMinutes, cookware),
    knifeActions,
    cookware,
    activeActions,
    activeMinutes,
    parallelProcesses,
    difficulty: recipeEffortDifficulty(activeMinutes, cookware),
  };
}

function normalizationFailure(card, code, detail) {
  return { id: card.id, title: card.title, code, detail };
}

function expandedInstructionDraft(steps) {
  const terminalIdBySourceId = new Map();
  const expanded = [];
  steps.forEach((step, stepIndex) => {
    const parts = String(step.text ?? "")
      .split(/(?<=[.!?])\s+(?=[А-ЯЁ])/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const merged = [];
    for (const part of parts) {
      if (part.length < 20 && merged.length) merged[merged.length - 1] += ` ${part}`;
      else merged.push(part);
    }
    if (merged.length > 1 && merged[0].length < 20)
      merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
    const sourceId = step.id || `editorial-step-${stepIndex + 1}`;
    const sourceDependencies = (step.dependsOn ?? []).flatMap((dependencyId) => {
      const terminalId = terminalIdBySourceId.get(dependencyId);
      return terminalId ? [terminalId] : [];
    });
    merged.forEach((text, partIndex) => {
      const id = `${sourceId}-part-${partIndex + 1}`;
      const previousPartId = partIndex > 0 ? `${sourceId}-part-${partIndex}` : null;
      expanded.push({
        ...step,
        id,
        text,
        ...(partIndex === merged.length - 1 && step.duration
          ? { duration: step.duration }
          : { duration: undefined }),
        dependsOn: previousPartId ? [previousPartId] : sourceDependencies,
      });
      terminalIdBySourceId.set(sourceId, id);
    });
  });
  if (expanded.length === 1)
    expanded.push({
      ...expanded[0],
      id: `${expanded[0].id}-pack`,
      text: "Разделите готовый выход по числу рассчитанных контейнеров, подпишите имя, приём пищи и дату, затем уберите на хранение.",
      duration: undefined,
      dependsOn: [expanded[0].id],
    });
  return expanded;
}

async function loadCandidates() {
  const { entries } = await loadRecipeCorpusEntries();
  return new Map(entries.map((entry) => [entry.candidate.id, {
    candidate: entry.candidate,
    dataset: { source: entry.publisher, importedAt: entry.accessedAt },
  }]));
}

async function loadRecipeImages() {
  const manifest = JSON.parse(
    await readFile(new URL("../data/recipe-image-manifest.json", import.meta.url), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.policy !== "local-source-copy-with-attribution" ||
    !Array.isArray(manifest.images)
  ) {
    throw new Error("Recipe image manifest is missing or invalid.");
  }
  if (manifest.sourceCardCount !== manifest.images.length) {
    throw new Error("Recipe image manifest must cover every source card.");
  }
  await Promise.all(manifest.images.map(async (image) => {
    if (!/^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u.test(image.localPath)) {
      throw new Error(`${image.id}: invalid local recipe image path`);
    }
    const buffer = await readFile(new URL(`../public${image.localPath}`, import.meta.url));
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (buffer.length !== image.bytes || hash !== image.sha256) {
      throw new Error(`${image.id}: local recipe image does not match its manifest`);
    }
  }));
  const images = new Map(manifest.images.map((image) => [image.id, image]));
  if (images.size !== manifest.images.length) throw new Error("Recipe image manifest contains duplicate ids.");
  return images;
}

/* Кухня приходит из редакционной разметки `data/recipe-cuisines.json`.
   Генератор ничего не угадывает по названию: карточка без явной строки в
   разметке не попадает в каталог и падает в failures. */
async function loadRecipeCuisines() {
  const markup = JSON.parse(
    await readFile(new URL("../data/recipe-cuisines.json", import.meta.url), "utf8"),
  );
  if (markup.schemaVersion !== 1 || !Array.isArray(markup.assignments)) {
    throw new Error("Unsupported editorial cuisine markup.");
  }
  const allowed = new Set(markup.cuisines);
  const byId = new Map();
  for (const assignment of markup.assignments) {
    if (!allowed.has(assignment.cuisine)) {
      throw new Error(`Unknown cuisine ${assignment.cuisine} for ${assignment.id}.`);
    }
    if (byId.has(assignment.id)) {
      throw new Error(`Duplicate cuisine assignment for ${assignment.id}.`);
    }
    byId.set(assignment.id, assignment);
  }
  return { cuisines: markup.cuisines, byId };
}

function candidateWithFamilyMeasurements(candidate, sourceIngredients) {
  return {
    ...candidate,
    sourceIngredients: sourceIngredients.map((ingredient) => {
      const measured = sourceAmount(ingredient);
      if (!measured?.amount || !measured.unit || ingredient.amountMetric != null) return ingredient;
      return { ...ingredient, amountMetric: measured.amount, unitMetric: measured.unit };
    }),
  };
}

function projectReadyCard(releaseCard, entry, recipeImages, cuisines) {
  const { candidate, dataset } = entry;
  const normalized = normalizeRawRecipeCandidate(candidate, {
    publisher: dataset.source,
    accessedAt: dataset.importedAt,
  });
  const failures = [];
  const nonRawRiceMapping = normalized.ingredientMappings.find((mapping) =>
    nonRawRiceCanonicalId(mapping.canonicalIngredientId),
  );
  if (nonRawRiceMapping) {
    failures.push(["rice_non_raw_runtime_ingredient", `${nonRawRiceMapping.sourceName} is not normalized to dry rice.`]);
  }
  const sourceImage = recipeImages.get(candidate.id);
  if (!sourceImage) {
    failures.push(["missing_local_source_image", "A verified local source image is required for runtime."]);
  } else {
    if (sourceImage.sourceUrl !== candidate.sourceUrl) failures.push(["source_image_recipe_mismatch", "Image manifest sourceUrl does not match the recipe source."]);
    if (sourceImage.catalogImageUrl !== candidate.imageUrl) failures.push(["source_image_catalog_mismatch", "Image manifest does not preserve the imported image URL."]);
    if (!sourceImage.attribution?.trim()) failures.push(["missing_source_image_attribution", "Image attribution is required."]);
  }
  const instructionDraft = expandedInstructionDraft(
    normalized.paraphrasedInstructionDraft,
  );
  const candidateForFamily = {
    ...candidateWithFamilyMeasurements(candidate, normalized.sourceIngredients),
    paraphrasedInstructionDraft: instructionDraft,
  };
  const recipeFamily = deriveRecipeFamilyFromAuditedCandidate(candidateForFamily, {
    publisher: dataset.source,
    accessedAt: dataset.importedAt,
  });
  if (!recipeFamily) failures.push(["recipe_family_derivation_failed", "No auditable RecipeFamily can be derived from the candidate."]);
  if (recipeFamily?.ingredients.some((ingredient) => nonRawRiceCanonicalId(ingredient.canonicalIngredientId))) {
    failures.push(["rice_non_raw_runtime_ingredient", "RecipeFamily contains non-raw rice."]);
  }
  if (!allowedSlots.has(candidate.slot)) failures.push(["unsupported_slot", `Unsupported slot: ${candidate.slot}`]);
  if (!candidate.titleRu?.trim()) failures.push(["missing_russian_title", "No Russian editorial title."]);
  const cuisineAssignment = cuisines.byId.get(candidate.id);
  if (!cuisineAssignment) {
    failures.push(["missing_editorial_cuisine", "Recipe has no editorial cuisine assignment in data/recipe-cuisines.json."]);
  } else if (candidate.titleRu?.trim() && cuisineAssignment.title !== candidate.titleRu.trim()) {
    failures.push([
      "stale_editorial_cuisine",
      `Cuisine markup was reviewed for "${cuisineAssignment.title}" but the card is now "${candidate.titleRu.trim()}".`,
    ]);
  }
  if (!hasPositive(candidate.time?.totalMinutes)) failures.push(["missing_time", "No positive total time."]);
  const macros = releaseCard.calculatedNutrition;
  if (!hasPositive(macros.kcal) || ![macros.protein, macros.fat, macros.carbs].every(hasNonNegative)) {
    failures.push(["invalid_calculated_macros", "The release gate did not produce complete independent macros."]);
  }
  if (!candidate.sourceUrl) failures.push(["missing_provenance", "A source URL is required even when media is absent."]);
  if (!candidate.storage?.refrigerator || !candidate.storage?.freezer || !candidate.storage?.thaw) {
    failures.push(["missing_storage", "Storage guidance is incomplete."]);
  }
  if (!candidate.packing?.portion || !candidate.packing?.label) {
    failures.push(["missing_packing", "Packing guidance is incomplete."]);
  }
  const steps = instructionDraft.map((step) => step.text).filter(Boolean);
  const projectedEffort = effortFor(
    candidate,
    normalized.paraphrasedInstructionDraft,
  );
  const instructions = recipeStepsFromInstructions(instructionDraft, {
    activeMinutes: projectedEffort.activeMinutes,
    totalMinutes: Number(candidate.time.totalMinutes),
  });
  const effort = {
    ...projectedEffort,
    parallelProcesses: parallelRecipeProcesses(instructions),
  };
  if (!steps.length) failures.push(["missing_paraphrased_steps", "No editorial paraphrased steps."]);

  const shoppingSourceRows = [];
  const procedureIngredients = [];
  const servings = Number(candidate.servings);
  let estimatedCookedBatchMass = 0;
  normalized.ingredientMappings.forEach((mapping, index) => {
    const sourceIngredient = normalized.sourceIngredients[index];
    if (!sourceIngredient) {
      failures.push(["ingredient_index_mismatch", `Mapping ${index + 1} has no source ingredient.`]);
      return;
    }
    if (mapping.status === "mapped") {
      const canonical = canonicalIngredients[mapping.canonicalIngredientId];
      const mass = canonical && sourceMass(sourceIngredient, canonical);
      if (!canonical || !mass) {
        failures.push(["unmeasurable_mapped_ingredient", `${mapping.sourceName} cannot be represented in grams.`]);
        return;
      }
      const pieceEstimate = canonical.unit.sensibleUnit === "piece" && canonical.unit.gramsPerUnit > 1
        ? round(mass.grams / canonical.unit.gramsPerUnit, 2)
        : undefined;
      const sourceIngredientId = `source-ingredient-${index + 1}`;
      if (recipeFamily && !recipeFamily.ingredients.some((ingredient) => ingredient.sourceIngredientId === sourceIngredientId)) {
        if (optionalServingSourceIngredient(sourceIngredient)) {
          procedureIngredients.push({
            sourceIngredientIndex: index + 1,
            sourceIngredientId,
            nameRu: canonical.canonicalName,
            sourceName: mapping.sourceName,
            classification: "optional_serving",
            allergens: canonical.allergens,
            reason: "Опциональный компонент для подачи сохранён вне вариативной RecipeFamily.",
            ...procedureMeasurement(sourceIngredient, servings),
          });
          return;
        }
        failures.push(["recipe_family_shopping_misalignment", `${sourceIngredientId} is not present in the derived RecipeFamily.`]);
        return;
      }
      shoppingSourceRows.push({
        sourceIngredientIndex: index + 1,
        sourceIngredientId,
        canonicalIngredientId: canonical.id,
        nameRu: ["beef_mince_raw", "beef_mince_90_raw", "beef_mince_85_raw", "rice_raw"].includes(canonical.id)
          ? canonical.canonicalName
          : sourceIngredient.displayNameRu?.trim() || canonical.canonicalName,
        group: groupFor(canonical),
        quantityGrams: mass.grams,
        sourceMeasurement: sourceIngredient.miseSourceStateConversion
          ? {
              amount: sourceIngredient.miseSourceStateConversion.sourceAmount,
              unit: sourceIngredient.miseSourceStateConversion.sourceUnit,
              state: sourceIngredient.miseSourceStateConversion.sourceState,
            }
          : { amount: mass.sourceAmount, unit: mass.sourceUnit },
        measurementNormalization: sourceIngredient.miseSourceStateConversion
          ? {
              kind: sourceIngredient.miseSourceStateConversion.kind,
              amount: mass.grams,
              unit: "g",
              state: "raw",
              basis: sourceIngredient.miseSourceStateConversion.basis,
              evidenceRecipeId: sourceIngredient.miseSourceStateConversion.evidenceRecipeId,
            }
          : undefined,
        averagePieceWeightGrams: canonical.unit.sensibleUnit === "piece" && canonical.unit.gramsPerUnit > 1
          ? canonical.unit.gramsPerUnit
          : undefined,
        pieceEstimate,
        allergens: canonical.allergens,
        checkLabel: canonical.reference.dataType === "label_required",
        massStatus: sourceIngredient.miseSourceStateConversion
          ? "normalized_source_state"
          : mass.estimated ? "estimated_from_standard_conversion" : "source_metric",
      });
      estimatedCookedBatchMass += retainedMass(mass.grams, canonical);
      return;
    }
    if (mapping.status === "replaced") {
      failures.push(["ambiguous_editorial_replacement", `${mapping.sourceName} requires an explicit runtime quantity split.`]);
      return;
    }
    if (mapping.status === "unresolved") {
      failures.push(["unresolved_ingredient", mapping.sourceName]);
      return;
    }
    // A source ingredient must still be visible when it is intentionally
    // excluded from nutrition and shopping (water, salt, to-taste garnish).
    procedureIngredients.push({
      sourceIngredientIndex: index + 1,
      sourceIngredientId: `source-ingredient-${index + 1}`,
      nameRu: sourceIngredient.displayNameRu?.trim() || russianPantryName(mapping.sourceName),
      sourceName: mapping.sourceName,
      classification: mapping.status === "ignored_noncaloric" ? "pantry" : "to_taste",
      allergens: procedureAllergens(mapping.sourceName),
      reason: mapping.reason ?? "Редакционное примечание к приготовлению.",
      ...procedureMeasurement(sourceIngredient, servings),
    });
  });

  const shoppingIngredients = aggregateShoppingIngredients(shoppingSourceRows);

  if (!shoppingIngredients.length) failures.push(["no_shopping_ingredients", "No measured canonical ingredients."]);
  if (shoppingIngredients.some((ingredient) => nonRawRiceCanonicalId(ingredient.canonicalIngredientId))) {
    failures.push(["rice_non_raw_runtime_ingredient", "Shopping projection contains non-raw rice."]);
  }
  if (recipeFamily) {
    const familyIngredientIds = new Set(recipeFamily.ingredients.map((ingredient) => ingredient.sourceIngredientId));
    const unalignedShopping = shoppingSourceRows.find((ingredient) => !familyIngredientIds.has(ingredient.sourceIngredientId));
    if (unalignedShopping) {
      failures.push(["recipe_family_shopping_misalignment", `${unalignedShopping.sourceIngredientId} is not present in the derived RecipeFamily.`]);
    }
    const familyMacroDelta = ["kcal", "protein", "fat", "carbs"].find(
      (key) => Math.abs(recipeFamily.miseCalculatedNutrition[key] - macros[key]) > 0.2,
    );
    if (familyMacroDelta) {
      failures.push(["recipe_family_macro_mismatch", `Derived RecipeFamily ${familyMacroDelta} differs from audited runtime macros.`]);
    }
  }
  if (!Number.isFinite(servings) || servings <= 0) failures.push(["invalid_servings", "No positive batch yield."]);
  const servingWeight = servings > 0 ? Math.max(60, round(estimatedCookedBatchMass / servings)) : 0;
  if (!hasPositive(servingWeight)) failures.push(["missing_estimated_serving_mass", "Raw mass model cannot estimate a serving mass."]);
  const costTier = estimateCostTier(shoppingIngredients);
  const menuTags = releaseTags(macros, costTier);
  if (!menuTags.length) failures.push(["no_release_menu_tag", "Recipe does not meet protein or relative-budget criteria."]);
  if (menuTags.some((tag) => !allowedTags.has(tag))) failures.push(["unsupported_menu_tag", "Only protein and budget are release menu styles."]);
  if (failures.length) return { recipe: null, failures: failures.map(([code, detail]) => normalizationFailure(releaseCard, code, detail)) };

  return {
    recipe: {
      id: candidate.id,
      slot: candidate.slot,
      title: candidate.titleRu.trim(),
      cuisine: cuisineAssignment.cuisine,
      macros: Object.fromEntries(Object.entries(macros).map(([key, value]) => [key, round(value)])),
      timeMinutes: Math.max(
        Number(candidate.time.totalMinutes),
        instructionEndMinutes(instructions),
      ),
      menuTags,
      costTier: {
        value: costTier,
        label: ["экономно", "средне", "выше среднего"][costTier - 1],
        basis: "relative_editorial_ingredient_complexity_not_rubles",
      },
      servingMass: {
        grams: servingWeight,
        status: "estimated_not_verified_cooked_yield",
        method: "canonical_raw_mass_with_category_retention_v1",
      },
      shoppingIngredients,
      procedureIngredients,
      steps,
      equipmentOptions: recipeEquipmentFor(candidate.id, candidate.titleRu.trim(), steps),
      instructions,
      storage: {
        refrigerator: candidate.storage.refrigerator,
        freezer: candidate.storage.freezer,
        thaw: candidate.storage.thaw,
        refrigeratorDays: candidate.storage.refrigeratorDays,
        freezerDays: candidate.storage.freezerDays,
        freezable: Boolean(candidate.storage.freezable),
        reheat: candidate.storage.reheat,
        reheatToC: candidate.storage.reheatToC,
      },
      packing: candidate.packing,
      localization: candidate.localization,
      effort,
      provenance: {
        kind: "parsed",
        publisher: dataset.source,
        sourceTitle: candidate.sourceTitle,
        sourceUrl: candidate.sourceUrl,
        sourceQuery: candidate.sourceQuery,
        preview: sourceImage
          ? {
              kind: "source_preview",
              imageUrl: sourceImage.localPath,
              sourceImageUrl: sourceImage.sourceImageUrl,
              catalogImageUrl: sourceImage.catalogImageUrl,
              usage: "local-source-copy-with-attribution",
              attribution: sourceImage.attribution,
              contentType: sourceImage.contentType,
              sha256: sourceImage.sha256,
            }
          : { kind: "graphic_fallback", emoji: emojiFor(candidate.id), reason: "local_source_image_unavailable" },
      },
      visualFallback: { emoji: emojiFor(candidate.id), reserveAspectRatio: "4:3" },
      recipeFamily: recipeFamily && sourceImage
        ? {
            ...recipeFamily,
            image: {
              ...recipeFamily.image,
              imageUrl: sourceImage.localPath,
              sourceImageUrl: sourceImage.sourceImageUrl,
              attribution: sourceImage.attribution,
            },
          }
        : recipeFamily,
      adapter: {
        status: "not_connected_to_ui_recipe_contract",
        note: "Recipe Engine integration must consume this projection through an explicit adapter; relative cost is not a rouble price.",
      },
    },
    failures: [],
  };
}

export function assertRuntimeCatalogMinimum(catalog, minimum = 200) {
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error("Runtime catalog minimum must be a positive integer.");
  if (catalog.recipes.length < minimum) {
    throw new Error(`Runtime catalog has ${catalog.recipes.length} production-ready recipes; minimum is ${minimum}.`);
  }
}

function jsonStableCatalog(value) {
  // The checked-in catalog is consumed as JSON. Strip optional undefined fields
  // before returning it so the in-memory projection and its artifact compare exactly.
  return JSON.parse(JSON.stringify(value));
}

export async function buildRecipeRuntimeCatalog({ minimum } = {}) {
  const [release, candidates, recipeImages, cuisines] = await Promise.all([
    auditRecipeRelease(),
    loadCandidates(),
    loadRecipeImages(),
    loadRecipeCuisines(),
  ]);
  const failures = [];
  const recipes = [];
  for (const releaseCard of release.cards.filter((card) => card.verdict === "ready")) {
    const entry = candidates.get(releaseCard.id);
    if (!entry) {
      failures.push(normalizationFailure(releaseCard, "missing_candidate", "Audit-ready card is missing candidate data."));
      continue;
    }
    const projection = projectReadyCard(releaseCard, entry, recipeImages, cuisines);
    failures.push(...projection.failures);
    if (projection.recipe) recipes.push(projection.recipe);
  }
  const coverage = {
    equipment: equipmentCoverage(recipes),
    releaseAudit: release.counts,
    auditReadyCandidates: release.cards.filter((card) => card.verdict === "ready").length,
    runtimeReadyRecipes: recipes.length,
    bySlot: Object.fromEntries([...allowedSlots].sort().map((slot) => [slot, recipes.filter((recipe) => recipe.slot === slot).length])),
    byReleaseMenuTag: Object.fromEntries([...allowedTags].sort().map((tag) => [tag, recipes.filter((recipe) => recipe.menuTags.includes(tag)).length])),
    byCuisine: Object.fromEntries(
      cuisines.cuisines
        .map((cuisine) => [cuisine, recipes.filter((recipe) => recipe.cuisine === cuisine).length])
        .filter(([, count]) => count > 0),
    ),
    failureReasons: Object.fromEntries(
      [...new Set(failures.map((failure) => failure.code))].sort().map((code) => [code, failures.filter((failure) => failure.code === code).length]),
    ),
  };
  const catalog = {
    schemaVersion: 3,
    generatedFrom: "audit-ready editorial cards only",
    constraints: {
      releaseMenuTags: [...allowedTags],
      mediaRequired: "verified_local_source_image",
      servingMass: "estimated_not_verified_cooked_yield",
      cost: "relative_tier_not_rubles",
    },
    coverage,
    recipes,
    failures,
  };
  const stableCatalog = jsonStableCatalog(catalog);
  if (minimum !== undefined) assertRuntimeCatalogMinimum(stableCatalog, minimum);
  return stableCatalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf("--output");
  const minimumIndex = process.argv.indexOf("--require-minimum");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path");
  const minimum = minimumIndex >= 0 ? Number(process.argv[minimumIndex + 1]) : undefined;
  if (minimumIndex >= 0 && !Number.isInteger(minimum)) throw new Error("--require-minimum requires a whole number");
  const catalog = await buildRecipeRuntimeCatalog({ minimum });
  if (outputPath) {
    const absolute = resolve(outputPath);
    const temporary = `${absolute}.tmp`;
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await rename(temporary, absolute);
  }
  process.stdout.write(`${JSON.stringify(catalog.coverage)}\n`);
}
