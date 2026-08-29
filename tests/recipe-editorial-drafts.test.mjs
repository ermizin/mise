import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildEditorialDataset, buildParaphrasedInstructionDraft, updateEditorialDraftDatasets } from "../scripts/build-recipe-editorial-drafts.mjs";
import { applyRecipeEditorialCards } from "../scripts/apply-recipe-editorial-cards.mjs";

function candidate(instructionFacts, overrides = {}) {
  return {
    id: "test-recipe",
    title: "Test recipe",
    servings: 4,
    ingredients: [{ name: "Chicken" }, { name: "Rice" }],
    instructionFacts,
    editorialStatus: "pending",
    ...overrides,
  };
}

function facts(...items) {
  return items.map((item, index) => ({ id: `source-step-${index + 1}`, order: index + 1, ...item }));
}

test("creates independent Russian oven steps using only extracted temperature, time and doneness", () => {
  const result = buildParaphrasedInstructionDraft(candidate(facts(
    { action: "preheat", actions: ["preheat"], temperatureC: [180], equipment: ["oven"] },
    { action: "mix", actions: ["mix"], equipment: ["mixing_bowl"] },
    { action: "bake", actions: ["bake"], temperatureC: [180], durationMinutes: [25], equipment: ["oven"], donenessCue: ["golden"] },
  )));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.draft[0].text, "Подготовьте ингредиенты из карточки на 4 порции.");
  assert.match(result.draft.at(-1).text, /Запекайте в духовке при 180°C в течение 25 мин до золотистой корочки\./);
  assert.ok(result.draft.every((step) => step.id && Array.isArray(step.ingredientIds) && Array.isArray(step.dependsOn)));
  assert.deepEqual(result.draft[1].dependsOn, ["editorial-step-1"]);
});

test("creates skillet and slow-cooker profiles without adding a temperature or duration", () => {
  const skillet = buildParaphrasedInstructionDraft(candidate(facts(
    { action: "heat", actions: ["heat"], equipment: ["skillet"] },
    { action: "saute", actions: ["saute"], durationMinutes: [8], equipment: ["skillet"], donenessCue: ["tender"] },
  )));
  assert.deepEqual(skillet.blockers, []);
  assert.match(skillet.draft.at(-1).text, /Обжарьте на сковороде в течение 8 мин до мягкости\./);
  assert.doesNotMatch(skillet.draft.at(-1).text, /°C/);

  const slowCooker = buildParaphrasedInstructionDraft(candidate(facts(
    { action: "combine", actions: ["combine"], equipment: ["mixing_bowl"] },
    { action: "transfer", actions: ["transfer"], equipment: ["slow_cooker"] },
    { action: "cook", actions: ["cook"], durationMinutes: [240], equipment: ["slow_cooker"], donenessCue: ["tender"] },
  )));
  assert.deepEqual(slowCooker.blockers, []);
  assert.match(slowCooker.draft.at(-1).text, /Готовьте в мультиварке в течение 240 мин до мягкости\./);
  assert.doesNotMatch(slowCooker.draft.at(-1).text, /°C/);
});

test("creates a no-cook profile from preparation and mixing facts", () => {
  const result = buildParaphrasedInstructionDraft(candidate(facts(
    { action: "chop", actions: ["chop"] },
    { action: "combine", actions: ["combine"], equipment: ["mixing_bowl"] },
    { action: "refrigerate", actions: ["refrigerate"], durationMinutes: [30] },
  ), { servings: 1 }));
  assert.deepEqual(result.blockers, []);
  assert.match(result.draft[1].text, /Нарежьте\./);
  assert.match(result.draft.at(-1).text, /Уберите в холодильник в течение 30 мин\./);
  assert.equal(result.draft[0].ingredientIds.length, 2);
});

test("returns explicit blockers instead of an invented recipe when facts are insufficient", () => {
  const result = buildParaphrasedInstructionDraft(candidate(facts(
    { actions: [] },
    { action: "preheat", actions: ["preheat"], equipment: ["oven"] },
    { action: "bake", actions: ["bake"], equipment: ["oven"] },
  ), { servings: undefined }));
  assert.deepEqual(result.draft, []);
  assert.ok(result.blockers.includes("missing_or_invalid_servings"));
  assert.ok(result.blockers.includes("source_step_1_missing_action"));
  assert.ok(result.blockers.includes("source_step_2_preheat_needs_temperature_and_equipment"));
  assert.ok(result.blockers.includes("source_step_3_thermal_action_needs_time_temperature_or_doneness"));
});

test("dataset builder preserves ids, count, candidate order and editorial status", () => {
  const source = {
    source: "fixture",
    candidates: [
      candidate(facts({ action: "mix", actions: ["mix"] })),
      candidate([], { id: "blocked", editorialStatus: "promoted" }),
    ],
  };
  const output = buildEditorialDataset(source);
  assert.deepEqual(output.dataset.candidates.map((item) => item.id), ["test-recipe", "blocked"]);
  assert.equal(output.dataset.candidates.length, source.candidates.length);
  assert.equal(output.dataset.candidates[1].editorialStatus, "promoted");
  assert.equal(output.dataset.candidates[0].paraphrasedInstructionDraft.length, 2);
  assert.deepEqual(output.summary.blocked, [{ id: "blocked", blockers: ["missing_instruction_facts"] }]);
});

test("dry run leaves both JSON files byte-identical and normal mode changes only drafts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recipe-editorial-test-"));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  const source = {
    source: "fixture",
    untouchedRootValue: true,
    candidates: [candidate(facts({ action: "mix", actions: ["mix"] }))],
  };
  const original = `${JSON.stringify(source, null, 2)}\n`;
  await Promise.all([writeFile(first, original), writeFile(second, original)]);
  const dry = await updateEditorialDraftDatasets([first, second], { dryRun: true });
  assert.equal(dry.drafted, 2);
  assert.equal(await readFile(first, "utf8"), original);

  const written = await updateEditorialDraftDatasets([first, second]);
  assert.equal(written.drafted, 2);
  const after = JSON.parse(await readFile(first, "utf8"));
  assert.equal(after.untouchedRootValue, true);
  assert.equal(after.candidates[0].id, "test-recipe");
  assert.equal(after.candidates[0].editorialStatus, "pending");
  assert.equal(after.candidates[0].paraphrasedInstructionDraft.length, 2);
});

test("all 217 applied editorial cards pass concrete-procedure validation", async () => {
  const report = await applyRecipeEditorialCards();
  assert.equal(report.total, 217);
  assert.equal(report.ready + report.reviewRequired, 217);
});
