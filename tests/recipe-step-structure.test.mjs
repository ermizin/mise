import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRecipeSteps } from "../scripts/audit-recipe-steps.mjs";
import { TIMED_STEP_TEXT } from "../scripts/recipe-editorial-steps.mjs";
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

test("chili, coriander and pepper are named by the product the source line buys", () => {
  // 2026-10-19: «Острый перец» стоял на 13 разных продуктах, «Кориандр» — и на
  // молотой специи, и на свежей кинзе, «Перец» — на молотом чёрном перце.
  // Название идёт от строки источника; количество и статус «по вкусу» прежние.
  const line = (id, index) => catalog.recipes.find((recipe) => recipe.id === id)
    .procedureIngredients.find((item) => item.sourceIngredientIndex === index);
  const expectations = [
    ["tmpm-28083", 10, "chili powder", "Чили молотый", 3.6, "g"],
    ["tmpm-17591", 6, "cayenne pepper", "Кайенский перец", 0.75, "g"],
    ["tmpm-22442", 7, "red pepper flakes", "Хлопья чили", 1.2, "g"],
    ["goodfood-chicken-pasta-bake", 4, "chilli flakes", "Хлопья чили", 0.2083, "ml"],
    ["tmpm-18557", 12, "gochugaru", "Хлопья чили кочукару", 2, "g"],
    ["tmpm-24619", 7, "ancho chili powder", "Чили анчо молотый", 1.2, "g"],
    ["tmpm-23797", 3, "kashmiri chili powder", "Кашмирский чили молотый", 1.2, "g"],
    ["goodfood-spiced-lentil-butternut-squash-soup", 4, "hot chilli powder", "Острый чили молотый", 0.3125, "ml"],
    ["tmpm-22571", 20, "jalapeños", "Халапеньо", 12, "g"],
    ["goodfood-prawn-rice-mango-jar-salad", 5, "red chilli deseeded and finely chopped", "Свежий красный чили", 0.5, "piece"],
    ["goodfood-wild-salmon-with-radish-orange-slaw", 8, "green chillies deseeded and finely chopped", "Свежий зелёный чили", 0.25, "piece"],
    ["goodfood-kadala-curry", 3, "fresh or dried chilli to taste", "Чили свежий или сушёный", 1.25, "ml"],
    // «coriander» без формы: Meal Prep Manual — ложка специи в маринаде,
    // Good Food — свежая зелень (здесь её пробивают в пасту карри).
    ["tmpm-26676", 8, "coriander", "Кориандр молотый", 0.6, "g"],
    ["goodfood-kadala-curry", 6, "ground coriander", "Кориандр молотый", 3.75, "ml"],
    ["goodfood-meatball-chickpea-yellow-coconut-curry-with-rice-pickled-red-cabbage", 10, "coriander", "Кинза", 2.86, "g"],
    ["goodfood-pork-with-cucumber-apricot-couscous", 1, "fresh coriander", "Кинза", 7.5, "g"],
    ["tmpm-25453", 7, "pepper", "Чёрный перец молотый", 0.3529, "g"],
    ["tmpm-26583", 18, "pepper", "Чёрный перец молотый", 1.2, "g"],
  ];
  for (const [id, index, sourceName, nameRu, quantityPerServing, unit] of expectations) {
    const item = line(id, index);
    assert.equal(item.sourceName, sourceName, `${id}#${index}`);
    assert.equal(item.nameRu, nameRu, `${id}#${index}`);
    assert.equal(item.quantityPerServing, quantityPerServing, `${id}#${index}`);
    assert.equal(item.unit, unit, `${id}#${index}`);
    assert.equal(item.classification, "to_taste", `${id}#${index}`);
  }
  // Карточки Mise (simpleRecipes, extensionRecipes) пишутся вручную и в эту
  // таблицу не входят.
  for (const recipe of catalog.recipes) {
    for (const item of recipe.procedureIngredients) {
      assert.doesNotMatch(String(item.nameRu), /^(?:острый перец|кориандр|перец)$/iu, `${recipe.id}: «${item.nameRu}»`);
    }
  }
});

test("the spicy rule still recognises every chili name", async () => {
  // «Острое» в PWA и в нативном приложении ищет перец по названию строки
  // процедуры. Каждое новое название острого перца должно ему попадаться, а
  // кориандр и чёрный перец — нет.
  const sources = await Promise.all(["../app/page.tsx", "../domain/mobile.ts"].map((path) =>
    readFile(new URL(path, import.meta.url), "utf8")));
  const patterns = [
    sources[0].match(/const chiliNamePattern = \/(.+?)\/(\w*);/u),
    sources[1].match(/const chiliName = \/(.+?)\/(\w*);/u),
  ].map((match) => {
    assert.ok(match, "the spicy name rule is present");
    return new RegExp(match[1], match[2]);
  });
  const chiliSource = /chil+i|chile|cayenne|jalape|gochugaru|red pepper flakes/iu;
  const chiliNames = new Set();
  for (const recipe of catalog.recipes) {
    for (const item of recipe.procedureIngredients) {
      if (!chiliSource.test(item.sourceName ?? "")) continue;
      chiliNames.add(item.nameRu);
      for (const pattern of patterns) assert.match(item.nameRu, pattern, `${recipe.id}#${item.sourceIngredientIndex}`);
    }
  }
  assert.ok(chiliNames.size >= 12, [...chiliNames].join(", "));
  for (const name of ["Кориандр молотый", "Кинза", "Чёрный перец молотый", "Соль и чёрный перец", "Паприка"]) {
    for (const pattern of patterns) assert.doesNotMatch(name, pattern, name);
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
