import assert from "node:assert/strict";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";
import { loadRecipeCorpusWithOverlays } from "../scripts/recipe-corpus-overlay.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const corpusWithOverlays = await loadRecipeCorpusWithOverlays();
const corpus = corpusWithOverlays.documents.find((document) => document.source === "The Meal Prep Manual");
assert.ok(corpus);
const audit = await auditRecipeRelease();
const readyIds = new Set(audit.cards.filter((card) => card.verdict === "ready").map((card) => card.id));
const ready = corpus.candidates.filter((candidate) => readyIds.has(candidate.id));
const blocked = corpus.candidates.filter((candidate) => audit.cards.some((card) => card.id === candidate.id && card.verdict === "blocked"));
const context = { publisher: "Meal Prep Manual", accessedAt: "2026-08-30" };
const families = ready.map((candidate) => ({ candidate, family: engine.deriveRecipeFamilyFromAuditedCandidate(candidate, context) }));

test("every audit-ready Meal Prep Manual card derives an honest Recipe Family", () => {
  assert.equal(ready.length + blocked.length, corpus.candidates.length, "every source card has a final release verdict");
  assert.ok(blocked.every((candidate) => audit.cards.find((card) => card.id === candidate.id)?.reasons.length), "excluded cards retain their audit evidence");
  const failures = families.filter(({ family }) => !family);
  assert.deepEqual(failures.map(({ candidate }) => candidate.id), []);
  for (const { candidate, family } of families) {
    assert.equal(family.reviewStatus, "pilot", candidate.id);
    assert.ok(family.ingredients.length >= 1, candidate.id);
    assert.equal(family.geometryLockedMax, Number(candidate.servings), candidate.id);
    assert.equal(family.editorialAudit.ingredientMapping.source, "raw_candidate", candidate.id);
    assert.ok(family.miseInstructions.length >= 2, candidate.id);
    assert.ok(family.maxViableCalories >= family.minViableCalories, candidate.id);
  }
});

test("derived families solve a representative reachable target or report a visible reason", () => {
  const failures = [];
  for (const { candidate, family } of families) {
    if (!family) continue;
    // The lower bound itself is a representative feasible target. A family is
    // allowed to have coarse ingredient steps, so the result may land above
    // the target while remaining inside the explicit +5% corridor.
    const target = family.minViableCalories;
    const solved = engine.solveRecipeFamily(family, { targetCalories: target });
    if (!solved.viable) failures.push(`${candidate.id}: ${solved.reason} (${solved.explanation.join("; ")})`);
    else {
      assert.ok(solved.nutrition.kcal >= target * 0.9, `${candidate.id}: ${solved.nutrition.kcal} is below -10% of ${target}`);
      assert.ok(solved.nutrition.kcal <= target * 1.05, `${candidate.id}: ${solved.nutrition.kcal} is above +5% of ${target}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("unsafe raw candidates never disappear silently", () => {
  const bad = { ...corpus.candidates[0], id: "broken-family", ingredients: [{ name: "unknown product", amountMetric: "100", unitMetric: "g" }] };
  assert.equal(engine.deriveRecipeFamilyFromAuditedCandidate(bad, context), null);
  assert.ok(engine.recipeFamilyDerivationIssues().some((issue) => issue.recipeId === "broken-family" && issue.source === "raw"));
});

test("household conversions and optional source items remain auditable", () => {
  const skillet = families.find(({ candidate }) => candidate.id === "tmpm-24608")?.family;
  assert.ok(skillet?.editorialAudit.ingredientMapping.inferredMeasurements?.some((item) => item.basis === "standard_imperial"));
  const noodles = families.find(({ candidate }) => candidate.id === "tmpm-28302")?.family;
  assert.deepEqual(Array.from(noodles?.editorialAudit.ingredientMapping.skippedOptionalSourceIngredients ?? []), ["lemon wedges"]);
});
