import { readFile } from "node:fs/promises";
import { canonicalIngredients, normalizeRawRecipeCandidate } from "../domain/recipe-engine.ts";

const policyUrl = new URL("../data/recipe-proofread-policy.json", import.meta.url);
const reviewUrl = new URL("../data/recipe-review-resolutions.json", import.meta.url);
const storageReference = "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/leftovers-and-food-safety";
const dryRiceInstruction = "Промойте и сварите указанное в составе количество сухого риса по инструкции на упаковке.";
const appendedRicePattern = /^Промойте сухой рис, сварите по инструкции на упаковке до готовности/iu;

function clone(value) {
  return structuredClone(value);
}

function normalizedSourceName(ingredient) {
  return String(ingredient?.name ?? "").replace(/[\u200B-\u200D\u2060\uFEFF⁣]/gu, "").trim().toLowerCase();
}

function replaceEvery(value, from, to) {
  if (typeof value !== "string") return value;
  return value
    .replaceAll(from, to)
    .replaceAll(from[0].toUpperCase() + from.slice(1), to[0].toUpperCase() + to.slice(1));
}

/* Замены идут по порядку списка. Если слово заменяется фразой, в которой
   склоняется не последнее слово («zero-соус» → «низкокалорийный соус без
   сахара»), каждая падежная форма записана в глоссарии раньше основной:
   иначе окончание приклеивается к концу фразы («…соус без сахараом»). */
function replaceGlossaryText(value, candidateId, policy) {
  let text = value;
  if (typeof text !== "string") return text;
  for (const replacement of policy.glossary.globalReplacements) {
    text = replaceEvery(text, replacement.from, replacement.to);
  }
  text = text.replace(/\bтефтел/giu, "фрикадел");
  if (policy.glossary.slowCookerRecipeIds.includes(candidateId)) {
    text = text
      .replace(/мультиварке/giu, "медленноварке")
      .replace(/мультиварку/giu, "медленноварку")
      .replace(/мультиварки/giu, "медленноварки")
      .replace(/мультиварка/giu, "медленноварка");
  }
  return text;
}

function ingredientWithDisplayRule(ingredient, policy, candidateId) {
  const sourceName = normalizedSourceName(ingredient);
  const rule = policy.ingredientDisplayRules.find((item) =>
    item.sourceName ? sourceName === item.sourceName : sourceName.includes(item.sourceContains),
  );
  let displayNameRu = rule?.displayNameRu ?? ingredient.displayNameRu;
  if (ingredient.id === "cream_cheese_frosting_processed" || /\bcream cheese frosting\b/iu.test(sourceName)) {
    displayNameRu = "Крем из творожного сыра";
  } else if (ingredient.id === "cream_cheese_processed" || /\bcream cheese\b/iu.test(sourceName)) {
    displayNameRu = String(displayNameRu ?? "Творожный сыр").replace(/сливочн/giu, "творожн");
  }
  return {
    ...ingredient,
    name: replaceGlossaryText(ingredient.name, candidateId, policy),
    original: replaceGlossaryText(ingredient.original, candidateId, policy),
    ...(displayNameRu ? { displayNameRu: replaceGlossaryText(displayNameRu, candidateId, policy) } : {}),
  };
}

function roundedTemperatureText(value, replacements) {
  if (typeof value !== "string") return value;
  return value.replace(/(\d{3})\s*°\s*C/giu, (match, number) =>
    replacements[number] ? `${replacements[number]} °C` : match,
  );
}

function normalizeTemperatures(candidate, policy) {
  if (!candidate.id.startsWith("tmpm-")) return candidate;
  const replacements = policy.temperatureCReplacements;
  return {
    ...candidate,
    paraphrasedInstructionDraft: (candidate.paraphrasedInstructionDraft ?? []).map((step) => ({
      ...step,
      text: roundedTemperatureText(step.text, replacements),
      ...(typeof step.temperature === "string" ? { temperature: roundedTemperatureText(step.temperature, replacements) } : {}),
      ...(replacements[String(step.temperatureC)] ? { temperatureC: replacements[String(step.temperatureC)] } : {}),
    })),
  };
}

function normalizeStorage(candidate, policy) {
  const hot = policy.hotReheatRecipeIds.includes(candidate.id);
  const cold = policy.coldNoReheatRecipeIds.includes(candidate.id);
  const freezer = policy.freezerRecipeIds.includes(candidate.id);
  if (!hot && !cold && !freezer) return candidate;
  const storage = { ...candidate.storage, reference: candidate.storage?.reference ?? storageReference };
  if (hot) {
    storage.reheatToC = 74;
    storage.reheat = "Разогреть до 74 °C в центре порции.";
  }
  if (freezer) {
    storage.freezable = true;
    storage.freezerDays = Math.max(60, Number(storage.freezerDays) || 0);
    storage.freezer = "Замораживать согласно шагам карточки; хранить до 60 суток при −18 °C.";
    storage.thaw = "Размораживать в холодильнике либо готовить из замороженного состояния, если это прямо указано в шагах.";
  }
  if (cold) {
    storage.reheatToC = null;
    storage.reheat = "Подавать охлаждённым или при комнатной температуре, без повторного нагрева.";
  }
  return { ...candidate, storage };
}

