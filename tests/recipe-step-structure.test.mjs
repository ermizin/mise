import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeSteps } from "../scripts/audit-recipe-steps.mjs";
import { splitInstructionSentences } from "../scripts/recipe-equipment.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const report = await auditRecipeSteps();

/* Деление на шаги, вычитка 2026-10. Пороги пока мягкие: это потолок
   текущих данных, чтобы новые правки не делали шаги хуже, пока редакторы
   разбивают карточки из списка `node scripts/audit-recipe-steps.mjs --problems`.
   TODO после редактуры заменить на жёсткие пороги:
   - ни одного ready-рецепта с 1 шагом при ≥ 3 предложениях;
   - ни одного шага длиннее 400 знаков;
   - ни одного шага с 5 и более предложениями. */
const STEP_PROBLEM_CEILING = {
  one_step: 68,
  step_over_400: 27,
  four_plus_sentences: 88,
  two_steps_over_500: 22,
};
const MAX_STEP_LENGTH_CEILING = 600;
const MAX_SENTENCES_CEILING = 6;

test("step audit covers every ready runtime recipe and says where its steps are edited", () => {
  assert.equal(report.summary.readyRecipes, catalog.recipes.length);
  assert.equal(report.recipes.length, catalog.recipes.length);
  for (const row of report.recipes) {
    assert.notEqual(row.editVia, "unknown", `${row.id}: step text has a known editing location`);
    if (row.editVia === "editorial_card" || row.editVia === "editorial_card_with_positional_overlay") {
      assert.match(row.file, /^cards-[abc]\.json$/u);
      assert.ok(Number.isInteger(row.index) && row.index >= 0, `${row.id}: card index`);
    }
  }
});

test("step audit counts sentences with the equipment gate splitter", () => {
  for (const recipe of catalog.recipes) {
    const row = report.recipes.find((item) => item.id === recipe.id);
    assert.deepEqual(row.stepSentences, recipe.steps.map((step) => splitInstructionSentences(step).length), recipe.id);
    assert.deepEqual(row.stepLengths, recipe.steps.map((step) => step.length), recipe.id);
  }
});

test("step granularity does not get worse than the 2026-10-19 baseline", () => {
  for (const [flag, ceiling] of Object.entries(STEP_PROBLEM_CEILING)) {
    assert.ok((report.summary.byFlag[flag] ?? 0) <= ceiling, `${flag}: ${report.summary.byFlag[flag]} > ${ceiling}`);
  }
  for (const row of report.recipes) {
    assert.ok(row.maxLength <= MAX_STEP_LENGTH_CEILING, `${row.id}: step of ${row.maxLength} characters`);
    assert.ok(row.maxSentences <= MAX_SENTENCES_CEILING, `${row.id}: step of ${row.maxSentences} sentences`);
  }
});

test("chef patches find their step by text, so a sentence-boundary split keeps them", async () => {
  const { findStepByAnchor } = await import("../scripts/apply-recipe-proofread-policy.mjs");
  const { loadRecipeCorpusWithOverlays, recipeCorpusDatasetPaths } = await import("../scripts/recipe-corpus-overlay.mjs");
  const { matchesEquipmentInstructionFingerprint, recipeEquipmentEntry } = await import("../scripts/recipe-equipment.mjs");
  const draft = [{ id: "a", text: "Обжарьте лук. Добавьте соль." }, { id: "b", text: "Добавьте соль и перец." }];
  assert.equal(findStepByAnchor(draft, "Обжарьте лук", "test").id, "a");
  assert.throws(() => findStepByAnchor(draft, "Добавьте соль", "test"), /matches 2 steps/u);
  assert.throws(() => findStepByAnchor(draft, "Запеките", "test"), /matches 0 steps/u);

  const id = "goodfood-slow-cooker-beef-bourguignon";
  const rawDocuments = await Promise.all(recipeCorpusDatasetPaths.map(async (path) =>
    JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))));
  const candidate = rawDocuments.flatMap((document) => document.candidates).find((item) => item.id === id);
  const [step] = candidate.paraphrasedInstructionDraft;
  const sentences = splitInstructionSentences(step.text);
  assert.equal(sentences.length, 5);
  candidate.paraphrasedInstructionDraft = [[0, 1], [2], [3], [4]].map((group, index) => ({
    ...step,
    id: `editorial-step-${index + 1}`,
    text: group.map((sentence) => sentences[sentence]).join(" "),
    dependsOn: index ? [`editorial-step-${index}`] : [],
  }));
  const { documents } = await loadRecipeCorpusWithOverlays({ rawDocuments });
  const split = documents.flatMap((document) => document.candidates).find((item) => item.id === id);
  const runtime = catalog.recipes.find((recipe) => recipe.id === id);
  const texts = split.paraphrasedInstructionDraft.map((item) => item.text);
  assert.equal(texts.length, 4);
  assert.match(texts[3], /^За 35 минут до подачи.+За 25 минут до подачи очистите картофель/u);
  assert.equal(texts.join(" "), runtime.steps.join(" "));
  assert.ok(matchesEquipmentInstructionFingerprint(recipeEquipmentEntry(id).sourceStepsSha256, texts));
});
