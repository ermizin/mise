/* Блоки работы для оценки усилий рецепта.

   Оценка активного времени в `effortFor` (build-recipe-runtime-catalog.mjs)
   откалибрована на редакционных шагах до вычитки 2026-10-19: ≈ 3 минуты на
   блок работы и ещё 2 минуты, если в блоке режут, трут или измельчают. Тогда
   68 карточек были одним шагом, и разбиение их на 3–6 шагов по границам
   предложений прибавляло по 3 минуты за каждый новый шаг, хотя работы не
   прибавилось. Поэтому оценка считает не шаги, а блоки: шаги одного блока
   складываются вместе, и дальнейшее дробление шага внутри блока оценку не
   меняет.

   `data/recipe-effort-blocks.json` перечисляет карточки, у которых блок шире
   шага. Блок начинается шагом, в котором есть предложение, начинающееся со
   строки из `blockStarts` (предложения — как у equipment gate, пробелы
   сравниваются нормализованными); первая строка относится к первому шагу.
   Якорь по предложению, а не по началу шага, переживает и дальнейшее
   разбиение, и удаление вводной фразы перед ним. Карточка без записи считает
   каждый шаг отдельным блоком. Якорь, который не находит своего шага или
   находит два, останавливает сборку: блоки нужно поправить вместе с шагами. */
import { readFile } from "node:fs/promises";
import { splitInstructionSentences } from "./recipe-equipment.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/recipe-effort-blocks.json", import.meta.url), "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.recipes)) {
  throw new Error("Unsupported data/recipe-effort-blocks.json");
}
const entries = new Map(manifest.recipes.map((entry) => [entry.recipeId, entry]));
if (entries.size !== manifest.recipes.length) throw new Error("Duplicate recipe effort blocks entry");

export const effortBlockRecipeIds = Object.freeze([...entries.keys()]);

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

/* Шаги рецепта, сгруппированные в блоки работы: массив массивов шагов в
   исходном порядке. `steps` — редакционные шаги (`{ text, … }`) после всех
   оверлеев, то есть те же, что попадают в runtime. */
export function recipeEffortBlocks(recipeId, steps) {
  const entry = entries.get(recipeId);
  if (!entry) return steps.map((step) => [step]);
  const starts = entry.blockStarts;
  if (!Array.isArray(starts) || !starts.length || starts.some((anchor) => !normalizedText(anchor))) {
    throw new Error(`${recipeId}: effort blocks need at least one non-empty block start.`);
  }
  const sentences = steps.map((step) => splitInstructionSentences(step.text ?? "").map(normalizedText));
  const startIndexes = starts.map((anchor) => {
    const needle = normalizedText(anchor);
    const matches = sentences.flatMap((stepSentences, index) =>
      stepSentences.some((sentence) => sentence.startsWith(needle)) ? [index] : [],
    );
    if (matches.length !== 1) {
      throw new Error(`${recipeId}: effort block start «${anchor}» begins a sentence in ${matches.length} steps; expected exactly one.`);
    }
    return matches[0];
  });
  if (startIndexes[0] !== 0) throw new Error(`${recipeId}: the first effort block must start with the first step.`);
  if (startIndexes.some((index, position) => position > 0 && index <= startIndexes[position - 1])) {
    throw new Error(`${recipeId}: effort block starts are out of step order.`);
  }
  return startIndexes.map((start, position) => steps.slice(start, startIndexes[position + 1] ?? steps.length));
}
