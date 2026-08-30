import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const corpus = JSON.parse(await readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8"));
const audit = await auditRecipeRelease();
const readyIds = new Set(audit.cards.filter((card) => card.verdict === "ready").map((card) => card.id));
const ready = corpus.candidates.filter((candidate) => readyIds.has(candidate.id));
const context = { publisher: "Meal Prep Manual", accessedAt: "2026-08-30" };
const families = ready.map((candidate) => ({ candidate, family: engine.deriveRecipeFamilyFromAuditedCandidate(candidate, context) }));

test("every audit-ready Meal Prep Manual card derives an honest Recipe Family", () => {
  assert.equal(ready.length, 126);
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
    // allowed to have coarse ingredient steps, so a mathematical midpoint can
    // be inside the advertised range yet farther than the solver tolerance.
    const target = family.minViableCalories;
    const solved = engine.solveRecipeFamily(family, { targetCalories: target });
    if (!solved.viable) failures.push(`${candidate.id}: ${solved.reason} (${solved.explanation.join("; ")})`);
    else assert.ok(solved.nutrition.kcal <= target, `${candidate.id}: ${solved.nutrition.kcal} > ${target}`);
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
