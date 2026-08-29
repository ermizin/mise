import assert from "node:assert/strict";
import test from "node:test";
import { applyRecipeReviewResolutions, validateRecipeReviewResolutions } from "../scripts/recipe-review-decisions.mjs";

const report = {
  schemaVersion: 1,
  total: 2,
  counts: { ready: 0, review_required: 1, blocked: 1 },
  reasonCounts: {},
  cards: [
    { id: "a", verdict: "blocked", reasons: [{ gate: "editorial", code: "procedure_review_required", severity: "blocked" }] },
    { id: "b", verdict: "review_required", reasons: [{ gate: "nutrition", code: "label_required", severity: "review_required" }] },
  ],
};
const resolutions = {
  schemaVersion: 1,
  sourceExport: { schemaVersion: 1 },
  exclusions: [{ id: "a", note: "out of scope" }],
  resolvedReasons: [{ id: "b", gate: "nutrition", code: "label_required", resolution: "verified label" }],
  decisions: [],
};

test("resolution overlay excludes cards and retains resolved reasons separately", () => {
  const result = applyRecipeReviewResolutions(report, resolutions);
  assert.deepEqual(result.counts, { ready: 1, review_required: 0, blocked: 0, excluded: 1 });
  assert.equal(result.cards[0].verdict, "excluded");
  assert.equal(result.cards[1].verdict, "ready");
  assert.deepEqual(result.cards[1].reasons, []);
  assert.equal(result.cards[1].resolvedReasons[0].resolution, "verified label");
});

test("resolution overlay rejects unknown and duplicate targets", () => {
  assert.throws(() => validateRecipeReviewResolutions({ ...resolutions, exclusions: [{ id: "missing" }] }, report.cards), /unknown recipe id/);
  assert.throws(() => validateRecipeReviewResolutions({ ...resolutions, resolvedReasons: [resolutions.resolvedReasons[0], resolutions.resolvedReasons[0]] }, report.cards), /duplicated/);
});
