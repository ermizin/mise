import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";

const report = await auditRecipeRelease();

test("release audit joins editorial and nutrition gates for all 217 cards", () => {
  assert.equal(report.total, 217);
  assert.equal(report.cards.length, 217);
  assert.equal(new Set(report.cards.map((card) => card.id)).size, 217);
  assert.equal(report.counts.ready + report.counts.review_required + report.counts.blocked, 217);
  for (const card of report.cards) {
    assert.ok(["ready", "review_required", "blocked"].includes(card.verdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.editorialVerdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.nutritionVerdict));
    if (card.verdict === "ready") {
      assert.equal(card.editorialVerdict, "ready");
      assert.equal(card.nutritionVerdict, "ready");
      assert.ok(card.calculatedNutrition);
    }
  }
});

test("release audit can persist the exact 217-card register atomically", async () => {
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
    assert.equal(report.total, 217);
    assert.equal(report.cards.length, 217);
    assert.equal(new Set(report.cards.map((card) => card.id)).size, 217);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
