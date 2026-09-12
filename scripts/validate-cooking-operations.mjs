import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import manifest from "../data/cooking-operations.json" with { type: "json" };
import runtime from "../data/recipe-runtime-catalog.json" with { type: "json" };

const recipes = runtime.recipes ?? runtime.items ?? runtime;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fingerprint = (source, methodId) => ({
  steps: source.steps,
  ingredients: source.recipeFamily.ingredients.map(({ sourceIngredientId, canonicalIngredientId, baseAmount, unit }) => ({ sourceIngredientId, canonicalIngredientId, baseAmount, unit })),
  method: source.equipmentOptions.find((method) => method.id === methodId),
});

assert.equal(manifest.version, 4, "manifest must use reviewed v4 schema");
for (const recipe of manifest.recipes) {
  const source = recipes.find((item) => item.id === recipe.recipeId);
  assert.ok(source, `unknown runtime recipe ${recipe.recipeId}`);
  assert.ok(recipe.reviewed && recipe.capacityResourceId, `unreviewed or unbounded recipe ${recipe.recipeId}`);
  assert.ok(source.equipmentOptions?.some((method) => method.id === recipe.methodId), `unknown method ${recipe.recipeId}:${recipe.methodId}`);
  assert.equal(hash(source.steps), recipe.sourceStepsChecksum, `source step drift: ${recipe.recipeId}`);
  assert.equal(hash(fingerprint(source, recipe.methodId)), recipe.sourceFingerprint, `source ingredient/method drift: ${recipe.recipeId}`);
  assert.deepEqual(recipe.sourceDefinition, fingerprint(source, recipe.methodId), `source definition drift: ${recipe.recipeId}`);
  for (const [index, quote] of recipe.reviewEvidence) assert.ok(source.steps[index]?.includes(quote), `review citation drift: ${recipe.recipeId}:${index}`);
  const keys = new Set(recipe.operations.map((operation) => operation.key));
  const coveredSteps = new Set();
  for (const operation of recipe.operations) {
    assert.ok(operation.key && operation.title && (operation.durationSeconds > 0 || operation.unknownDuration === true && operation.timeInputBeforeCreate === true) && operation.resources?.length, `incomplete operation ${recipe.recipeId}:${operation.key}`);
    assert.ok((operation.dependsOn ?? []).every((key) => keys.has(key)), `missing dependency ${recipe.recipeId}:${operation.key}`);
    assert.ok(operation.sourceStepIndexes?.every((index) => Number.isInteger(index) && index >= 0 && index < source.steps.length), `bad source step ${recipe.recipeId}:${operation.key}`);
    for (const index of operation.sourceStepIndexes) coveredSteps.add(index);
    for (const [index, quote] of operation.sourceCitations ?? []) assert.ok(source.steps[index]?.includes(quote), `citation is not source text: ${recipe.recipeId}:${operation.key}`);
    assert.deepEqual(operation.allocationSourceIngredientIds ?? [], recipe.ingredientTrace.filter(([, , key]) => key === operation.key).map(([sourceIngredientId]) => sourceIngredientId), `addressable allocation drift: ${recipe.recipeId}:${operation.key}`);
    for (const hold of operation.resourceHolds ?? []) {
      const release = recipe.operations.find((candidate) => candidate.key === hold.releaseAfterOpId);
      assert.ok(release, `hold lacks release operation: ${recipe.recipeId}:${operation.key}`);
      assert.ok(release.kind === "unload" || release.kind === "wash", `cookware hold must release through unload/wash: ${recipe.recipeId}:${operation.key}`);
    }
    if (operation.estimatedActive) assert.equal(operation.attention, "required", `estimate must require cook attention: ${recipe.recipeId}:${operation.key}`);
    if (operation.kind === "heat" && operation.attention === "background" && operation.requiresCheckAtEnd) {
      assert.equal(operation.checkDeadlineSeconds, 0, `background heat must have immediate check deadline: ${recipe.recipeId}:${operation.key}`);
      const next = recipe.operations.filter((candidate) => (candidate.dependsOn ?? []).includes(operation.key));
      assert.ok(next.some((candidate) => candidate.kind === "intervention"), `background heat needs immediate intervention: ${recipe.recipeId}:${operation.key}`);
    }
    if (operation.kind === "heat" && !operation.estimatedActive) assert.ok(operation.sourceCitations.some(([, quote]) => /\d+/.test(quote)), `unlabelled thermal duration: ${recipe.recipeId}:${operation.key}`);
  }
  assert.deepEqual([...coveredSteps].sort(), source.steps.map((_, index) => index), `original step lost: ${recipe.recipeId}`);
  const visiting = new Set(); const done = new Set();
  const visit = (key) => { assert.ok(!visiting.has(key), `dependency cycle: ${recipe.recipeId}`); if (done.has(key)) return; visiting.add(key); for (const dependency of recipe.operations.find((item) => item.key === key).dependsOn ?? []) visit(dependency); visiting.delete(key); done.add(key); };
  for (const key of keys) visit(key);
  const expectedIngredients = source.recipeFamily.ingredients.map((ingredient) => `${ingredient.sourceIngredientId}:${ingredient.canonicalIngredientId}`).sort();
  const traced = recipe.ingredientTrace.map(([sourceId, canonicalId, operationKey]) => { assert.ok(keys.has(operationKey), `trace targets missing operation: ${recipe.recipeId}`); return `${sourceId}:${canonicalId}`; }).sort();
  assert.deepEqual(traced, expectedIngredients, `ingredient trace has duplicate or lost mapped ingredient: ${recipe.recipeId}`);
  for (const load of recipe.cookingLoads) {
    assert.ok(["g", "ml"].includes(load.unit), `cooking load must be verified grams: ${recipe.recipeId}:${load.operationKey}`);
    assert.ok(keys.has(load.operationKey), `load targets missing operation: ${recipe.recipeId}`);
    assert.ok(Array.isArray(load.sourceIngredientIds) && load.sourceIngredientIds.length, `load needs addressed source ingredients: ${recipe.recipeId}:${load.operationKey}`);
    assert.equal("ingredientIds" in load, false, `legacy canonical ingredient load is forbidden: ${recipe.recipeId}:${load.operationKey}`);
    for (const sourceIngredientId of load.sourceIngredientIds) assert.ok(source.recipeFamily.ingredients.some((ingredient) => ingredient.sourceIngredientId === sourceIngredientId && ingredient.unit === load.unit), `load source unit does not match runtime: ${recipe.recipeId}:${sourceIngredientId}`);
  }
  const reaches = (from, target, seen = new Set()) => from === target || (!seen.has(from) && (seen.add(from), (recipe.operations.find((operation) => operation.key === from)?.dependsOn ?? []).some((dependency) => reaches(dependency, target, seen))));
  for (const raw of recipe.operations.filter((operation) => operation.rawMeat)) assert.ok(recipe.operations.some((operation) => operation.kind === "wash" && reaches(operation.key, raw.key)), `raw-meat operation needs wash: ${recipe.recipeId}`);
}
console.log(`validated ${manifest.recipes.length} reviewed cooking-operation manifests`);
