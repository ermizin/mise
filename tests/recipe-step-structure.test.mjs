import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeSteps } from "../scripts/audit-recipe-steps.mjs";
import { TIMED_STEP_TEXT } from "../scripts/recipe-editorial-steps.mjs";
import { splitInstructionSentences } from "../scripts/recipe-equipment.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const report = await auditRecipeSteps();

/* Деление на шаги, вычитка 2026-10. После разбиения редакторами (база
   9865bb0) ни одна ready-карточка не попадает в `node scripts/audit-recipe-steps.mjs
   --problems`: нет карточек из одного шага, самый длинный шаг — 331 знак, в шаге
   не больше 3 предложений. Пороги жёсткие и ловят возврат к гигантским шагам. */
const MAX_STEP_LENGTH = 400;
const MAX_SENTENCES_PER_STEP = 4;
const MIN_SENTENCES_FOR_SPLIT = 3;

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

test("ready recipes keep the split step granularity", () => {
  // Ни одной ready-карточки из одного шага при 3+ предложениях, ни одного шага
  // длиннее 400 знаков или из 5+ предложений; флагов аудита шагов нет.
  assert.deepEqual(report.summary.byFlag, {});
  for (const row of report.recipes) {
    const sentences = row.stepSentences.reduce((sum, count) => sum + count, 0);
    assert.ok(
      row.stepSentences.length > 1 || sentences < MIN_SENTENCES_FOR_SPLIT,
      `${row.id}: one step with ${sentences} sentences`,
    );
    assert.ok(row.maxLength <= MAX_STEP_LENGTH, `${row.id}: step of ${row.maxLength} characters`);
    assert.ok(row.maxSentences <= MAX_SENTENCES_PER_STEP, `${row.id}: step of ${row.maxSentences} sentences`);
  }
});

test("a step that names a time carries it as a duration", () => {
  // Так же проверяет scripts/check-editorial-steps.mjs: после разбиения шага
  // время должно остаться у того шага, где оно названо. 2026-10-19 время было
  // только в тексте у 25 карточек — пяти редакционных, «Простых и домашних»
  // (сборщик), овсянки Good Food (оверлей) и двух сэндвичей (поварская правка).
  let timed = 0;
  for (const recipe of catalog.recipes) {
    for (const step of recipe.recipeFamily.miseInstructions) {
      if (step.action === "measure" || !TIMED_STEP_TEXT.test(step.text)) continue;
      timed += 1;
      assert.ok(step.duration, `${recipe.id}/${step.id}: «${step.text}» has no duration`);
    }
  }
  assert.ok(timed > 200, `${timed} timed steps`);
});

function ingredientLines(recipe) {
  return [...(recipe.shoppingIngredients ?? []), ...(recipe.procedureIngredients ?? [])];
}

const allRuntimeRecipes = [...catalog.recipes, ...catalog.simpleRecipes, ...catalog.extensionRecipes];

test("ingredient lines name a real product instead of a placeholder", () => {
  const placeholders = [
    /по рецепту/iu,
    /^специи$/iu,
    /^приправа по вкусу$/iu,
    /^зелень по вкусу$/iu,
    /^дополнение/iu,
  ];
  for (const recipe of allRuntimeRecipes) {
    for (const line of ingredientLines(recipe)) {
      for (const pattern of placeholders) {
        assert.doesNotMatch(String(line.nameRu ?? ""), pattern, `${recipe.id}: «${line.nameRu}»`);
      }
    }
  }
});

test("source salt and pepper keeps both seasonings in the line name", () => {
  const lines = catalog.recipes.flatMap((recipe) =>
    recipe.procedureIngredients.filter((line) => /salt and pepper/iu.test(line.sourceName)).map((line) => ({ recipe, line })),
  );
  assert.ok(lines.length >= 40);
  for (const { recipe, line } of lines) assert.equal(line.nameRu, "Соль и чёрный перец", recipe.id);
});

