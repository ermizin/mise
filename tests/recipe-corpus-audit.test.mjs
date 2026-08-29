import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_REASON, auditRecipeCorpus } from "../scripts/audit-recipe-corpus.mjs";

const report = await auditRecipeCorpus();

test("corpus audit emits one unique verdict for every imported candidate", () => {
  assert.equal(report.total, 217);
  assert.equal(report.verdicts.length, 217);
  assert.equal(new Set(report.verdicts.map((item) => item.id)).size, 217);
  assert.equal(report.counts.ready + report.counts.review_required + report.counts.blocked, 217);
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

test("audit keeps required editorial exception flags machine-readable", () => {
  const reasonCodes = new Set(report.verdicts.flatMap((item) => item.reasons.map((reason) => reason.code)));
  for (const code of [
    AUDIT_REASON.MISSING_YIELD, AUDIT_REASON.INVALID_YIELD, AUDIT_REASON.EXTREME_KCAL,
    AUDIT_REASON.UNRESOLVED_INGREDIENT_MAPPING,
    AUDIT_REASON.MISSING_PARAPHRASED_INSTRUCTIONS, AUDIT_REASON.FRACTIONAL_SERVINGS,
    AUDIT_REASON.LABEL_DEPENDENT_INGREDIENT, AUDIT_REASON.NICHE_LOCALIZATION,
  ]) assert.ok(reasonCodes.has(code), `reason code is exercised: ${code}`);
  assert.equal(reasonCodes.has(AUDIT_REASON.MISSING_INSTRUCTIONS), false, "all fixed source URLs have structured instruction facts");
});
