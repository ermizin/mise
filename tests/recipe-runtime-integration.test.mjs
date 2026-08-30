import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeRuntimeIntegration } from "../scripts/audit-recipe-runtime-integration.mjs";

const report = await auditRecipeRuntimeIntegration();

test("runtime integration report admits only fully projected audit-ready cards", () => {
  assert.equal(report.schemaVersion, 2);
  assert.ok(report.releaseAuditCounts.ready >= 200);
  assert.equal(report.auditedReadyCards, report.runtimeReleaseableCards);
  assert.ok(report.runtimeReleaseableCards >= 200);
  assert.equal(report.recommendedReleaseBehavior, "runtime_projection_ready");
  assert.deepEqual(report.failureCounts, {});
  for (const card of report.cards) {
    assert.ok(card.recipeFamilyId);
    assert.ok(card.shoppingIngredientCount > 0);
    assert.ok(["source_preview", "graphic_fallback"].includes(card.media));
  }
});

test("checked-in runtime integration report exactly matches current source and release audit", async () => {
  const stored = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-integration-audit.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(stored, report);
});
