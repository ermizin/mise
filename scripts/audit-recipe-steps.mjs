/* Аудит деления на шаги у ready-рецептов runtime-каталога.

   node scripts/audit-recipe-steps.mjs [--problems] [--ids id,id] [--json] [--output file.json]

   Для каждой карточки: число шагов, самый длинный шаг, наибольшее число
   предложений в шаге (той же функцией, что equipment gate) и флаги проблем:
   1 шаг; шаг > 400 знаков; ≥ 4 предложений в шаге; ≤ 2 шагов при > 500 знаков.
   Колонка «где править» говорит, в каком файле лежит текст шагов: карточки
   cards-a/b/c (индекс — позиция в массиве файла, с нуля), сборщик «Простых и
   домашних» или поварская правка, которая заменяет драфт целиком. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chefDraftReplacementRecipeIds } from "./apply-recipe-proofread-policy.mjs";
import { positionalStepOverlayRecipeIds } from "./recipe-corpus-overlay.mjs";
import {
  RUNTIME_CATALOG_PATH,
  SIMPLE_HOME_CANDIDATE_PATH,
  STEP_PROBLEM_FLAGS,
  STEP_PROBLEM_LIMITS,
  loadEditorialCards,
  optionValue,
  parseIdList,
  readJson,
  stepMetrics,
} from "./recipe-editorial-steps.mjs";

function editLocation(id, cardEntry, simpleHomeIndex) {
  if (chefDraftReplacementRecipeIds.includes(id)) {
    return { file: "apply-recipe-proofread-policy.mjs", index: null, editVia: "chef_patch_replaces_draft" };
  }
  if (cardEntry) {
    return {
      file: cardEntry.file,
      index: cardEntry.index,
      editVia: positionalStepOverlayRecipeIds.includes(id) ? "editorial_card_with_positional_overlay" : "editorial_card",
    };
  }
  if (simpleHomeIndex >= 0) {
    return { file: "build-simple-home-candidates.mjs", index: simpleHomeIndex, editVia: "simple_home_builder" };
  }
  return { file: null, index: null, editVia: "unknown" };
}

export async function auditRecipeSteps({ cwd = process.cwd(), ids = null, problemsOnly = false } = {}) {
  const [catalog, simpleHome, { entries: cards }] = await Promise.all([
    readJson(cwd, RUNTIME_CATALOG_PATH),
    readJson(cwd, SIMPLE_HOME_CANDIDATE_PATH),
    loadEditorialCards(cwd),
  ]);
  const cardsById = new Map(cards.map((entry) => [entry.card.id, entry]));
  const simpleHomeIds = simpleHome.candidates.map((candidate) => candidate.id);
  const runtimeById = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  if (ids) {
    const unknown = ids.filter((id) => !runtimeById.has(id));
    if (unknown.length) throw new Error(`Not ready runtime recipes: ${unknown.join(", ")}`);
  }
  const rows = catalog.recipes
    .filter((recipe) => !ids || ids.includes(recipe.id))
    .map((recipe) => {
      const cardEntry = cardsById.get(recipe.id);
      const metrics = stepMetrics(recipe.steps);
      const location = editLocation(recipe.id, cardEntry, simpleHomeIds.indexOf(recipe.id));
      return {
        id: recipe.id,
        title: recipe.title,
        ...location,
        cardSteps: cardEntry ? cardEntry.card.paraphrasedInstructionDraft.length : null,
        runtimeSteps: metrics.steps,
        maxLength: metrics.maxLength,
        maxSentences: metrics.maxSentences,
        totalLength: metrics.totalLength,
        stepLengths: metrics.lengths,
        stepSentences: metrics.sentences,
        flags: metrics.flags,
      };
    });
  const fileOrder = ["cards-a.json", "cards-b.json", "cards-c.json", "build-simple-home-candidates.mjs", "apply-recipe-proofread-policy.mjs"];
  rows.sort((left, right) =>
    fileOrder.indexOf(left.file) - fileOrder.indexOf(right.file) ||
    (left.index ?? 0) - (right.index ?? 0) ||
    left.id.localeCompare(right.id),
  );
  const problems = rows.filter((row) => row.flags.length);
  const countBy = (list, key) => list.reduce((counts, row) => {
    for (const value of [row[key]].flat()) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: 1,
    source: RUNTIME_CATALOG_PATH,
    limits: STEP_PROBLEM_LIMITS,
    flags: STEP_PROBLEM_FLAGS,
    summary: {
      readyRecipes: rows.length,
      problemRecipes: problems.length,
      byFlag: countBy(problems, "flags"),
      byFile: countBy(problems, "file"),
      runtimeStepsHistogram: countBy(rows, "runtimeSteps"),
    },
    recipes: problemsOnly ? problems : rows,
  };
}

export function formatRecipeStepTable(report) {
  const header = ["файл", "индекс", "id", "шаги (карта/runtime)", "макс. знаков", "макс. предл.", "всего знаков", "флаги"];
  const lines = report.recipes.map((row) => [
    row.file ?? "—",
    row.index ?? "—",
    row.id,
    `${row.cardSteps ?? "—"}/${row.runtimeSteps}`,
    row.maxLength,
    row.maxSentences,
    row.totalLength,
    row.flags.join(", ") || "—",
  ].map(String));
  const widths = header.map((title, column) => Math.max(title.length, ...lines.map((line) => line[column].length)));
  const render = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd();
  return [
    render(header),
    render(widths.map((width) => "-".repeat(width))),
    ...lines.map(render),
    "",
    `Ready: ${report.summary.readyRecipes}; с проблемами: ${report.summary.problemRecipes}; по флагам: ${JSON.stringify(report.summary.byFlag)}; по файлам: ${JSON.stringify(report.summary.byFile)}`,
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const report = await auditRecipeSteps({ ids: parseIdList(argv), problemsOnly: argv.includes("--problems") });
  const output = optionValue(argv, "--output");
  if (output) await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(argv.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : `${formatRecipeStepTable(report)}\n`);
}
