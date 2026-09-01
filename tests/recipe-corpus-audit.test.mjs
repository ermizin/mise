import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_REASON, auditIngredientStepGate, auditRecipeCorpus } from "../scripts/audit-recipe-corpus.mjs";

const report = await auditRecipeCorpus();

test("corpus audit emits one unique verdict for every imported candidate", () => {
  assert.equal(report.total, 255);
  assert.equal(report.verdicts.length, report.total);
  assert.equal(new Set(report.verdicts.map((item) => item.id)).size, report.total);
  assert.equal(report.counts.ready + report.counts.review_required + report.counts.blocked, report.total);
});

test("blocked recipes are never treated as production ready", () => {
  for (const item of report.verdicts) {
    assert.ok(["ready", "review_required", "blocked"].includes(item.verdict));
    if (item.verdict === "blocked") {
      assert.ok(item.reasons.length > 0, `${item.id} is auditable`);
      assert.ok(item.reasons.some((reason) => reason.severity === "blocked"), `${item.id} has a blocking reason`);
      assert.notEqual(item.verdict, "ready");
    }
    if (item.verdict === "ready") assert.equal(item.reasons.length, 0, `${item.id} has no hidden release flag`);
  }
});

test("audit retains only the active editorial exception flags after corpus completion", () => {
  const reasonCodes = new Set(report.verdicts.flatMap((item) => item.reasons.map((reason) => reason.code)));
  for (const code of [
    AUDIT_REASON.MISSING_YIELD, AUDIT_REASON.INVALID_YIELD, AUDIT_REASON.EXTREME_KCAL,
    AUDIT_REASON.NICHE_LOCALIZATION,
    AUDIT_REASON.PROCEDURE_REVIEW_REQUIRED,
  ]) assert.ok(reasonCodes.has(code), `reason code is exercised: ${code}`);
  assert.equal(reasonCodes.has(AUDIT_REASON.UNRESOLVED_INGREDIENT_MAPPING), false, "the completed corpus has no unresolved ingredient mappings");
  assert.equal(reasonCodes.has(AUDIT_REASON.MISSING_PARAPHRASED_INSTRUCTIONS), false, "every retained source card has an editorial procedure");
  assert.equal(reasonCodes.has(AUDIT_REASON.MISSING_INSTRUCTIONS), false, "all fixed source URLs have structured instruction facts");
  assert.equal(reasonCodes.has(AUDIT_REASON.MISSING_PARAPHRASED_INSTRUCTIONS), false, "every split recipe now has its own executable procedure");
  assert.equal(reasonCodes.has(AUDIT_REASON.LABEL_DEPENDENT_INGREDIENT), false, "brand or average packaged-product profiles are calculable");
});

test("ingredient-step gate uses source rows as primary ids and permits explicit aliases", () => {
  const result = auditIngredientStepGate({
    ingredients: [{ id: "rice_raw" }, { name: "chicken" }],
    paraphrasedInstructionDraft: [{ id: "step-1", text: "Сварите рис и приготовьте курицу.", ingredientIds: ["rice_raw", "source-ingredient-2"] }],
  });
  assert.deepEqual(result, { unknownIds: [], unusedSourceRows: [], vagueSteps: [], stateMismatches: [] });
});

test("ingredient-step gate blocks unknown, unreferenced, vague, and invalid state coverage", () => {
  const result = auditIngredientStepGate({
    ingredients: [{ id: "rice_raw", miseSourceStateConversion: { targetState: "raw", targetCanonicalIngredientId: "rice_raw" } }, { name: "chicken" }],
    paraphrasedInstructionDraft: [{ id: "step-1", text: "Смешайте компоненты ...", ingredientIds: ["unknown-product"] }],
  });
  assert.deepEqual(result.unknownIds, [{ stepId: "step-1", ingredientId: "unknown-product" }]);
  assert.deepEqual(result.unusedSourceRows, ["source-ingredient-1", "source-ingredient-2"]);
  assert.deepEqual(result.vagueSteps, ["step-1"]);
  assert.deepEqual(result.stateMismatches, [{ sourceId: "source-ingredient-1", expectedId: "rice_raw", actualId: "rice_raw" }]);
});
