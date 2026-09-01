import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertRuntimeCatalogMinimum,
  buildRecipeRuntimeCatalog,
} from "../scripts/build-recipe-runtime-catalog.mjs";
import { AUDIT_REASON, auditRecipeCorpus } from "../scripts/audit-recipe-corpus.mjs";

const catalog = await buildRecipeRuntimeCatalog();
const audit = await auditRecipeCorpus();
const blockedRecipeIds = new Set(
  audit.verdicts.filter((item) => item.verdict === "blocked").map((item) => item.id),
);

function stableFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("runtime projection is complete for every recipe it admits", () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.constraints.mediaRequired, "verified_local_source_image");
  assert.ok(catalog.recipes.length > 0, "current audit should yield some runtime recipes");
  assert.equal(new Set(catalog.recipes.map((recipe) => recipe.id)).size, catalog.recipes.length);
  for (const recipe of catalog.recipes) {
    assert.match(recipe.title, /[А-Яа-яЁё]/u);
    assert.ok(recipe.steps.length > 0);
    assert.ok(recipe.shoppingIngredients.length > 0);
    assert.equal(
      new Set(recipe.shoppingIngredients.map((ingredient) => ingredient.canonicalIngredientId)).size,
      recipe.shoppingIngredients.length,
      `${recipe.id}: shopping ingredients are grouped by canonical identity`,
    );
    for (const ingredient of recipe.shoppingIngredients) {
      assert.equal(ingredient.sourceIngredientId, ingredient.sourceIngredientIds[0]);
      assert.equal(ingredient.sourceIngredientIndex, ingredient.sourceIngredientIndexes[0]);
      assert.deepEqual(
        ingredient.sourceAudit.map((source) => source.sourceIngredientId),
        ingredient.sourceIngredientIds,
      );
      assert.deepEqual(
        ingredient.sourceAudit.map((source) => source.sourceIngredientIndex),
        ingredient.sourceIngredientIndexes,
      );
      assert.equal(
        ingredient.nameRu,
        [...new Set(ingredient.sourceAudit.map((source) => source.nameRu))].join(" + "),
        `${recipe.id}: grouped shopping name preserves every source product`,
      );
      assert.equal(
        ingredient.quantityGrams,
        Math.round(ingredient.sourceAudit.reduce((sum, source) => sum + source.quantityGrams, 0) * 10) / 10,
      );
    }
    assert.ok(recipe.shoppingIngredients.every((ingredient) => ingredient.quantityGrams > 0));
    assert.ok(recipe.shoppingIngredients.every((ingredient) => ingredient.nameRu && ingredient.group));
    assert.ok(recipe.menuTags.length > 0 && recipe.menuTags.every((tag) => ["protein", "budget"].includes(tag)));
    assert.equal(recipe.costTier.basis, "relative_editorial_ingredient_complexity_not_rubles");
    assert.equal(recipe.servingMass.status, "estimated_not_verified_cooked_yield");
    assert.ok(recipe.provenance.sourceUrl);
    assert.equal(recipe.provenance.preview.kind, "source_preview");
    assert.match(recipe.provenance.preview.imageUrl, /^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u);
    assert.match(recipe.provenance.preview.sourceImageUrl, /^https:\/\//u);
    assert.equal(recipe.provenance.preview.usage, "local-source-copy-with-attribution");
    assert.ok(recipe.provenance.preview.attribution);
    assert.match(recipe.provenance.preview.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(recipe.visualFallback.emoji);
    assert.ok(recipe.recipeFamily, "an audited RecipeFamily is a runtime gate");
    assert.equal(recipe.recipeFamily.image.imageUrl, recipe.provenance.preview.imageUrl);
    assert.ok(recipe.effort.parallelProcesses >= 1);
    assert.ok([1, 2, 3].includes(recipe.effort.difficulty));
    const expectedDifficulty =
      recipe.effort.activeMinutes <= 15 && recipe.effort.cookware <= 1
        ? 1
        : recipe.effort.activeMinutes <= 30 || recipe.effort.cookware >= 2
          ? 2
          : 3;
    assert.equal(recipe.effort.difficulty, expectedDifficulty);
    assert.ok(recipe.instructions.length > 0);
    assert.ok(recipe.instructions.every((step) => Number.isFinite(step.minutes) && step.minutes > 0));
    assert.ok(recipe.instructions.every((step) => typeof step.hands === "boolean"));
    assert.ok(recipe.instructions.every((step, index) => index === 0 || step.at >= recipe.instructions[index - 1].at));
    assert.ok(
      recipe.timeMinutes >= Math.max(...recipe.instructions.map((step) => step.at + step.minutes)),
      `${recipe.id}: total time covers the timeline end`,
    );
    const familyIngredientIds = new Set(recipe.recipeFamily.ingredients.map((ingredient) => ingredient.sourceIngredientId));
    assert.ok(recipe.shoppingIngredients.every((ingredient) => ingredient.sourceIngredientIds.every((id) => familyIngredientIds.has(id))));
  }
});

