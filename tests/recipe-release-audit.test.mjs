import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { auditRecipeRelease } from "../scripts/audit-recipe-release.mjs";
import { RESOLUTION_VERDICTS } from "../scripts/recipe-review-decisions.mjs";

const report = await auditRecipeRelease();

test("release audit joins editorial and nutrition gates for every card", () => {
  assert.equal(report.total, report.cards.length);
  assert.equal(new Set(report.cards.map((card) => card.id)).size, report.total);
  assert.equal(RESOLUTION_VERDICTS.reduce((total, verdict) => total + report.counts[verdict], 0), report.total);
  for (const card of report.cards) {
    assert.ok(RESOLUTION_VERDICTS.includes(card.verdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.editorialVerdict));
    assert.ok(["ready", "review_required", "blocked"].includes(card.nutritionVerdict));
    if (card.verdict === "ready") {
      assert.equal(card.reasons.filter((reason) => reason.severity !== "info").length, 0);
    }
  }
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
