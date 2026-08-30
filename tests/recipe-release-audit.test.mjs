import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";
import { applyOwnerRecipeResolutions, loadOwnerRecipeResolutions } from "../scripts/recipe-owner-resolutions.mjs";

const RELEASE_VERDICTS = ["ready", "review_required", "blocked"];

const report = await auditRecipeRelease();

test("release audit joins editorial and nutrition gates for every card", () => {
  assert.equal(report.total, report.cards.length);
  assert.equal(new Set(report.cards.map((card) => card.id)).size, report.total);
  assert.equal(RELEASE_VERDICTS.reduce((total, verdict) => total + report.counts[verdict], 0), report.total);
  for (const card of report.cards) {
    assert.ok(RELEASE_VERDICTS.includes(card.verdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.editorialVerdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.nutritionVerdict));
    if (card.verdict === "ready") {
      assert.ok(card.calculatedNutrition);
      assert.equal(card.reasons.some((reason) => reason.severity !== "info"), false, `${card.id} has no unresolved release reason`);
    }
  }
});

test("checked-in release audit is the exact current gate output", async () => {
  const stored = JSON.parse(
    await readFile(new URL("../data/recipe-release-audit.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(stored, report);
  assert.ok(report.counts.ready >= 200, "the public catalog gate requires at least 200 ready cards");
});

test("owner resolutions remove only their exact reviewed reason", async () => {
  const registry = await loadOwnerRecipeResolutions();
  const result = applyOwnerRecipeResolutions({
    cards: [{
      id: "tmpm-26746",
      reasons: [
        { gate: "editorial", code: "niche_localization", severity: "review_required" },
        { gate: "nutrition", code: "label_required", severity: "review_required" },
      ],
    }],
  }, registry);
  assert.equal(result.cards[0].verdict, "review_required");
  assert.deepEqual(result.cards[0].resolvedReasons.map((reason) => reason.code), ["niche_localization"]);
  assert.deepEqual(result.cards[0].reasons.map((reason) => reason.code), ["label_required"]);
});

test("release audit can persist the complete register atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mise-release-audit-"));
  const output = join(directory, "audit.json");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/audit-recipe-release.mjs", "--output", output], {
        cwd: new URL("..", import.meta.url),
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.total, report.cards.length);
    assert.equal(new Set(report.cards.map((card) => card.id)).size, report.total);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