test("runtime projection exactly excludes the final blocked audit set", () => {
  assert.equal(catalog.recipes.length, 202);
  assert.equal(blockedRecipeIds.size, 53);
  assert.deepEqual(
    new Set(catalog.recipes.map((recipe) => recipe.id)),
    new Set(audit.verdicts.filter((item) => item.verdict !== "blocked").map((item) => item.id)),
  );
  for (const id of blockedRecipeIds) {
    assert.equal(catalog.recipes.some((recipe) => recipe.id === id), false, `${id}: blocked card cannot reach runtime`);
  }
});

test("timeline inference distinguishes active work from passive waiting", () => {
  const steps = catalog.recipes.flatMap((recipe) => recipe.instructions);
  assert.ok(steps.some((step) => step.hands), "some instructions require hands-on work");
  assert.ok(steps.some((step) => !step.hands), "passive cooking or waiting is explicit");
  assert.ok(steps.some((step) => step.minutes > 0), "source durations reach the runtime timeline");
  for (const recipe of catalog.recipes) {
    const timedTextSteps = recipe.recipeFamily.miseInstructions.filter(
      (step) => /\d+(?:[.,]\d+)?(?:\s*(?:–|-|до)\s*\d+(?:[.,]\d+)?)?\s*(?:сек|мин|ч(?:ас)?)/iu.test(step.text),
    );
    const projectedTimedSteps = recipe.instructions.filter((step) => step.minutes > 0);
    assert.ok(
      projectedTimedSteps.length >= timedTextSteps.length,
      `${recipe.id}: explicit times in step text reach the timeline`,
    );
  }
});

test("every source ingredient is accounted for or blocks projection", () => {
  for (const recipe of catalog.recipes) {
    const accounted = new Set([
      ...recipe.shoppingIngredients.flatMap((ingredient) => ingredient.sourceIngredientIndexes),
      ...recipe.procedureIngredients.map((ingredient) => ingredient.sourceIngredientIndex),
    ]);
    const maxIndex = Math.max(...accounted);
    assert.deepEqual([...accounted].sort((a, b) => a - b), Array.from({ length: maxIndex }, (_, index) => index + 1));
  }
  assert.ok(catalog.failures.every((failure) => failure.code && failure.id));
});

test("measured spices keep a scalable source-derived amount", () => {
  const recipe = catalog.recipes.find((item) => item.id === "tmpm-28572");
  assert.ok(recipe);
  const paprika = recipe.procedureIngredients.find((item) => item.nameRu === "Паприка");
  assert.ok(paprika);
  assert.equal(paprika.unit, "g");
  assert.ok(Math.abs(paprika.quantityPerServing - 3 / 7) < 0.0001);
  for (const item of catalog.recipes.flatMap((entry) => entry.procedureIngredients)) {
    if (item.quantityPerServing === undefined) continue;
    assert.ok(Number.isFinite(item.quantityPerServing) && item.quantityPerServing > 0);
    assert.ok(["g", "ml", "piece"].includes(item.unit));
  }
});

