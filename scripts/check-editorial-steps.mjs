/* Проверка отредактированных редакционных карточек до синхронизации.

   node scripts/check-editorial-steps.mjs --ids id,id[,…]

   Текст шагов берётся из data/recipe-editorial/cards-{a,b,c}.json (для «Простых
   и домашних» — из data/simple-home-candidates.json) и в памяти подставляется
   в корпус кандидатов так же, как это сделает sync-editorial-steps.mjs. Затем
   прогоняются те же оверлеи, что у runtime-сборки. Проверяется:
   - validateCard из apply-recipe-editorial-cards.mjs и нумерация editorial-step-N;
   - каждая строка состава упомянута в ingredientIds какого-то шага, неизвестных
     id нет, зависимости только назад (gate корпуса);
   - у шага с «N мин/сек/ч» есть duration, и время доходит до таймлайна;
   - шаг не короче 20 знаков, action из словаря карточек;
   - поварские правки на якорях находят ровно один свой шаг;
   - equipment gate: шаги совпадают с проверенными как есть или по
     предложениям; иначе печатается, какие предложения изменились, и новый sha;
   - оценка усилий (effort) прежняя: блоки работы из data/recipe-effort-blocks.json
     находят свои шаги, а разбиение шага не прибавляет активных минут.
   Exit 1 при любой ошибке. Предупреждения (длинные шаги и т. п.) код не меняют. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRawRecipeCandidate, recipeInstructionMinutes, recipeInstructionTimes } from "../domain/recipe-engine.ts";
import { validateCard } from "./apply-recipe-editorial-cards.mjs";
import { effortFor } from "./build-recipe-runtime-catalog.mjs";
import { auditIngredientStepGate } from "./audit-recipe-corpus.mjs";
import { chefDraftReplacementRecipeIds } from "./apply-recipe-proofread-policy.mjs";
import {
  loadRecipeCorpusWithOverlays,
  positionalStepOverlayRecipeIds,
  recipeCorpusDatasetPaths,
} from "./recipe-corpus-overlay.mjs";
import {
  historicalSplitTexts,
  instructionFingerprint,
  matchesEquipmentInstructionFingerprint,
  recipeEquipmentEntry,
} from "./recipe-equipment.mjs";
import {
  EDITORIAL_SYNC_FIELDS,
  RELEASE_AUDIT_PATH,
  RUNTIME_CATALOG_PATH,
  STEP_PROBLEM_FLAGS,
  TIMED_STEP_TEXT,
  loadEditorialCards,
  parseIdList,
  readJson,
  stepMetrics,
} from "./recipe-editorial-steps.mjs";

const MIN_STEP_LENGTH = 20;

function multisetDifference(left, right) {
  const counts = new Map();
  for (const item of right) counts.set(item, (counts.get(item) ?? 0) + 1);
  return left.filter((item) => {
    const count = counts.get(item) ?? 0;
    if (!count) return true;
    counts.set(item, count - 1);
    return false;
  });
}

function equipmentReport(id, title, steps, previousSteps) {
  const entry = recipeEquipmentEntry(id);
  if (!entry) return { errors: [`${id}: no equipment review in data/recipe-equipment.json`], notes: [] };
  const errors = [];
  const notes = [];
  if (entry.title !== title) {
    errors.push(`${id}: equipment review is for «${entry.title}», card title is «${title}»; update the title in data/recipe-equipment.json and data/recipe-cuisines.json after review.`);
  }
  if (matchesEquipmentInstructionFingerprint(entry.sourceStepsSha256, steps)) {
    notes.push("equipment gate: ok (те же предложения, что при проверке утвари)");
    return { errors, notes };
  }
  const before = previousSteps ? historicalSplitTexts(previousSteps) : [];
  const after = historicalSplitTexts(steps);
  const removed = multisetDifference(before, after);
  const added = multisetDifference(after, before);
  const lines = [`${id}: equipment gate fails — шаги изменились по словам или порядку предложений.`];
  if (!previousSteps) {
    lines.push("  нет прежних шагов в runtime-каталоге для сравнения.");
  } else if (!removed.length && !added.length) {
    lines.push("  те же предложения в другом порядке: порядок предложений менять нельзя.");
  } else if (before.join(" ") === after.join(" ")) {
    lines.push("  слова те же, но иначе склеились короткие предложения: предложение короче 20 знаков должно остаться в одном шаге с соседним, как было.");
  }
  for (const sentence of removed) lines.push(`  − ${sentence}`);
  for (const sentence of added) lines.push(`  + ${sentence}`);
  lines.push(
    `  Если слова изменены намеренно: перепроверьте утварь и способы (methods) рецепта в data/recipe-equipment.json и замените там sourceStepsSha256 на ${instructionFingerprint(steps)}.`,
  );
  errors.push(lines.join("\n"));
  return { errors, notes };
}

export async function checkEditorialSteps({ cwd = process.cwd(), ids }) {
  if (!ids?.length) throw new Error("Pass --ids id,id to check edited cards.");
  const [{ entries: cardEntries }, rawDocuments, catalog, releaseAudit] = await Promise.all([
    loadEditorialCards(cwd),
    Promise.all(recipeCorpusDatasetPaths.map((path) => readJson(cwd, path))),
    readJson(cwd, RUNTIME_CATALOG_PATH),
    readJson(cwd, RELEASE_AUDIT_PATH),
  ]);
  const cardsById = new Map(cardEntries.map((entry) => [entry.card.id, entry]));
  const verdicts = new Map(releaseAudit.cards.map((card) => [card.id, card.verdict]));
  const runtimeById = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  const knownActions = new Set(cardEntries.flatMap(({ card }) => card.paraphrasedInstructionDraft.map((step) => step.action)));
  const editorialCandidates = rawDocuments.slice(0, 2).flatMap((document) => document.candidates);
  if (editorialCandidates.length !== cardEntries.length) {
    throw new Error(`Expected one editorial card per candidate; got ${editorialCandidates.length}/${cardEntries.length}`);
  }

  const results = new Map(ids.map((id) => [id, { id, errors: [], warnings: [], notes: [] }]));
  const globalErrors = [];

  // Подставить карточки в копию корпуса так же, как sync-editorial-steps.mjs.
  for (const id of ids) {
    const result = results.get(id);
    const cardEntry = cardsById.get(id);
    const simpleHomeCandidate = rawDocuments[2].candidates.find((candidate) => candidate.id === id);
    if (!cardEntry && !simpleHomeCandidate) {
      result.errors.push(`${id}: no editorial card or simple-home candidate with this id.`);
      continue;
    }
    if (verdicts.get(id) !== "ready") {
      result.warnings.push(`${id}: release verdict is ${verdicts.get(id) ?? "missing"}; по брифу карточки не в ready не трогаем.`);
    }
    if (chefDraftReplacementRecipeIds.includes(id)) {
      // Ошибка — только если текст карточки правили: он до runtime не дойдёт.
      // Неизменённая карточка проверяется по шагам после поварской правки.
      const edited = cardEntry &&
        JSON.stringify(cardEntry.card.paraphrasedInstructionDraft) !==
          JSON.stringify(editorialCandidates[cardEntry.order].paraphrasedInstructionDraft);
      const message = `${id}: драфт этой карточки целиком заменяет поварская правка в scripts/apply-recipe-proofread-policy.mjs — текст карточки до runtime не доходит, правьте шаги там.`;
      if (edited) result.errors.push(message);
      else result.warnings.push(`${message} Ниже проверены шаги после поварской правки.`);
    }
    if (positionalStepOverlayRecipeIds.includes(id)) {
      result.warnings.push(`${id}: оверлей в scripts/recipe-corpus-overlay.mjs переписывает текст шагов 1–2 по позиции; при разбиении шагов поправьте и его.`);
    }
    if (!cardEntry) {
      result.notes.push(`${id}: шаги «Простых и домашних» генерирует scripts/build-simple-home-candidates.mjs; проверяется текущий data/simple-home-candidates.json.`);
      continue;
    }
    result.notes.push(`${id}: ${cardEntry.file} индекс ${cardEntry.index}`);
    const candidate = editorialCandidates[cardEntry.order];
    try {
      validateCard(cardEntry.card, candidate);
    } catch (error) {
      result.errors.push(`validateCard: ${error.message}`);
    }
    cardEntry.card.paraphrasedInstructionDraft.forEach((step, index) => {
      if (step.id !== `editorial-step-${index + 1}`) result.errors.push(`${id}: step ${index + 1} id is ${step.id}; renumber the draft as editorial-step-1…N.`);
      if (!knownActions.has(step.action)) result.errors.push(`${id}/${step.id}: action «${step.action}» is not used by any card.`);
    });
    for (const field of EDITORIAL_SYNC_FIELDS) candidate[field] = structuredClone(cardEntry.card[field]);
  }

  let documents;
  try {
    ({ documents } = await loadRecipeCorpusWithOverlays({ cwd, rawDocuments }));
  } catch (error) {
    globalErrors.push(`overlay: ${error.message}`);
  }

  if (documents) {
    const entries = documents.flatMap((document) =>
      document.candidates.map((candidate) => ({ candidate, publisher: document.source, accessedAt: document.importedAt })),
    );
    for (const id of ids) {
      const result = results.get(id);
      const entry = entries.find((item) => item.candidate.id === id);
      if (!entry) continue;
      const { candidate } = entry;
      const gate = auditIngredientStepGate(candidate);
      for (const sourceId of gate.unusedSourceRows) result.errors.push(`${id}: строка состава ${sourceId} не упомянута в ingredientIds ни одного шага.`);
      for (const unknown of gate.unknownIds) result.errors.push(`${id}/${unknown.stepId}: unknown ingredient id ${unknown.ingredientId}.`);
      for (const stepId of gate.vagueSteps) result.errors.push(`${id}/${stepId}: расплывчатая формулировка шага.`);
      for (const mismatch of gate.stateMismatches) result.errors.push(`${id}: сухой рис ${mismatch.sourceId} без шага «сухого риса».`);

      const normalized = normalizeRawRecipeCandidate(candidate, { publisher: entry.publisher, accessedAt: entry.accessedAt });
      const draft = normalized.paraphrasedInstructionDraft;
      const earlier = new Set();
      for (const step of draft) {
        for (const dependency of step.dependsOn ?? []) {
          if (!earlier.has(dependency)) result.errors.push(`${id}/${step.id}: dependsOn ${dependency} is not an earlier step.`);
        }
        earlier.add(step.id);
        const text = String(step.text ?? "");
        if (text.length < MIN_STEP_LENGTH) result.errors.push(`${id}/${step.id}: шаг короче ${MIN_STEP_LENGTH} знаков.`);
        if (TIMED_STEP_TEXT.test(text)) {
          if (!step.duration) result.errors.push(`${id}/${step.id}: в тексте есть время, но нет duration.`);
          // Время, названное только как необязательное («по желанию маринуйте
          // 24 часа»), в таймлайн намеренно не входит.
          if (recipeInstructionTimes(text).required > 0 && !(recipeInstructionMinutes(step.duration, text) > 0)) {
            result.errors.push(`${id}/${step.id}: время из текста не доходит до таймлайна.`);
          }
        }
      }
      const steps = draft.map((step) => step.text).filter(Boolean);
      const metrics = stepMetrics(steps);
      result.notes.push(`шаги: ${metrics.steps}; знаков по шагам: ${metrics.lengths.join("/")}; предложений: ${metrics.sentences.join("/")}`);
      for (const flag of metrics.flags) result.warnings.push(`${id}: ${STEP_PROBLEM_FLAGS[flag]}`);
      if (verdicts.get(id) === "ready") {
        const equipment = equipmentReport(id, String(candidate.titleRu ?? "").trim(), steps, runtimeById.get(id)?.steps);
        result.errors.push(...equipment.errors);
        result.notes.push(...equipment.notes);
        // Оценка усилий считается по блокам работы, а не по шагам: разбиение
        // шага по предложениям не должно её менять.
        const previous = runtimeById.get(id)?.effort;
        try {
          const effort = effortFor(candidate, draft);
          if (previous && (effort.activeMinutes !== previous.activeMinutes || effort.level !== previous.level)) {
            result.errors.push(
              `${id}: оценка усилий меняется: ${previous.activeMinutes} → ${effort.activeMinutes} активных минут, уровень ${previous.level} → ${effort.level}. ` +
                "Если шаг только разбит по предложениям, работы не прибавилось: задайте начала блоков в data/recipe-effort-blocks.json (scripts/recipe-effort-blocks.mjs).",
            );
          } else if (previous) {
            result.notes.push(`оценка усилий: прежняя (${effort.activeMinutes} активных минут, блоков ${effort.activeActions - effort.knifeActions})`);
          }
        } catch (error) {
          result.errors.push(`effort blocks: ${error.message}`);
        }
      }
    }
  }
  const list = [...results.values()];
  return {
    ok: !globalErrors.length && list.every((result) => !result.errors.length),
    globalErrors,
    results: list,
  };
}

function formatReport(report) {
  const lines = [];
  for (const error of report.globalErrors) lines.push(`ОШИБКА ${error}`);
  for (const result of report.results) {
    lines.push(`${result.errors.length ? "✗" : "✓"} ${result.id}`);
    for (const note of result.notes) lines.push(`  · ${note}`);
    for (const warning of result.warnings) lines.push(`  ! ${warning}`);
    for (const error of result.errors) lines.push(`  ✗ ${error}`);
  }
  lines.push(report.ok ? "OK" : "FAILED");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const report = await checkEditorialSteps({ ids: parseIdList(argv) });
  process.stdout.write(`${argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}
