import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";

const [report, corpus, policy] = await Promise.all([
  auditRecipeRelease(),
  readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/mealprep-release-policy.json", import.meta.url), "utf8").then(JSON.parse),
]);
const mealPrepIds = new Set(corpus.candidates.map((candidate) => candidate.id));
const mealPrepCards = report.cards.filter((card) => mealPrepIds.has(card.id));

test("Meal Prep Manual release policy classifies every current source card without hiding audit evidence", () => {
  assert.equal(mealPrepCards.length, corpus.candidates.length);
  const counts = mealPrepCards.reduce(
    (result, card) => ({ ...result, [card.verdict]: (result[card.verdict] ?? 0) + 1 }),
    {},
  );
  assert.equal(Object.values(counts).reduce((total, count) => total + count, 0), corpus.candidates.length);
  assert.ok((counts.ready ?? 0) >= 120);
  assert.ok(mealPrepCards.filter((card) => card.verdict !== "ready").every((card) => card.reasons.length > 0));
  const informationalDeltas = mealPrepCards.flatMap((card) => card.reasons)
    .filter((reason) => reason.code === "nutrition_delta_outside_tolerance");
  assert.ok(informationalDeltas.length > 0);
  assert.ok(informationalDeltas.every((reason) => reason.severity === "info"));
  const labelWarnings = mealPrepCards.flatMap((card) => card.reasons)
    .filter((reason) => reason.code === "label_required");
  assert.ok(policy.labelProfiles.canonicalIds.length > 0);
  assert.ok(labelWarnings.every((reason) => reason.severity === "info" && reason.detail.policy === "editorial_average_with_check_label"));
});

test("every extreme source serving has a concrete Mise adaptation", () => {
  const extreme = corpus.candidates.filter((candidate) => candidate.macros && (candidate.macros.kcal < 150 || candidate.macros.kcal > 800));
  assert.ok(Object.keys(policy.servingAdaptations).every((id) => mealPrepIds.has(id)));
  for (const candidate of extreme) {
    const adaptation = policy.servingAdaptations[candidate.id];
    assert.ok(adaptation?.miseServing && adaptation?.reason, `${candidate.id} documents its Mise serving`);
  }
});

test("two source mirin substitutions are distributed into auditable measured replacement ingredients", () => {
  for (const id of ["tmpm-28247", "tmpm-22884"]) {
    const candidate = corpus.candidates.find((item) => item.id === id);
    assert.equal(candidate.miseAdaptation?.kind, "distributed_ingredient_replacement");
    assert.ok(candidate.ingredients.some((ingredient) => ingredient.name === "white vinegar" && Number(ingredient.amountMetric) > 0));
    assert.ok(candidate.ingredients.some((ingredient) => ingredient.name === "brown sugar" && Number(ingredient.amountMetric) > 0));
    assert.ok(!candidate.ingredients.some((ingredient) => ingredient.name === "mirin"));
  }
});