test("cheese and pasta stay in grams while liquid broth uses millilitres", () => {
  const expectedUnits = new Map([
    ["cheese_processed", "g"],
    ["parmesan_processed", "g"],
    ["pasta_raw", "g"],
    ["broth_processed", "ml"],
    ["vegetable_broth_processed", "ml"],
  ]);
  for (const recipe of catalog.recipes) {
    for (const ingredient of recipe.shoppingIngredients) {
      const expectedUnit = expectedUnits.get(ingredient.canonicalIngredientId);
      if (!expectedUnit) continue;
      const familyIngredient = recipe.recipeFamily.ingredients.find(
        (item) => item.sourceIngredientId === ingredient.sourceIngredientId,
      );
      assert.equal(familyIngredient?.unit, expectedUnit, `${recipe.id}: ${ingredient.nameRu}`);
      assert.equal(ingredient.averagePieceWeightGrams, undefined, `${recipe.id}: no fake piece mass`);
      assert.equal(ingredient.pieceEstimate, undefined, `${recipe.id}: no fake piece estimate`);
    }
  }
});

test("every runtime rice amount is dry, gram-based, and source-auditable", async () => {
  const registry = JSON.parse(
    await readFile(new URL("../data/mealprep-owner-decisions.json", import.meta.url), "utf8"),
  );
  const expectedConvertedIds = [...registry.riceDryWeightPolicy.expectedRecipeIds].sort();
  const convertedRecipes = catalog.recipes.filter((recipe) =>
    recipe.shoppingIngredients.some(
      (ingredient) => ingredient.sourceAudit.some(
        (source) => source.measurementNormalization?.kind === "cooked_rice_to_dry_weight_v1",
      ),
    ),
  );
  const expectedRuntimeConvertedIds = expectedConvertedIds.filter((id) => !blockedRecipeIds.has(id));
  assert.deepEqual(convertedRecipes.map((recipe) => recipe.id).sort(), expectedRuntimeConvertedIds);
  for (const id of expectedConvertedIds.filter((id) => blockedRecipeIds.has(id))) {
    assert.equal(catalog.recipes.some((recipe) => recipe.id === id), false, `${id}: blocked rice card cannot reach runtime`);
  }
  for (const recipe of catalog.recipes) {
    const rawRice = recipe.shoppingIngredients.filter(
      (ingredient) => ingredient.canonicalIngredientId === "rice_raw",
    );
    assert.ok(rawRice.every((ingredient) => ingredient.nameRu === "Рис сухой"));
    const allCanonicalIds = [
      ...recipe.shoppingIngredients.map((ingredient) => ingredient.canonicalIngredientId),
      ...recipe.recipeFamily.ingredients.map((ingredient) => ingredient.canonicalIngredientId),
    ];
    assert.equal(
      allCanonicalIds.some((id) => /^rice(?:_|-)cooked(?:_|-|$)/iu.test(id)),
      false,
      `${recipe.id}: cooked rice cannot reach runtime`,
    );
  }
  for (const recipe of convertedRecipes) {
    const rice = recipe.shoppingIngredients.find(
      (ingredient) => ingredient.sourceAudit.some(
        (source) => source.measurementNormalization?.kind === "cooked_rice_to_dry_weight_v1",
      ),
    );
    assert.ok(rice);
    assert.equal(rice.canonicalIngredientId, "rice_raw");
    assert.equal(rice.nameRu, "Рис сухой");
    const normalizedRiceSource = rice.sourceAudit.find(
      (source) => source.measurementNormalization?.kind === "cooked_rice_to_dry_weight_v1",
    );
    assert.equal(normalizedRiceSource?.massStatus, "normalized_source_state");
    assert.equal(normalizedRiceSource?.sourceMeasurement.state, "cooked");
    assert.equal(normalizedRiceSource?.measurementNormalization.state, "raw");
    assert.equal(normalizedRiceSource?.measurementNormalization.unit, "g");
    const familyRice = recipe.recipeFamily.ingredients.find(
      (ingredient) => ingredient.sourceIngredientId === normalizedRiceSource?.sourceIngredientId,
    );
    assert.equal(familyRice?.canonicalIngredientId, "rice_raw");
    assert.equal(familyRice?.unit, "g");
    assert.ok(recipe.recipeFamily.editorialAudit.ingredientMapping.stateConversions?.some(
      (conversion) => conversion.targetCanonicalIngredientId === "rice_raw" && conversion.targetUnit === "g",
    ));
    assert.ok(recipe.steps.some((step) => /(?:количество\s+)?сухо(?:го|й)\s+риса/iu.test(step)), `${recipe.id}: dry rice has an executable cooking step`);
  }
});

