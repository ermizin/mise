import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";
import { buildRecipeRuntimeCatalog } from "../scripts/build-recipe-runtime-catalog.mjs";
import { loadRecipeCorpusEntries } from "../scripts/recipe-corpus-overlay.mjs";

const policy = JSON.parse(
  await readFile(new URL("../data/recipe-proofread-policy.json", import.meta.url), "utf8"),
);
const releaseAudit = await auditRecipeRelease();
const catalog = await buildRecipeRuntimeCatalog();
const runtimeById = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));

function userVisibleText(recipe) {
  return [
    recipe.title,
    ...recipe.steps,
    ...recipe.shoppingIngredients.map((ingredient) => ingredient.nameRu),
    ...Object.values(recipe.storage ?? {}),
    ...Object.values(recipe.packing ?? {}),
    ...recipe.recipeFamily.miseInstructions.map((step) => step.text),
    ...recipe.recipeFamily.ingredients.map((ingredient) => ingredient.nameRu),
  ].filter((value) => typeof value === "string").join("\n");
}

test("owner-approved chef proofread covers the frozen corpus and fixes the release verdict", () => {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.reviewedCandidateCount, 255);
  assert.equal(policy.approvedBy, "owner");
  assert.equal(releaseAudit.total, 255);
  assert.deepEqual(releaseAudit.counts, { ready: 202, review_required: 0, blocked: 53 });
  assert.equal(catalog.recipes.length, 202);
  assert.equal(catalog.failures.length, 0);
});

test("every proofread quarantine stays auditable and outside runtime", () => {
  const auditById = new Map(releaseAudit.cards.map((card) => [card.id, card]));
  assert.equal(new Set(policy.quarantine.map((item) => item.id)).size, policy.quarantine.length);
  for (const quarantine of policy.quarantine) {
    const card = auditById.get(quarantine.id);
    assert.ok(card, `${quarantine.id}: quarantine references a corpus card`);
    assert.equal(card.verdict, "blocked", `${quarantine.id}: quarantine remains blocked`);
    assert.ok(
      card.reasons.some((reason) => reason.code === quarantine.code || reason.code === "owner_excluded"),
      `${quarantine.id}: release audit retains the quarantine reason`,
    );
    assert.equal(runtimeById.has(quarantine.id), false, `${quarantine.id}: quarantine cannot reach runtime`);
  }
});

test("storage corrections do not contradict the intended serving mode", () => {
  const hot = new Set(policy.hotReheatRecipeIds);
  const cold = new Set(policy.coldNoReheatRecipeIds);
  assert.deepEqual([...hot].filter((id) => cold.has(id)), []);
  for (const id of hot) {
    const recipe = runtimeById.get(id);
    if (recipe) assert.equal(recipe.storage.reheatToC, 74, `${id}: hot leftovers reheat to 74 °C`);
  }
  for (const id of cold) {
    const recipe = runtimeById.get(id);
    if (recipe) {
      assert.equal(recipe.storage.reheatToC, null, `${id}: cold dish has no reheating target`);
      assert.match(recipe.storage.reheat, /без повторного нагрева/iu, `${id}: cold serving is explicit`);
    }
  }
  for (const id of policy.freezerRecipeIds) {
    const recipe = runtimeById.get(id);
    if (recipe) assert.equal(recipe.storage.freezable, true, `${id}: approved freezer route remains enabled`);
  }
});

test("runtime rice is always a dry gram amount with one executable preparation", () => {
  for (const recipe of catalog.recipes) {
    const canonicalIds = [
      ...recipe.shoppingIngredients.map((ingredient) => ingredient.canonicalIngredientId),
      ...recipe.recipeFamily.ingredients.map((ingredient) => ingredient.canonicalIngredientId),
    ];
    assert.equal(
      canonicalIds.some((id) => /^rice(?:_|-)cooked(?:_|-|$)/iu.test(id)),
      false,
      `${recipe.id}: cooked-rice identity cannot reach runtime`,
    );
    const rice = recipe.shoppingIngredients.filter(
      (ingredient) => ingredient.canonicalIngredientId === "rice_raw",
    );
    assert.ok(rice.every((ingredient) => ingredient.nameRu === "Рис сухой"));
    const preparationCount = (recipe.steps.join(" ").match(
      /(?:свар|приготов|промой)[а-яё]*\s+(?:указанное[^.]{0,80})?рис/giu,
    ) ?? []).length;
    assert.ok(preparationCount <= 1, `${recipe.id}: rice preparation is not duplicated`);
  }
});

test("rice ingredient and candidate-level provenance always describe the same conversion", async () => {
  const { entries } = await loadRecipeCorpusEntries();
  const normalized = entries
    .map(({ candidate }) => candidate)
    .filter((candidate) => candidate.miseRiceDryWeightNormalization);
  const sharedKeys = [
    "kind",
    "sourceState",
    "sourceAmount",
    "sourceUnit",
    "targetState",
    "targetAmount",
    "targetUnit",
    "targetCanonicalIngredientId",
    "factor",
    "basis",
    "evidenceRecipeId",
  ];

  assert.equal(normalized.length, 29);
  for (const candidate of normalized) {
    const record = candidate.miseRiceDryWeightNormalization;
    const ingredient = candidate.ingredients[record.sourceIngredientIndex - 1];
    assert.ok(ingredient?.miseSourceStateConversion, `${candidate.id}: converted rice ingredient exists`);
    for (const key of sharedKeys) {
      assert.deepEqual(
        record[key],
        ingredient.miseSourceStateConversion[key],
        `${candidate.id}: candidate and ingredient provenance agree on ${key}`,
      );
    }
  }
});

test("proofread glossary and rounded oven temperatures reach every user-visible runtime field", () => {
  const forbiddenTerms = /кочудян|хэшбраун|вустерский соус|\bBBQ\b|zero-соус|\bal dente\b|\bMaseca\b|\bSplenda\b|\bCorn Chex\b/iu;
  const awkwardTemperatures = /\b(?:163|177|191|204|217|218|232)\s*°\s*C\b/iu;
  for (const recipe of catalog.recipes) {
    const text = userVisibleText(recipe);
    assert.doesNotMatch(text, forbiddenTerms, `${recipe.id}: glossary normalization reaches runtime`);
    assert.doesNotMatch(text, awkwardTemperatures, `${recipe.id}: oven temperature is rounded for execution`);
  }
});

test("steak meal-prep card has a measured safe endpoint before chilling", () => {
  const recipe = runtimeById.get("goodfood-steak-broccoli-protein-pots");
  assert.ok(recipe);
  assert.match(recipe.steps.join(" "), /не менее 63 °C/iu);
  assert.match(recipe.steps.join(" "), /отдохнуть 3 минуты/iu);
});
