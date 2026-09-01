import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSimpleHomeCandidates } from "../scripts/build-simple-home-candidates.mjs";
import { validateSimpleHomeDrafts } from "../scripts/validate-simple-home-drafts.mjs";

async function runtimeApproval() {
  return JSON.parse(await readFile(new URL("../data/simple-home-runtime-approval.json", import.meta.url), "utf8"));
}

test("simple-home production candidates are structurally ready for editorial import", async () => {
  const report = await validateSimpleHomeDrafts();
  assert.ok(report.count > 0);
  assert.equal(new Set(report.ids).size, report.count);
});

test("simple-home runtime candidates exactly match owner approval", async () => {
  const [report, approval] = await Promise.all([validateSimpleHomeDrafts(), runtimeApproval()]);
  const draftedIds = new Set(report.ids);
  assert.equal(report.count, 34);
  assert.deepEqual([...draftedIds].sort(), [...approval.approvedRecipeIds].sort());
  for (const id of approval.rejectedRecipeIds) assert.equal(draftedIds.has(id), false, `${id} was rejected by the owner`);
});

test("meatballs use ready-made chicken mince without requiring a grinder", async () => {
  const document = await buildSimpleHomeCandidates();
  const recipe = document.candidates.find((candidate) => candidate.id === "foodru-oblomov-meatballs");
  assert.ok(recipe);
  assert.equal(recipe.ingredients[0].id, "chicken_mince_raw");
  assert.equal(recipe.ingredients[0].displayNameRu, "Куриный фарш");
  assert.equal(recipe.ingredients[0].amountMetric, 750);
  assert.match(recipe.paraphrasedInstructionDraft[0].text, /смешайте куриный фарш/iu);
  assert.doesNotMatch(recipe.paraphrasedInstructionDraft[0].text, /мясоруб|измельч|пропустите/iu);
});
