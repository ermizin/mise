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

test("ingredient identity rules reach every listed card and leave no old mapping", async () => {
  const { entries } = await loadRecipeCorpusEntries();
  const candidates = new Map(entries.map(({ candidate }) => [candidate.id, candidate]));
  const canonicalIds = (recipe) => [
    ...recipe.shoppingIngredients.map((ingredient) => ingredient.canonicalIngredientId),
    ...recipe.recipeFamily.ingredients.map((ingredient) => ingredient.canonicalIngredientId),
  ];
  assert.ok(policy.ingredientIdentityRules.length > 0);
  for (const rule of policy.ingredientIdentityRules) {
    for (const id of rule.recipeIds) {
      const recipe = runtimeById.get(id);
      assert.ok(recipe, `${id}: the rule names a runtime card`);
      // Good Food rows keep their English source name, so the row is found
      // by its place in the source list rather than by the Russian name.
      const candidate = candidates.get(id);
      const rows = candidate.sourceIngredients ?? candidate.ingredients;
      const row = rows.findIndex((item) => String(item.name).trim().toLowerCase() === rule.sourceName.toLowerCase()) + 1;
      assert.ok(row > 0, `${id}: the card still lists «${rule.sourceName}»`);
      assert.ok(
        recipe.shoppingIngredients.some((ingredient) =>
          ingredient.canonicalIngredientId === rule.canonicalIngredientId && ingredient.sourceIngredientIndexes.includes(row)),
        `${id}: «${rule.sourceName}» is ${rule.canonicalIngredientId}`,
      );
      assert.ok(canonicalIds(recipe).includes(rule.canonicalIngredientId), `${id}: the Recipe Family uses ${rule.canonicalIngredientId}`);
      assert.equal(canonicalIds(recipe).includes(rule.fromCanonicalIngredientId), false, `${id}: ${rule.fromCanonicalIngredientId} is gone`);
      // Строка, которую движок не считал продуктом (приправа «по вкусу»), уходит
      // из списка процедуры, а не остаётся там второй раз.
      assert.equal(
        recipe.procedureIngredients.some((ingredient) => ingredient.sourceIngredientIndex === row),
        false,
        `${id}: «${rule.sourceName}» is not also a seasoning line`,
      );
    }
  }
  // Правило для неучтённой строки называет её статус и требует измеренного количества.
  for (const rule of policy.ingredientIdentityRules.filter((item) => item.fromCanonicalIngredientId === null)) {
    assert.ok(["ignored_microcomponent", "ignored_noncaloric"].includes(rule.fromStatus), rule.sourceName);
    for (const id of rule.recipeIds) {
      const candidate = candidates.get(id);
      const item = (candidate.sourceIngredients ?? candidate.ingredients).find((row) => String(row.name).trim().toLowerCase() === rule.sourceName.toLowerCase());
      assert.ok(Number(item.amountMetric) > 0, `${id}: «${rule.sourceName}» is measured`);
    }
  }
  // Quarantined cards that name wholegrain penne keep the profile they had.
  for (const [id, name] of [["goodfood-power-packed-pasta-boxes", "wholemeal penne"], ["goodfood-salmon-pasta-salad-lemon-capers", "wholewheat penne"]]) {
    const candidate = candidates.get(id);
    assert.ok(candidate.miseProofreadQuarantine, `${id} is quarantined`);
    assert.equal((candidate.sourceIngredients ?? candidate.ingredients).find((item) => item.name === name)?.id, "pasta_raw", `${id}: «${name}» is unchanged`);
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
  // «zero-соусом» became «низкокалорийный соус без сахараом»: the case ending
  // of the replaced word must not stick to the end of the replacement phrase.
  const strandedCaseEndings = /сахараом|сахараа|без сахара[а-яё]/iu;
  const awkwardTemperatures = /\b(?:163|177|191|204|217|218|232)\s*°\s*C\b/iu;
  for (const recipe of catalog.recipes) {
    const text = userVisibleText(recipe);
    assert.doesNotMatch(text, forbiddenTerms, `${recipe.id}: glossary normalization reaches runtime`);
    assert.doesNotMatch(text, strandedCaseEndings, `${recipe.id}: glossary replacement keeps the Russian case`);
    assert.doesNotMatch(text, awkwardTemperatures, `${recipe.id}: oven temperature is rounded for execution`);
  }
  const boiledChicken = runtimeById.get("new-sandwich-boiled-chicken");
  assert.equal(boiledChicken.title, "Сэндвич с варёной курицей и низкокалорийным соусом без сахара");
  assert.ok(boiledChicken.packing.label.startsWith(`${boiledChicken.title} · `));
  for (const id of ["new-sandwich-boiled-chicken", "new-sandwich-smoked-chicken", "new-sandwich-turkey-ham", "new-sandwich-balyk"]) {
    assert.match(runtimeById.get(id).steps.at(-1), /15 г низкокалорийного соуса без сахара/u, `${id}: the sauce step is declined`);
  }
});

test("steak meal-prep card has a measured safe endpoint before chilling", () => {
  const recipe = runtimeById.get("goodfood-steak-broccoli-protein-pots");
  assert.ok(recipe);
  assert.match(recipe.steps.join(" "), /не менее 63 °C/iu);
  assert.match(recipe.steps.join(" "), /отдохнуть 3 минуты/iu);
});
