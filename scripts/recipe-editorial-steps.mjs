/* Общие помощники вычитки шагов: где лежат редакционные карточки и копии их
   драфтов, как считать шаги и предложения и как записывать JSON, не меняя
   форматирование. Используют `audit-recipe-steps.mjs`,
   `check-editorial-steps.mjs` и `sync-editorial-steps.mjs`. */
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { recipeInstructionTimePattern } from "../domain/recipe-engine.ts";
import { splitInstructionSentences } from "./recipe-equipment.mjs";

export const EDITORIAL_CARD_PATHS = Object.freeze([
  "data/recipe-editorial/cards-a.json",
  "data/recipe-editorial/cards-b.json",
  "data/recipe-editorial/cards-c.json",
]);
// Карточки сопоставляются кандидатам этих двух файлов по порядку.
export const EDITORIAL_CANDIDATE_PATHS = Object.freeze([
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
]);
export const SIMPLE_HOME_CANDIDATE_PATH = "data/simple-home-candidates.json";
export const OWNER_SNAPSHOT_PATH = "data/owner-reviewed-catalog-corrections.json";
export const RUNTIME_CATALOG_PATH = "data/recipe-runtime-catalog.json";
export const RELEASE_AUDIT_PATH = "data/recipe-release-audit.json";
export const EDITORIAL_SYNC_FIELDS = Object.freeze([
  "titleRu",
  "paraphrasedInstructionDraft",
  "proceduralStatus",
  "proceduralBlockers",
]);

// Время в тексте шага по правилу таймлайна движка (после единицы нет буквы:
// «12 частей» — не время). Такое время обязано дойти до таймлайна готовки.
export const TIMED_STEP_TEXT = recipeInstructionTimePattern;

export const STEP_PROBLEM_LIMITS = Object.freeze({
  maxStepLength: 400,
  maxSentencesPerStep: 3,
  compactCardMaxSteps: 2,
  compactCardMaxLength: 500,
});

export const STEP_PROBLEM_FLAGS = Object.freeze({
  one_step: "1 шаг",
  step_over_400: "шаг > 400 знаков",
  four_plus_sentences: "≥ 4 предложений в шаге",
  two_steps_over_500: "≤ 2 шагов при > 500 знаков",
});

export function stepMetrics(texts) {
  const steps = texts.map((text) => String(text ?? ""));
  const lengths = steps.map((text) => text.length);
  const sentences = steps.map((text) => splitInstructionSentences(text).length);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const maxLength = Math.max(0, ...lengths);
  const maxSentences = Math.max(0, ...sentences);
  const flags = [];
  if (steps.length === 1) flags.push("one_step");
  if (maxLength > STEP_PROBLEM_LIMITS.maxStepLength) flags.push("step_over_400");
  if (maxSentences > STEP_PROBLEM_LIMITS.maxSentencesPerStep) flags.push("four_plus_sentences");
  if (steps.length <= STEP_PROBLEM_LIMITS.compactCardMaxSteps && totalLength > STEP_PROBLEM_LIMITS.compactCardMaxLength) {
    flags.push("two_steps_over_500");
  }
  return { steps: steps.length, lengths, sentences, totalLength, maxLength, maxSentences, flags };
}

export async function readJson(cwd, path) {
  return JSON.parse(await readFile(resolve(cwd, path), "utf8"));
}

/* Все файлы данных вычитки записаны как JSON.stringify(value, null, 2) с
   переводом строки в конце. Запись проверяет это на исходном тексте, чтобы не
   переформатировать файл с другим оформлением. */
export async function writeJsonPreservingFormat(cwd, path, document) {
  const target = resolve(cwd, path);
  const original = await readFile(target, "utf8");
  if (`${JSON.stringify(JSON.parse(original), null, 2)}\n` !== original) {
    throw new Error(`${path}: file is not in the 2-space JSON format; refusing to reformat it.`);
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

/* Карточки в общем порядке файлов: `index` — позиция в массиве своего файла
   (с нуля), `order` — позиция среди всех 221 карточек. */
export async function loadEditorialCards(cwd = process.cwd()) {
  const files = await Promise.all(EDITORIAL_CARD_PATHS.map(async (path) => ({ path, cards: await readJson(cwd, path) })));
  const entries = [];
  for (const { path, cards } of files) {
    cards.forEach((card, index) => entries.push({ path, file: basename(path), index, order: entries.length, card }));
  }
  return { files, entries };
}

export async function loadEditorialCandidates(cwd = process.cwd()) {
  const documents = await Promise.all(EDITORIAL_CANDIDATE_PATHS.map(async (path) => ({ path, document: await readJson(cwd, path) })));
  const entries = documents.flatMap(({ path, document }) =>
    document.candidates.map((candidate, index) => ({ path, index, candidate })),
  );
  return { documents, entries };
}

export function parseIdList(argv, flag = "--ids") {
  const position = argv.indexOf(flag);
  if (position < 0) return null;
  const value = argv[position + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a comma-separated list of recipe ids.`);
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error(`${flag} lists a recipe id twice.`);
  return ids;
}

export function optionValue(argv, flag) {
  const position = argv.indexOf(flag);
  if (position < 0) return null;
  const value = argv[position + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}