test("named spices keep the measured source amount", () => {
  const line = (id, index) => catalog.recipes.find((recipe) => recipe.id === id)
    .procedureIngredients.find((item) => item.sourceIngredientIndex === index);
  const expectations = [
    ["tmpm-27328", 15, "Итальянские травы", 0.2, "g"],
    ["tmpm-27306", 2, "Семена фенхеля", 0.8, "g"],
    ["tmpm-26358", 4, "Карри (порошок)", 4.8, "g"],
    ["tmpm-26358", 5, "Гарам масала", 3.2, "g"],
    ["tmpm-26647", 9, "Смесь специй для тыквенного пирога", 0.6667, "g"],
    ["tmpm-23797", 5, "Пажитник молотый", 0.8, "g"],
    ["tmpm-25006-avocado-bean-rice-cakes", 6, "Приправа «всё и сразу» (кунжут, мак, чеснок, лук)", 4, "g"],
    ["goodfood-lentil-kofta-orzo-feta", 4, "Рас-эль-ханут", 3.75, "ml"],
    ["goodfood-pork-with-cucumber-apricot-couscous", 3, "Сумах", 2.5, "ml"],
    ["goodfood-big-batch-bolognese", 7, "Смесь сушёных трав", 2.5, "ml"],
    ["goodfood-sausage-egg-muffins", 4, "Смесь сушёных трав", 0.8333, "ml"],
    // «dill pickles» — маринованные огурцы, а не укроп; белый перец — не просто «Перец».
    ["tmpm-24729", 7, "Маринованные огурцы", 10, "g"],
    ["tmpm-28302", 8, "Белый перец", 0.6, "g"],
    ["tmpm-28247", 5, "Белый перец", 0.3, "g"],
  ];
  for (const [id, index, nameRu, quantityPerServing, unit] of expectations) {
    const item = line(id, index);
    assert.equal(item.nameRu, nameRu, `${id}#${index}`);
    assert.equal(item.quantityPerServing, quantityPerServing, `${id}#${index}`);
    assert.equal(item.unit, unit, `${id}#${index}`);
    assert.equal(item.classification, "to_taste", `${id}#${index}`);
  }
});