function normalizeRiceSentence(text, overnight) {
  const instruction = overnight
    ? `${dryRiceInstruction} Быстро охладите и выдержите в холодильнике ночь.`
    : dryRiceInstruction;
  return String(text ?? "")
    .replace(/Сварите\s+рис\s+до\s+[^.]+\.?/iu, instruction)
    .replace(/Приготовьте\s+рис\s+по\s+инструкции\s+на\s+упаковке\.?/iu, instruction)
    .replace(/Приготовьте\s+рис\.?/iu, instruction)
    .replace(/Промойте\s+рис\s+до\s+прозрачной\s+воды\s+и\s+поставьте\s+вариться\.?/iu, instruction)
    .replace(/Сварите\s+рис\.?/iu, instruction);
}

function normalizeRiceSteps(candidate, policy) {
  let steps = (candidate.paraphrasedInstructionDraft ?? []).map((step) => ({ ...step }));
  if (policy.dropAppendedRiceStepRecipeIds.includes(candidate.id)) {
    steps = steps.filter((step) => !appendedRicePattern.test(String(step.text ?? "")));
  }
  if (!policy.riceStepDeduplicateRecipeIds.includes(candidate.id)) {
    return { ...candidate, paraphrasedInstructionDraft: steps };
  }
  const overnight = ["tmpm-26676", "tmpm-25244"].includes(candidate.id);
  const nonMiseRiceStep = steps.find((step) =>
    step.id !== "mise-rice-dry-prep" && /(?:свар|приготов|промой)[а-яё]*\s+рис/iu.test(String(step.text ?? "")),
  );
  if (nonMiseRiceStep) {
    steps = steps
      .filter((step) => step.id !== "mise-rice-dry-prep")
      .map((step) => step.id === nonMiseRiceStep.id ? { ...step, text: normalizeRiceSentence(step.text, overnight) } : step);
  }
  const seen = new Set();
  steps = steps.filter((step) => {
    const key = String(step.text ?? "").trim().replace(/\s+/gu, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...candidate, paraphrasedInstructionDraft: steps };
}

function ingredient(id, name, amountMetric, original, extra = {}) {
  return {
    ...(id ? { id } : {}),
    name,
    displayNameRu: name,
    ...(amountMetric != null ? { amountMetric, unitMetric: "g" } : {}),
    original,
    ...extra,
  };
}

function setIngredientLists(candidate, ingredients) {
  return {
    ...candidate,
    ingredients: ingredients.map((item) => ({ ...item })),
    ...(Array.isArray(candidate.sourceIngredients)
      ? { sourceIngredients: ingredients.map((item) => ({ ...item })) }
      : {}),
  };
}

function mapIngredientLists(candidate, mapper) {
  return {
    ...candidate,
    ingredients: (candidate.ingredients ?? []).map(mapper),
    ...(Array.isArray(candidate.sourceIngredients)
      ? { sourceIngredients: candidate.sourceIngredients.map(mapper) }
      : {}),
  };
}

function sandwichStorage() {
  return {
    refrigeratorDays: 2,
    freezerDays: 0,
    freezable: false,
    coolWithinHours: 2,
    reheatToC: 74,
    refrigerator: "Готовую курицу, соус и салат хранить раздельно до 2 суток при температуре не выше 4 °C.",
    freezer: "Не замораживать.",
    thaw: "Не требуется.",
    reheat: "Курицу при необходимости разогреть до 74 °C; хлеб, салат и соус добавить при сборке.",
    reference: storageReference,
  };
}

function repairSandwich(candidate) {
  if (candidate.id === "new-sandwich-caesar") {
    const ingredients = [
      ingredient("bread_processed", "Цельнозерновой хлеб", 90, "90 г · адаптация Mise"),
      ingredient("chicken_raw", "Куриная грудка", 160, "160 г · адаптация Mise"),
      ingredient("sunflower_oil_processed", "Подсолнечное масло", 3, "3 г · округлено из 1 ч. л. на 2 порции в источнике"),
      ingredient("yogurt_processed", "Греческий йогурт", 30, "30 г · 2 ст. л. на 2 порции в источнике"),
      ingredient("parmesan_processed", "Пармезан", 15, "15 г · для соуса и подачи"),
      ingredient("lettuce_raw", "Салат ромэн", 50, "50 г · адаптация Mise"),
      ingredient("lemon_raw", "Лимонный сок", 10, "10 г · редакционная мера по источнику"),
      ingredient("capers_processed", "Каперсы", 3, "3 г · 1 ч. л. на 2 порции в источнике"),
      ingredient("garlic_raw", "Чеснок", 2, "2 г · 1 небольшой зубчик на 2 порции в источнике"),
      ingredient(null, "Соль", null, "по вкусу", { name: "salt" }),
      ingredient(null, "Чёрный перец", null, "по вкусу", { name: "black pepper" }),
    ];
    return setIngredientLists({
      ...candidate,
      paraphrasedInstructionDraft: [
        { id: "editorial-step-1", action: "grill", dependsOn: [], ingredientIds: ["source-ingredient-2", "source-ingredient-3", "source-ingredient-10", "source-ingredient-11"], text: "Разогрейте сковороду-гриль. Натрите куриную грудку маслом, посолите и поперчите; жарьте примерно по 7 минут с каждой стороны, до 74 °C в центре. Дайте мясу отдохнуть и нарежьте ломтиками.", duration: "около 7 мин с каждой стороны" },
        { id: "editorial-step-2", action: "mix", dependsOn: ["editorial-step-1"], ingredientIds: ["source-ingredient-4", "source-ingredient-5", "source-ingredient-7", "source-ingredient-8", "source-ingredient-9", "source-ingredient-10", "source-ingredient-11"], text: "Смешайте йогурт, тёртый пармезан, лимонный сок, каперсы и раздавленный чеснок. Посолите и поперчите." },
        { id: "editorial-step-3", action: "toast", dependsOn: ["editorial-step-2"], ingredientIds: ["source-ingredient-1"], text: "Подсушите хлеб на сухой сковороде." },
        { id: "editorial-step-4", action: "portion", dependsOn: ["editorial-step-3"], ingredientIds: ["source-ingredient-1", "source-ingredient-2", "source-ingredient-4", "source-ingredient-5", "source-ingredient-6", "source-ingredient-7", "source-ingredient-8", "source-ingredient-9"], text: "Выложите на хлеб салат, курицу и соус; сверху добавьте оставшийся пармезан. Соберите непосредственно перед едой." },
      ],
      storage: sandwichStorage(),
    }, ingredients);
  }
  if (candidate.id === "new-sandwich-paprika") {
    const ingredients = [
      ingredient("bread_processed", "Чиабатта", 90, "90 г · адаптация Mise"),
      ingredient("chicken_raw", "Куриная грудка", 160, "160 г · адаптация Mise"),
      ingredient("lemon_raw", "Лимонный сок", 10, "10 г · редакционная мера по источнику"),
      ingredient(null, "Копчёная паприка", 2, "2 г · 1 ст. л. на 4 порции в источнике", { name: "smoked paprika" }),
      ingredient("olive_oil_processed", "Оливковое масло", 5, "5 г · редакционная мера по источнику"),
      ingredient("garlic_raw", "Чеснок", 2, "2 г · 1 зубчик на 4 порции в источнике"),
      ingredient("mayonnaise_processed", "Майонез", 15, "15 г · 4 ст. л. на 4 порции в источнике"),
      ingredient("lettuce_raw", "Салат ромэн", 50, "50 г · адаптация Mise"),
      ingredient(null, "Соль", null, "по вкусу", { name: "salt" }),
      ingredient(null, "Чёрный перец", null, "по вкусу", { name: "black pepper" }),
    ];
    return setIngredientLists({
      ...candidate,
      paraphrasedInstructionDraft: [
        { id: "editorial-step-1", action: "prepare", dependsOn: [], ingredientIds: ["source-ingredient-2"], text: "Разрежьте куриную грудку вдоль на две тонкие части и слегка отбейте до толщины около 1 см." },
        { id: "editorial-step-2", action: "grill", dependsOn: ["editorial-step-1"], ingredientIds: ["source-ingredient-2", "source-ingredient-3", "source-ingredient-4", "source-ingredient-5", "source-ingredient-9", "source-ingredient-10"], text: "Полейте курицу лимонным соком, посыпьте копчёной паприкой, посолите, поперчите и смажьте маслом. Жарьте на горячем гриле по 3–4 минуты с каждой стороны, до 74 °C в центре.", duration: "3–4 мин с каждой стороны" },
        { id: "editorial-step-3", action: "toast", dependsOn: ["editorial-step-2"], ingredientIds: ["source-ingredient-1"], text: "Разрежьте чиабатту и подсушите срезом вниз на сковороде около минуты." },
        { id: "editorial-step-4", action: "portion", dependsOn: ["editorial-step-3"], ingredientIds: ["source-ingredient-1", "source-ingredient-2", "source-ingredient-6", "source-ingredient-7", "source-ingredient-8"], text: "Смешайте чеснок с майонезом, намажьте чиабатту, добавьте салат и готовую курицу. Соберите непосредственно перед едой." },
      ],
      storage: sandwichStorage(),
    }, ingredients);
  }
  return candidate;
}

/* Поварская правка шага ищет шаг не по номеру («editorial-step-2»), а по
   уникальной подстроке его текста. Редактор может разбить составной шаг на
   несколько по границам предложений и перенумеровать драфт; правка должна
   попасть в шаг с нужным предложением, а не молча промахнуться. Если подстрока
   не найдена или найдена в нескольких шагах, сборка останавливается. */
export function findStepByAnchor(draft, anchor, recipeId) {
  const matches = (draft ?? []).filter((step) => String(step.text ?? "").includes(anchor));
  if (matches.length !== 1) {
    throw new Error(`${recipeId}: chef patch anchor «${anchor}» matches ${matches.length} steps; expected exactly one.`);
  }
  return matches[0];
}

function updateStepByAnchor(candidate, anchor, updater) {
  const draft = candidate.paraphrasedInstructionDraft ?? [];
  const target = findStepByAnchor(draft, anchor, candidate.id);
  return {
    ...candidate,
    paraphrasedInstructionDraft: draft.map((step) => step === target ? updater({ ...step }) : step),
  };
}

/* Замена подстроки в шаге, где она стоит; сама подстрока служит якорем. */
function replaceInAnchoredStep(candidate, from, to) {
  return updateStepByAnchor(candidate, from, (step) => ({ ...step, text: step.text.replace(from, to) }));
}

/* Карточки, чей драфт поварская правка заменяет целиком: текст редакционной
   карточки до runtime не доходит, шаги правятся здесь. */
export const chefDraftReplacementRecipeIds = Object.freeze([
  "new-sandwich-caesar",
  "new-sandwich-paprika",
  "tmpm-25006-strawberry-lime-sorbet",
  "goodfood-steak-broccoli-protein-pots",
  "goodfood-prawn-rice-mango-jar-salad",
]);

function appendIngredient(candidate, item) {
  return {
    ...candidate,
    ingredients: [...(candidate.ingredients ?? []), { ...item }],
    ...(Array.isArray(candidate.sourceIngredients)
      ? { sourceIngredients: [...candidate.sourceIngredients, { ...item }] }
      : {}),
  };
}

function repairPrawnRiceJar(candidate) {
  const current = candidate.sourceIngredients ?? candidate.ingredients ?? [];
  const riceIndexes = current
    .map((item, index) => /\brice\b/iu.test(String(item.name ?? "")) ? index : -1)
    .filter((index) => index >= 0);
  if (riceIndexes.length !== 2) throw new Error(`${candidate.id}: expected the documented duplicate rice rows.`);
  const ingredients = current.filter((_, index) => index !== riceIndexes[1]).map((item) => ({ ...item }));
  return setIngredientLists({
    ...candidate,
    time: { prepMinutes: 15, cookMinutes: 20, totalMinutes: 35 },
    paraphrasedInstructionDraft: [
      { id: "editorial-step-1", action: "cook", dependsOn: [], ingredientIds: ["source-ingredient-1"], duration: "по инструкции на упаковке", equipment: ["pot"], donenessCue: "рис мягкий, без твёрдой сердцевины", text: "Промойте и сварите 60 г сухого риса по инструкции на упаковке. Быстро охладите тонким слоем и уберите в холодильник не позднее чем через 2 часа." },
      { id: "editorial-step-2", action: "mix", dependsOn: ["editorial-step-1"], ingredientIds: ["source-ingredient-7", "source-ingredient-8", "source-ingredient-9"], equipment: ["mixing_bowl"], text: "Взбейте соевый соус, кунжутное масло и коричневый сахар; налейте заправку на дно банки." },
      { id: "editorial-step-3", action: "assemble", dependsOn: ["editorial-step-2"], ingredientIds: ["source-ingredient-1", "source-ingredient-2", "source-ingredient-3", "source-ingredient-4", "source-ingredient-5", "source-ingredient-6"], equipment: ["jar"], text: "На заправку выложите полностью охлаждённый рис, шпинат, готовые креветки, манго, чили и кинзу. Плотно закройте; перед едой встряхните." },
    ],
    storage: {
      ...candidate.storage,
      refrigeratorDays: 1,
      reheatToC: null,
      refrigerator: "Хранить не более 1 суток при температуре не выше 4 °C.",
      reheat: "Подавать охлаждённым, без повторного нагрева.",
    },
  }, ingredients);
}

function applyChefCorrections(candidate) {
  let next = repairSandwich(candidate);

  if (next.id === "tmpm-23228") {
    next = {
      ...next,
      slot: "snack1",
      packing: {
        ...next.packing,
        portion: "5 наггетсов",
        label: "Куриные наггетсы по-нэшвиллски · 5 шт. · дата готовки · хранить замороженными",
      },
    };
  }
  if (next.id === "tmpm-25006-strawberry-lime-sorbet") {
    next = {
      ...next,
      titleRu: "Клубничный лаймад-сорбет",
      paraphrasedInstructionDraft: next.paraphrasedInstructionDraft.slice(0, 1).map((step) => ({
        ...step,
        text: "Пробейте замороженную клубнику с кленовым сиропом, водой и соком лайма до гладкой густой массы. Подайте сразу.",
      })),
      storage: {
        refrigeratorDays: 0,
        freezerDays: 0,
        freezable: false,
        coolWithinHours: 0,
        reheatToC: null,
        refrigerator: "Готовить непосредственно перед подачей.",
        freezer: "Повторная заморозка этой порции не предусмотрена.",
        thaw: "Не требуется.",
        reheat: "Подавать сразу, без разогрева.",
        reference: storageReference,
      },
    };
  }
  if (next.id === "tmpm-26660") {
    const explicitDryConversion = {
      ...next.ingredients?.[9]?.miseSourceStateConversion,
      targetAmount: 360,
      factor: 0.48,
      basis: "source_explicit_dry_weight",
      evidenceRecipeId: next.id,
    };
    next = mapIngredientLists(next, (item, index) => index === 9 ? {
      ...item,
      amountMetric: 360,
      unitMetric: "g",
      original: "360 г сухого риса по источнику; после приготовления небольшая часть может остаться",
      miseSourceStateConversion: explicitDryConversion,
    } : item);
    next = {
      ...next,
      miseRiceDryWeightNormalization: {
        ...next.miseRiceDryWeightNormalization,
        ...explicitDryConversion,
      },
      paraphrasedInstructionDraft: next.paraphrasedInstructionDraft
        .filter((step) => step.id !== "mise-rice-dry-prep"),
    };
    next = replaceInAnchoredStep(next, "Вмешайте в готовый рис", "Примерно за час до конца сварите 360 г сухого риса; вмешайте в него");
  }
  if (["goodfood-slow-cooker-lamb-curry", "goodfood-mini-lentil-shepherds-pies"].includes(next.id)) {
    next = {
      ...next,
      storage: {
        ...next.storage,
        freezable: true,
        freezerDays: 90,
        freezer: "Порционно заморозить после полного охлаждения; использовать в течение 3 месяцев.",
        thaw: "Разморозить в холодильнике, затем разогреть до 74 °C в центре порции.",
      },
    };
  }
  if (next.id === "new-home-cutlets-mash") {
    const sourceCount = (next.sourceIngredients ?? next.ingredients ?? []).length;
    next = appendIngredient(next, ingredient("sunflower_oil_processed", "Подсолнечное масло", 17, "17 г · источник"));
    next = updateStepByAnchor(next, "Обжарьте по 3–4 минуты с каждой стороны", (step) => ({
      ...step,
      text: `Разогрейте 17 г подсолнечного масла. ${step.text}`,
      ingredientIds: [...step.ingredientIds, `source-ingredient-${sourceCount + 1}`],
    }));
  }
  if (["new-sandwich-boiled-chicken", "new-sandwich-turkey-ham"].includes(next.id)) {
    next = replaceInAnchoredStep(next, "овощи и всю белковую порцию", "овощи, сыр и всю мясную порцию");
  }
  if (next.id === "foodru-oblomov-chashushuli") {
    next = updateStepByAnchor(next, "Обжарьте говядину партиями до румяной корочки", (step) => ({
      ...step,
      text: "На половине сливочного масла обжарьте говядину партиями до румяной корочки; на оставшемся масле обжарьте лук и сладкий перец.",
    }));
  }
  if (next.id === "foodru-oblomov-sandwich") {
    next = updateStepByAnchor(next, "Обжарьте курицу до 74°C в центре", (step) => ({
      ...step,
      text: "Разогрейте 10 г растительного масла и обжарьте курицу до 74 °C в центре; дайте отдохнуть 5 минут.",
    }));
  }
  if (next.id === "foodru-blogger-chicken-bombs") {
    next = {
      ...next,
      time: { ...next.time, totalMinutes: 125 },
    };
    next = updateStepByAnchor(next, "Сформуйте куриные «бомбочки»", (step) => ({
      ...step,
      text: "Сформуйте куриные «бомбочки» с грибной начинкой и охладите 60–90 минут, чтобы они держали форму. Разогрейте духовку до 180 °C и запекайте около 40 минут, до 74 °C внутри; отдельно приготовьте сухой рис.",
      duration: "охлаждение 60–90 мин; выпекание около 40 мин",
      temperatureC: 180,
    }));
  }
  if (next.id === "tmpm-26489") {
    next = updateStepByAnchor(next, "запекайте 20–30 минут", (step) => ({
      ...step,
      text: step.text.replace("запекайте 20–30 минут", "запекайте 20–30 минут, до 74 °C в центре"),
      donenessCue: "курица достигла 74 °C, паста упругая",
    }));
  }
  if (next.id === "tmpm-25159") {
    next = updateStepByAnchor(next, "На среднем-сильном огне обжарьте", (step) => ({
      ...step,
      text: step.text.replace("На среднем-сильном огне обжарьте", "Разогрейте масло на среднем-сильном огне и обжарьте"),
      ingredientIds: [...step.ingredientIds, "source-ingredient-13"],
    }));
  }
  if (next.id === "goodfood-banana-overnight-oats") {
    next = updateStepByAnchor(next, "протеинового порошка", (step) => ({
      ...step,
      ingredientIds: step.ingredientIds.includes("source-ingredient-9")
        ? step.ingredientIds
        : [...step.ingredientIds, "source-ingredient-9"],
    }));
  }

  return applyGoodFoodChefCorrections(next);
}

function applyGoodFoodChefCorrections(candidate) {
  let next = candidate;

  if (next.id === "goodfood-sausage-leek-mash-pie") {
    next = replaceInAnchoredStep(
      next,
      "В глубокой сковороде обжарьте колбасный фарш",
      "Снимите оболочку с сосисок и выдавите фарш. В глубокой сковороде обжарьте его",
    );
  }
  if (next.id === "goodfood-slow-cooker-beef-bourguignon") {
    // Картофель дописывается к шагу с последним этапом рагу «за 35 минут до подачи».
    next = updateStepByAnchor(next, "За 35 минут до подачи", (step) => ({
      ...step,
      text: `${step.text} За 25 минут до подачи очистите картофель, нарежьте равными кусками, сварите 15–20 минут до мягкости, слейте воду и разомните с небольшим количеством отвара; подайте с рагу.`,
      duration: [step.duration, "картофель 15–20 мин"].filter(Boolean).join("; "),
    }));
  }
  if (next.id === "goodfood-vegetarian-bolognese") {
    next = mapIngredientLists(next, (item, index) => index === 11 ? {
      ...item,
      id: "pasta_raw",
      name: "dry spaghetti",
      displayNameRu: "Спагетти сухие",
      amountMetric: 250,
      unitMetric: "g",
      original: "250 г сухих спагетти по массе из источника",
    } : item);
    next = replaceInAnchoredStep(
      next,
      " и подайте с пастой.",
      ". Пока соус томится, сварите 250 г сухих спагетти до аль денте по инструкции на упаковке, слейте воду и подайте с соусом.",
    );
  }
  if (next.id === "goodfood-family-meals-easy-fish-cakes") {
    next = replaceInAnchoredStep(next, "Разомните с небольшим количеством сливочного масла", "Разомните в сухое однородное пюре");
  }
  if (next.id === "goodfood-roasted-tomato-pancetta-picnic-quiches") {
    const dropEquipment = (list) => list.filter((_, index) => index !== 10).map((item) => ({ ...item }));
    next = replaceInAnchoredStep(next, "выложите в формы", "выложите в 10 форм для тарталеток диаметром около 7,5 см");
    next = {
      ...next,
      ingredients: dropEquipment(next.ingredients ?? []),
      ...(Array.isArray(next.sourceIngredients) ? { sourceIngredients: dropEquipment(next.sourceIngredients) } : {}),
      paraphrasedInstructionDraft: next.paraphrasedInstructionDraft.map((step) => ({
        ...step,
        ingredientIds: (step.ingredientIds ?? []).filter((id) => id !== "source-ingredient-11"),
      })),
      storage: {
        ...next.storage,
        reheatToC: null,
        reheat: "Подавать охлаждёнными или при комнатной температуре.",
      },
    };
  }
  if (next.id === "goodfood-steak-broccoli-protein-pots") {
    next = {
      ...next,
      time: { prepMinutes: 10, cookMinutes: 25, totalMinutes: 35 },
      paraphrasedInstructionDraft: [
        { id: "editorial-step-1", action: "cook", dependsOn: [], ingredientIds: ["source-ingredient-1"], duration: "по инструкции на упаковке", equipment: ["pot"], donenessCue: "рис мягкий, без твёрдой сердцевины", text: "Промойте и сварите 120 г сухого риса по инструкции на упаковке. Быстро охладите до тёплого состояния." },
        { id: "editorial-step-2", action: "steam", dependsOn: ["editorial-step-1"], ingredientIds: ["source-ingredient-2", "source-ingredient-3", "source-ingredient-4"], duration: "5 мин", equipment: ["microwave"], donenessCue: "брокколи горячая и слегка мягкая", text: "Смешайте готовый рис с имбирём и зелёной частью лука. Брокколи и белую часть лука положите в посуду с 4 ст. л. воды, накройте и готовьте в микроволновой печи около 5 минут до лёгкой мягкости." },
        { id: "editorial-step-3", action: "fry", dependsOn: ["editorial-step-2"], ingredientIds: ["source-ingredient-1", "source-ingredient-2", "source-ingredient-3", "source-ingredient-4", "source-ingredient-5"], duration: "около 4 мин; отдых 3 мин", equipment: ["skillet", "probe_thermometer"], donenessCue: "в центре стейка не менее 63 °C, затем отдых 3 минуты", text: "На хорошо разогретой антипригарной сковороде обжарьте стейк примерно по 2 минуты с каждой стороны, но ориентируйтесь на термометр: в центре должно быть не менее 63 °C. Снимите с огня и дайте отдохнуть 3 минуты. Белые части лука обуглите в мясном соке. Разложите рис, брокколи и нарезанный стейк по двум контейнерам." },
      ],
      storage: {
        ...next.storage,
        refrigeratorDays: 2,
        refrigerator: "До 2 суток при температуре не выше 4 °C; убрать в холодильник не позднее чем через 2 часа после приготовления.",
      },
    };
  }
  if (next.id === "goodfood-black-bean-soup-with-chunky-raita") {
    next = replaceInAnchoredStep(
      next,
      "Отдельно смешайте компоненты райты.",
      "Отдельно смешайте нарезанные авокадо и черри с зелёным луком, лимонным соком, йогуртом и кинзой — это райта.",
    );
  }
  if (next.id === "goodfood-prawn-rice-mango-jar-salad") {
    next = repairPrawnRiceJar(next);
  }
  if (next.id === "goodfood-roasted-lemony-broccoli-mascarpone-flatbreads") {
    const additions = [
      ingredient(null, "Копчёная паприка", 4, "2 ч. л. из карточки компонента", { name: "smoked paprika" }),
      ingredient(null, "Кайенский перец", 2, "1 ч. л. из карточки компонента", { name: "cayenne pepper" }),
      ingredient("lemon_raw", "Лимонная цедра", 5, "цедра 1 лимона из карточки компонента", { name: "lemon zest" }),
    ];
    for (const item of additions) next = appendIngredient(next, item);
    next = {
      ...next,
      time: { prepMinutes: 30, cookMinutes: 50, totalMinutes: 200 },
    };
    next = updateStepByAnchor(next, "щепоткой кайенского перца", (step) => ({
      ...step,
      ingredientIds: [...step.ingredientIds, "source-ingredient-26", "source-ingredient-27", "source-ingredient-28"],
    }));
  }
  const correctedTimes = {
    "goodfood-lemon-orzo-with-trout-spiced-broccoli-peperonata": 75,
    "goodfood-meatball-chickpea-yellow-coconut-curry-with-rice-pickled-red-cabbage": 75,
    "goodfood-black-bean-spicy-beef-pasta": 230,
    "goodfood-harissa-beef-tomato-bulgur": 230,
  };
  if (correctedTimes[next.id]) {
    next = { ...next, time: { ...next.time, totalMinutes: correctedTimes[next.id] } };
  }
  if (next.id === "goodfood-bulgur-quinoa-lunch-bowls") {
    next = {
      ...next,
      titleRu: "Боулы из булгура и киноа: два варианта",
      time: { ...next.time, totalMinutes: 30 },
      packing: {
        ...next.packing,
        portion: "1 контейнер; в партии 2 авокадо-томатных и 2 свекольно-нутовых боула",
        label: "Боул из булгура и киноа · вариант на этикетке · дата готовки",
      },
    };
  }

  return next;
}

/* Строка без явного id получает продукт из таблицы алиасов движка — так же, как
   при расчёте карточки. Неучтённая в КБЖУ строка (приправа, вода) продукта не
   имеет: у неё `canonicalIngredientId` null и статус ignored_*. */
function currentMapping(item) {
  if (item.id) return { canonicalIngredientId: item.id, status: "mapped" };
  const draft = normalizeRawRecipeCandidate(
    { id: "ingredient-identity-rule", sourceUrl: "", ingredients: [item] },
    { publisher: "", accessedAt: "" },
  );
  const mapping = draft.ingredientMappings[0];
  return { canonicalIngredientId: mapping?.canonicalIngredientId ?? null, status: mapping?.status ?? "unresolved" };
}

/* Правило со `fromCanonicalIngredientId: null` переводит строку, которую движок
   сейчас не считает продуктом (`fromStatus`: ignored_microcomponent или
   ignored_noncaloric), например «115 g pepper» пеперонаты, принятые за
   чёрный перец. Такая строка должна быть измерена, иначе её нельзя посчитать. */
const identityRuleUncountedStatuses = new Set(["ignored_microcomponent", "ignored_noncaloric"]);

function identityRuleMatches(item, rule) {
  const mapping = currentMapping(item);
  if (rule.fromCanonicalIngredientId === null) {
    return mapping.canonicalIngredientId === null && mapping.status === rule.fromStatus;
  }
  return mapping.canonicalIngredientId === rule.fromCanonicalIngredientId;
}

function identityRuleSource(rule) {
  return rule.fromCanonicalIngredientId === null ? `uncounted ${rule.fromStatus}` : rule.fromCanonicalIngredientId;
}

/* Карточка называет конкретный продукт («Цельнозерновой хлеб»), а в составе он
   сопоставлен с общим профилем («Хлеб») — явным id корпуса или алиасом, общим с
   другими карточками. Правило политики задаёт продукт явно только для
   перечисленных карточек. Оно идёт после поварских правок: они пересобирают
   состав сэндвичей целиком и вернули бы прежнее сопоставление. */
function applyIngredientIdentityRules(candidate, policy) {
  let next = candidate;
  for (const rule of policy.ingredientIdentityRules) {
    if (!rule.recipeIds.includes(next.id)) continue;
    const sourceName = rule.sourceName.toLowerCase();
    const remap = (list) => {
      let matches = 0;
      const mapped = list.map((item) => {
        if (normalizedSourceName(item) !== sourceName || !identityRuleMatches(item, rule)) return item;
        if (rule.fromCanonicalIngredientId === null && !(Number(item.amountMetric) > 0)) {
          throw new Error(`${next.id}: «${rule.sourceName}» has no measured amount and cannot become ${rule.canonicalIngredientId}.`);
        }
        matches += 1;
        return { ...item, id: rule.canonicalIngredientId };
      });
      if (matches !== 1) {
        throw new Error(`${next.id}: expected one «${rule.sourceName}» mapped to ${identityRuleSource(rule)}, found ${matches}.`);
      }
      return mapped;
    };
    next = {
      ...next,
      ingredients: remap(next.ingredients ?? []),
      ...(Array.isArray(next.sourceIngredients) ? { sourceIngredients: remap(next.sourceIngredients) } : {}),
    };
  }
  return next;
}

function applyCandidatePolicy(candidate, policy, quarantines) {
  let next = clone(candidate);
  next.ingredients = (next.ingredients ?? []).map((item) => ingredientWithDisplayRule(item, policy, next.id));
  if (Array.isArray(next.sourceIngredients)) {
    next.sourceIngredients = next.sourceIngredients.map((item) => ingredientWithDisplayRule(item, policy, next.id));
  }
  next.titleRu = replaceGlossaryText(next.titleRu, next.id, policy);
  if (next.packing) {
    next.packing = Object.fromEntries(Object.entries(next.packing).map(([key, value]) => [
      key,
      replaceGlossaryText(value, next.id, policy),
    ]));
  }
  if (next.storage) {
    next.storage = Object.fromEntries(Object.entries(next.storage).map(([key, value]) => [
      key,
      replaceGlossaryText(value, next.id, policy),
    ]));
  }
  next.paraphrasedInstructionDraft = (next.paraphrasedInstructionDraft ?? []).map((step) => ({
    ...step,
    text: replaceGlossaryText(step.text, next.id, policy),
  }));
  next = normalizeTemperatures(next, policy);
  next = normalizeStorage(next, policy);
  next = normalizeRiceSteps(next, policy);
  next = applyChefCorrections(next);
  next = applyIngredientIdentityRules(next, policy);
  const quarantine = quarantines.get(next.id);
  if (quarantine) {
    next.miseProofreadQuarantine = {
      kind: "recipe_proofread_quarantine_v1",
      ...quarantine,
      reviewedAt: policy.reviewedAt,
    };
  }
  next.miseProofreadNormalization = {
    kind: "recipe_proofread_policy_v1",
    registry: "data/recipe-proofread-policy.json",
    reviewedAt: policy.reviewedAt,
  };
  return next;
}

function allPolicyRecipeIds(policy) {
  return [
    ...policy.hotReheatRecipeIds,
    ...policy.freezerRecipeIds,
    ...policy.coldNoReheatRecipeIds,
    ...policy.riceStepDeduplicateRecipeIds,
    ...policy.dropAppendedRiceStepRecipeIds,
    ...policy.ingredientIdentityRules.flatMap((rule) => rule.recipeIds),
    ...policy.quarantine.map((item) => item.id),
  ];
}

export async function applyRecipeProofreadPolicy({ documents }) {
  const [policy, review] = await Promise.all([
    readFile(policyUrl, "utf8").then(JSON.parse),
    readFile(reviewUrl, "utf8").then(JSON.parse),
  ]);
  if (
    policy.schemaVersion !== 1 ||
    policy.approvedBy !== "owner" ||
    !Array.isArray(policy.quarantine) ||
    !Array.isArray(policy.ingredientDisplayRules) ||
    !Array.isArray(policy.ingredientIdentityRules)
  ) {
    throw new Error("Recipe proofread policy is missing or invalid.");
  }
  for (const rule of policy.ingredientIdentityRules) {
    if (
      !Array.isArray(rule.recipeIds) ||
      !rule.recipeIds.length ||
      new Set(rule.recipeIds).size !== rule.recipeIds.length ||
      ![rule.sourceName, rule.canonicalIngredientId, rule.reviewedAt, rule.note].every((value) => typeof value === "string" && value.trim()) ||
      !(
        (typeof rule.fromCanonicalIngredientId === "string" && rule.fromCanonicalIngredientId.trim() && rule.fromStatus === undefined) ||
        (rule.fromCanonicalIngredientId === null && identityRuleUncountedStatuses.has(rule.fromStatus))
      )
    ) {
      throw new Error("Recipe proofread ingredient identity rule is incomplete.");
    }
    for (const id of [rule.fromCanonicalIngredientId, rule.canonicalIngredientId].filter((value) => value !== null)) {
      if (!canonicalIngredients[id]) throw new Error(`Recipe proofread ingredient identity rule names an unknown product ${id}.`);
    }
  }
  const ids = new Set(documents.flatMap((document) => document.candidates.map((candidate) => candidate.id)));
  if (ids.size !== policy.reviewedCandidateCount) {
    throw new Error(`Recipe proofread policy covers ${policy.reviewedCandidateCount} cards, but corpus has ${ids.size}.`);
  }
  const quarantines = new Map();
  for (const item of review.exclusions ?? []) quarantines.set(item.id, { code: "owner_excluded", note: item.note });
  for (const item of policy.quarantine) quarantines.set(item.id, item);
  const referencedIds = [...allPolicyRecipeIds(policy), ...quarantines.keys()];
  const unknown = [...new Set(referencedIds)].filter((id) => !ids.has(id));
  if (unknown.length) throw new Error(`Recipe proofread policy references unknown cards: ${unknown.join(", ")}`);
  return documents.map((document) => ({
    ...document,
    candidates: document.candidates.map((candidate) => applyCandidatePolicy(candidate, policy, quarantines)),
  }));
}