test("owner product decisions are visible in production recipe ingredients", () => {
  const mirinRecipe = catalog.recipes.find((item) => item.id === "tmpm-28247");
  assert.ok(mirinRecipe, "tmpm-28247 remains in the runtime catalog");
  assert.ok(mirinRecipe.shoppingIngredients.some((ingredient) => ingredient.canonicalIngredientId === "mirin_processed" && /3:1/u.test(ingredient.nameRu)));
  assert.ok(mirinRecipe.steps.some((step) => /несколько капель рисового уксуса/iu.test(step)));
  const excludedMirin = audit.verdicts.find((item) => item.id === "tmpm-22884");
  assert.ok(excludedMirin?.reasons.some((reason) => reason.code === AUDIT_REASON.OWNER_EXCLUDED));
  assert.equal(catalog.recipes.some((recipe) => recipe.id === "tmpm-22884"), false, "quarantined mirin card cannot reach runtime");
  const waffle = catalog.recipes.find((item) => item.id === "tmpm-26414");
  assert.ok(waffle);
  assert.ok(waffle.shoppingIngredients.some((ingredient) => /12,5 г сывороточного протеина.*12,5 г казеина.*20 г овсяной муки.*10 г кукурузного крахмала.*1 г разрыхлителя/iu.test(ingredient.nameRu)));
  assert.ok(waffle.steps.some((step) => /заранее смешайте 12,5 г сывороточного протеина/iu.test(step)));
});

test("the 200-recipe release gate is enforceable without hard-coding today's count", () => {
  if (catalog.recipes.length >= 200) {
    assert.doesNotThrow(() => assertRuntimeCatalogMinimum(catalog, 200));
  } else {
    assert.throws(() => assertRuntimeCatalogMinimum(catalog, 200), /minimum is 200/);
  }
  assert.throws(
    () => assertRuntimeCatalogMinimum({ recipes: Array.from({ length: 199 }) }, 200),
    /minimum is 200/,
  );
  assert.doesNotThrow(() => assertRuntimeCatalogMinimum({ recipes: Array.from({ length: 200 }) }, 200));
});

test("checked-in runtime catalog is the exact hard-gated projection", async () => {
  const stored = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  assert.equal(stableFingerprint(stored), stableFingerprint(catalog), "checked-in runtime catalog is byte-for-byte equivalent to the projection");
  assert.ok(stored.recipes.every((recipe) => recipe.recipeFamily?.ingredients?.length));
});

test("every release build refreshes the audited wizard catalog", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const refreshCommand =
    "node scripts/build-recipe-runtime-catalog.mjs --output data/recipe-runtime-catalog.json --require-minimum 200 && node scripts/validate-recipe-flavour-integrity.mjs";
  assert.equal(packageJson.scripts.prebuild, refreshCommand);
  assert.equal(packageJson.scripts["recipes:runtime:refresh"], refreshCommand);
});