test("an optional seasoning of choice is shown as optional, not as a vague spice", () => {
  for (const [id, index] of [["tmpm-23261", 10], ["foodru-blogger-chicken-bombs", 10]]) {
    const item = catalog.recipes.find((recipe) => recipe.id === id)
      .procedureIngredients.find((line) => line.sourceIngredientIndex === index);
    assert.equal(item.nameRu, "Любимая приправа", id);
    assert.equal(item.classification, "optional_serving", id);
    assert.equal(item.quantityPerServing, undefined, id);
  }
  // В источнике творожных вафель специй нет: только ваниль, соль и сахар.
  const waffles = catalog.recipes.find((recipe) => recipe.id === "foodru-blogger-cottage-waffles");
  assert.deepEqual(waffles.procedureIngredients.map((line) => line.nameRu), ["Соль", "Ваниль"]);
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
  // Regroup from the sentences of the whole draft, so the check holds both
  // before and after the editorial split of this card (cards-b, 2026-10-19).
  const [step] = candidate.paraphrasedInstructionDraft;
  const sentences = candidate.paraphrasedInstructionDraft.flatMap((item) => splitInstructionSentences(item.text));
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

/* Оценка усилий не зависит от дробности шагов. Снимок
   data/recipe-effort-baseline.json — effort и timeMinutes runtime main f314660,
   до разбиения шагов 2026-10-19 (scripts/build-recipe-effort-baseline.mjs).
   Оценка считается по блокам работы (scripts/recipe-effort-blocks.mjs,
   data/recipe-effort-blocks.json), поэтому совпадает со снимком у всех 202
   карточек. Общее время совпадает, кроме карточек ниже: у каждой указано
   время до и после и почему. «Источник» — time.totalMinutes кандидата. */
const effortBaseline = JSON.parse(await readFile(new URL("../data/recipe-effort-baseline.json", import.meta.url), "utf8"));
const expectedTimeChanges = {
  // Таймлайн: ожидание без своего времени заполняет остаток общего времени
  // после всей ручной работы. Раньше, если явные минуты ручной работы
  // превышали оценку активного времени, ожидание всё равно получало
  // «общее − активное», и время карточки уходило за время источника.
  "tmpm-26138": [55, 50, "до времени источника: варка риса больше не прибавляется к явным минутам жарки"],
  "goodfood-big-batch-pressure-cooker-bolognese": [120, 75, "до времени источника: сброс давления не получает ещё 66 минут сверх явных"],
  "goodfood-steak-broccoli-protein-pots": [38, 35, "варка риса меньше на перелив ручной работы"],
  "tmpm-25030": [87, 75, "шаги не менялись; до времени источника, та же причина"],
  "tmpm-24909": [47, 40, "шаги не менялись; до времени источника, та же причина"],
  "tmpm-24579": [221, 215, "шаги не менялись; до времени источника, та же причина"],
  "goodfood-slow-cooker-lamb-curry": [724, 370, "шаги не менялись; 6 часов в медленноварке больше не считаются дважды"],
  // Редакторы сделали независимые шаги параллельными.
  "tmpm-28247": [62, 60, "курица, батат и соус готовятся одновременно; время источника"],
  "tmpm-17115": [46, 45, "два противня в духовке одновременно; время источника"],
  // «X или Y» — один вариант, первый; «по желанию» в время не входит.
  "tmpm-26720": [644, 260, "«4 часа на сильном режиме либо 6 часов на слабом» — 4 часа; время источника"],
  "goodfood-slow-cooker-sausage-casserole": [725, 260, "«4 часа на сильном или 8 часов на слабом» — 4 часа; время источника"],
  "goodfood-orange-oregano-pulled-pork": [1454, 607, "8–10 часов в медленноварке без варианта 4–6 часов в духовке"],
  "goodfood-beef-red-wine-potato-pie": [1567, 240, "маринование 24 часа — по желанию; время источника"],
  // Разбиение показало последовательную работу, которую составной шаг не считал.
  "goodfood-black-bean-spicy-beef-pasta": [230, 262, "рагу по шагам: замачивание, обжарка, овощи и 3 часа томления — 248 мин, как у самой карточки рагу (источник 255), плюс паста"],
  "goodfood-harissa-beef-tomato-bulgur": [230, 274, "то же рагу (248 мин) плюс булгур и прогрев с хариссой"],
  "goodfood-slow-cooker-beef-bourguignon": [544, 554, "у шагов теперь есть «на 2 минуты» мука и травы и «5–8 минут» бекон, которых не было в составной duration"],
  // Короткие шаги без своего времени после явного времени: каждый получает
  // хотя бы минуту. Составной шаг прятал их внутри своего времени.
  "goodfood-10minute-couscous-salad": [10, 12, "нарезка и заправка после 10 минут настаивания кускуса"],
  "goodfood-quinoa-with-roast-asparagus-eggs-capers": [57, 60, "заправка после овощей и киноа получает оценку активного времени"],
};

/* Отличия оценки, которые даёт изменённый текст шага, а не дробность. Пакет
   R4 (названия и пропуски в тексте, ветка claude/recipe-names-2026-10) правит
   слова этих карточек; ожидание выбирается по факту текста, поэтому тест
   проходит и до, и после слияния. */
const textDependentEffort = {
  "tmpm-26583": {
    applies: (recipe) => recipe.steps.some((step) => /измельчённый чеснок/u.test(step)),
    effort: { knifeActions: 2, activeActions: 5, activeMinutes: 19 },
    reason: "в шаг обжарки фарша добавлен измельчённый чеснок: блок с ножом",
  },
  "tmpm-26676": {
    applies: (recipe) => !recipe.steps.some((step) => /^Охладите готовый рис/u.test(step)),
    effort: { cookware: 2 },
    reason: "удалён шаг «Охладите готовый рис в холодильнике ночь»: холодильника нет в утвари шагов",
  },
  "tmpm-25244": {
    applies: (recipe) => !recipe.steps.some((step) => /^Охладите готовый рис/u.test(step)),
    effort: { cookware: 2 },
    reason: "удалён шаг «Охладите готовый рис ночь»: холодильника нет в утвари шагов",
  },
};

test("effort does not depend on step granularity: every ready recipe keeps its pre-split effort", () => {
  const baseline = new Map(effortBaseline.recipes.map((item) => [item.id, item]));
  assert.equal(effortBaseline.source.commit, "f3146602d53271be9ba54d8fc78035578469cc94");
  assert.equal(catalog.recipes.length, 202);
  for (const recipe of catalog.recipes) {
    const before = baseline.get(recipe.id);
    assert.ok(before, `${recipe.id}: missing from the effort baseline`);
    const textChange = textDependentEffort[recipe.id];
    const expected = textChange?.applies(recipe) ? { ...before.effort, ...textChange.effort } : before.effort;
    const reason = textChange?.applies(recipe) ? ` (${textChange.reason})` : "";
    for (const field of ["level", "knifeActions", "activeActions", "cookware", "difficulty"]) {
      assert.equal(recipe.effort[field], expected[field], `${recipe.id}: effort.${field}${reason}`);
    }
    assert.ok(
      Math.abs(recipe.effort.activeMinutes - expected.activeMinutes) <= 1,
      `${recipe.id}: activeMinutes ${expected.activeMinutes} → ${recipe.effort.activeMinutes}${reason}`,
    );
    const change = expectedTimeChanges[recipe.id];
    if (change) {
      assert.equal(before.timeMinutes, change[0], `${recipe.id}: baseline time`);
      assert.equal(recipe.timeMinutes, change[1], `${recipe.id}: ${change[2]}`);
    } else {
      assert.equal(recipe.timeMinutes, before.timeMinutes, `${recipe.id}: timeMinutes changed without an explanation`);
    }
  }
  assert.ok(Object.keys(expectedTimeChanges).every((id) => baseline.has(id)));
});

test("splitting a step inside a work block does not change the effort estimate", async () => {
  const { effortFor } = await import("../scripts/build-recipe-runtime-catalog.mjs");
  const { effortBlockRecipeIds, recipeEffortBlocks } = await import("../scripts/recipe-effort-blocks.mjs");
  const { loadRecipeCorpusEntries } = await import("../scripts/recipe-corpus-overlay.mjs");
  const { normalizeRawRecipeCandidate } = await import("../domain/recipe-engine.ts");
  const { entries } = await loadRecipeCorpusEntries();
  const candidates = new Map(entries.map((entry) => [entry.candidate.id, entry]));
  const runtimeIds = new Set(catalog.recipes.map((recipe) => recipe.id));
  const comparable = (effort) => {
    const { parallelProcesses, ...rest } = effort;
    return rest;
  };
  assert.ok(effortBlockRecipeIds.length >= 99);
  for (const id of effortBlockRecipeIds) {
    assert.ok(runtimeIds.has(id), `${id}: effort blocks for a recipe outside the runtime catalog`);
    const entry = candidates.get(id);
    const { paraphrasedInstructionDraft: steps } = normalizeRawRecipeCandidate(entry.candidate, {
      publisher: entry.publisher,
      accessedAt: entry.accessedAt,
    });
    const blocks = recipeEffortBlocks(id, steps);
    assert.ok(blocks.length < steps.length, `${id}: blocks equal steps, the entry is not needed`);
    const runtime = catalog.recipes.find((recipe) => recipe.id === id);
    const effort = comparable(effortFor(entry.candidate, steps));
    assert.deepEqual(effort, comparable(runtime.effort), id);
    const sentenceSteps = steps.flatMap((step) =>
      splitInstructionSentences(step.text).map((text) => ({ ...step, text })),
    );
    assert.deepEqual(comparable(effortFor(entry.candidate, sentenceSteps)), effort, `${id}: split into sentences`);
  }
});

test("effort blocks reject an anchor that no longer begins a sentence of a step", async () => {
  const { recipeEffortBlocks } = await import("../scripts/recipe-effort-blocks.mjs");
  const steps = [{ text: "Обжарьте лук. Добавьте соль." }, { text: "Запеките 20 минут." }];
  assert.deepEqual(recipeEffortBlocks("no-entry", steps).map((block) => block.length), [1, 1]);
  const [id] = (await import("../scripts/recipe-effort-blocks.mjs")).effortBlockRecipeIds;
  assert.throws(() => recipeEffortBlocks(id, steps), /in 0 steps/u);
});

test("timeline minutes: units need a word boundary, «или» is one variant, «по желанию» is optional", async () => {
  const { recipeInstructionMinutes, recipeInstructionTimes } = await import("../domain/recipe-engine.ts");
  assert.equal(recipeInstructionMinutes(undefined, "Остудите и разрежьте на 12 частей."), 0);
  assert.doesNotMatch("Остудите и разрежьте на 12 частей.", TIMED_STEP_TEXT);
  assert.match("Выпекайте 20 минут, затем 1 минуту остудите.", TIMED_STEP_TEXT);
  assert.equal(recipeInstructionMinutes(undefined, "Прогрейте 1 минуту, затем томите 2 часа."), 121);
  assert.equal(recipeInstructionMinutes("4 ч на сильном или 8 ч на слабом", ""), 240);
  assert.equal(recipeInstructionMinutes(undefined, "Готовьте 4 часа на сильном режиме либо 6 часов на слабом."), 240);
  assert.equal(
    recipeInstructionMinutes(undefined, "Запекайте при 190°C, или 170°C с конвекцией, 20 минут сразу либо 40 минут из холодильника."),
    20,
  );
  assert.equal(recipeInstructionMinutes("4 ч на сильном или 6 ч на слабом; овощи последние 30 мин", ""), 240);
  assert.equal(recipeInstructionMinutes("10–12 мин; затем 2 мин", ""), 14);
  const marinade = "По желанию залейте говядину вином и маринуйте в холодильнике 24 часа. Откиньте мясо и обсушите.";
  assert.deepEqual(recipeInstructionTimes(marinade), { required: 0, optional: 1440 });
  assert.equal(recipeInstructionMinutes("24 ч при мариновании", marinade), 0);
});
