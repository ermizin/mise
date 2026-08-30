import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { auditNutritionEntry } from "../scripts/audit-recipe-nutrition.mjs";
import { applyGoodFoodRehabilitation } from "../scripts/apply-goodfood-rehabilitation.mjs";
import { normalizeRawRecipeCandidate } from "../domain/recipe-engine.ts";

const cwd = process.cwd();
const readJson = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then(JSON.parse);

test("Good Food rehabilitation repairs complete, measured production baselines without touching imports", async () => {
  const [source, registry] = await Promise.all([
    readJson("data/goodfood-candidates.json"),
    readJson("data/goodfood-rehabilitation.json"),
  ]);
  assert.ok(registry.recipes.length >= 80, "the lane must provide an 80-card production-ready Good Food basis after the shared policy resolves label profiles");

  const { document, reports } = await applyGoodFoodRehabilitation({ cwd, document: source, registry });
  assert.equal(reports.length, registry.recipes.length);
  assert.deepEqual(reports.filter((report) => report.nutritionVerdict === "blocked"), []);

  const originals = new Map(source.candidates.map((candidate) => [candidate.id, candidate]));
  for (const record of registry.recipes) {
    const candidate = document.candidates.find((item) => item.id === record.id);
    assert.ok(candidate, `${record.id} is present in generated corpus`);
    assert.equal(candidate.proceduralStatus, "ready", `${record.id} has executable procedure`);
    assert.deepEqual(candidate.proceduralBlockers, [], `${record.id} has no unresolved external procedure`);
    assert.ok(Array.isArray(candidate.sourceIngredients) && candidate.sourceIngredients.length >= 3, `${record.id} has a measured source baseline`);
    assert.deepEqual(candidate.sourceNutrition, originals.get(record.id).macros, `${record.id} preserves publisher nutrition separately`);
    assert.ok(candidate.macros.kcal >= 150 && candidate.macros.kcal <= 800, `${record.id} uses a practical Mise portion`);
    const normalized = normalizeRawRecipeCandidate(candidate, { publisher: source.source, accessedAt: source.importedAt });
    assert.equal(normalized.ingredientMappings.some((mapping) => mapping.status === "unresolved"), false, `${record.id} has no unresolved ingredients`);
    const audit = auditNutritionEntry(candidate, { publisher: source.source, accessedAt: source.importedAt });
    assert.equal(audit.calculationComplete, true, `${record.id} is independently calculable`);
    assert.equal(audit.reasons.some((reason) => reason.severity === "blocked"), false, `${record.id} has no nutrition block`);
  }
});

test("Good Food composite dishes embed measured component substitutions", async () => {
  const [source, registry] = await Promise.all([
    readJson("data/goodfood-candidates.json"),
    readJson("data/goodfood-rehabilitation.json"),
  ]);
  const { document } = await applyGoodFoodRehabilitation({ cwd, document: source, registry });
  for (const record of registry.recipes.filter((item) => item.components?.length)) {
    const candidate = document.candidates.find((item) => item.id === record.id);
    assert.ok(candidate.sourceIngredients.every((ingredient) => !/see (?:recipe|['"]complete)/i.test(String(ingredient.original))), `${record.id} embeds rather than references an external component`);
  }
});
