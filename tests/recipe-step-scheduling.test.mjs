import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));

test("curated step scheduling profiles remain exact annotations of active runtime recipes", async () => {
  const [catalog, scheduling] = await Promise.all([
    readJson("data/recipe-runtime-catalog.json"),
    readJson("data/recipe-step-scheduling.json"),
  ]);
  const revision = "bc8049971a7e2a5a73d6bef166e705bd1aab5351";

  assert.equal(scheduling.schemaVersion, 1);
  assert.deepEqual(
    scheduling.profiles.map((profile) => profile.recipeId),
    [
      "new-home-buckwheat-legs",
      "tmpm-23462",
      "tmpm-25006-avocado-bean-rice-cakes",
    ],
  );

  for (const profile of scheduling.profiles) {
    const recipe = catalog.recipes.find((candidate) => candidate.id === profile.recipeId);
    assert.ok(recipe, `${profile.recipeId}: active runtime recipe`);
    assert.equal(profile.methodId, "original");
    assert.equal(profile.sourceRevision, revision);
    assert.match(profile.provenance, new RegExp(revision));
    assert.match(profile.provenance, /agent review.*stored editorial instructions/iu);
    assert.match(profile.provenance, /active minutes are estimates.*no kitchen validation/iu);
    assert.ok(Number.isFinite(profile.measurementMinutes) && profile.measurementMinutes > 0);

    const method = recipe.equipmentOptions?.find(
      (candidate) => candidate.id === profile.methodId,
    );
    assert.ok(method, `${profile.recipeId}: selected original method exists`);
    assert.deepEqual(profile.requiredEquipment, method.requiredEquipment);

    const sourceSteps = (recipe.recipeFamily?.miseInstructions ?? []).filter(
      (step) => step.action !== "measure",
    );
    assert.equal(profile.steps.length, sourceSteps.length, `${profile.recipeId}: no source steps omitted`);
    assert.deepEqual(
      profile.steps.map((step) => step.sourceStepId),
      sourceSteps.map((step) => step.id),
      `${profile.recipeId}: source IDs and order are exact`,
    );
    assert.deepEqual(
      profile.steps.map((step) => step.text),
      sourceSteps.map((step) => step.text),
      `${profile.recipeId}: source text remains exact`,
    );

    for (const [index, step] of profile.steps.entries()) {
      assert.ok(Number.isFinite(step.activeMinutes) && step.activeMinutes > 0);
      assert.ok(Number.isFinite(step.waitMinutes) && step.waitMinutes >= 0);
      assert.ok(Number.isFinite(step.resumeMinutes) && step.resumeMinutes >= 0);
      assert.deepEqual(
        step.dependsOn,
        index === 0 ? [] : [profile.steps[index - 1].sourceStepId],
        `${profile.recipeId}/${step.sourceStepId}: annotation stays linear`,
      );
      const measureIds = new Set(recipe.recipeFamily.miseInstructions.filter(item => item.action === "measure").map(item => item.id));
      assert.deepEqual(
        sourceSteps[index].dependsOn.filter(id => !measureIds.has(id)),
        step.dependsOn,
        `${profile.recipeId}/${step.sourceStepId}: source dependencies have not drifted`,
      );
      assert.equal("action" in step, false, "never inherit an action tag from a split source step");
      if (step.waitMinutes > 0) {
        assert.match(step.waitBasis ?? "", /stored instruction explicitly says/iu);
        assert.ok(step.resumeMinutes > 0, "a wait must reserve a positive return/check interval");
      } else {
        assert.equal(step.resumeMinutes, 0);
        assert.equal(step.waitBasis, undefined);
      }
    }
  }
});
