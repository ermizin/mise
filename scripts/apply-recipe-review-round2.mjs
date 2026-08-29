import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DATASET_PATHS = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
];
const EDITORIAL_PATHS = [
  "data/recipe-editorial/cards-a.json",
  "data/recipe-editorial/cards-b.json",
  "data/recipe-editorial/cards-c.json",
];

const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
const ingredient = (name, amountMetric, unitMetric = "g", original = `${amountMetric} ${unitMetric} ${name}`) => ({
  name,
  ...(amountMetric == null ? {} : { amountMetric: String(amountMetric), unitMetric }),
  original,
});
const allIngredientIds = (candidate) => candidate.ingredients.map((_, index) => `source-ingredient-${index + 1}`);
const reindexSteps = (candidate) => {
  const ingredientIds = allIngredientIds(candidate);
  candidate.paraphrasedInstructionDraft = candidate.paraphrasedInstructionDraft.map((step) => ({ ...step, ingredientIds }));
};
const recipeStep = (id, text, ingredientCount, action, extra = {}) => ({
  id,
  text,
  ingredientIds: Array.from({ length: ingredientCount }, (_, index) => `source-ingredient-${index + 1}`),
  action,
  dependsOn: id === "editorial-step-1" ? [] : [`editorial-step-${Number(id.split("-").at(-1)) - 1}`],
  ...extra,
});
const sourceFact = (order, action, extra = {}) => ({
  id: `source-step-${order}`,
  order,
  actions: [action],
  action,
  text: "",
  ingredientIds: [],
  ...extra,
});

async function atomicWrite(path, document) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function applyPiecePortion(candidate, { sourcePieces, portions, label }) {
  const sourcePerPiece = { ...candidate.macros };
  candidate.sourcePieceYield = {
    pieces: sourcePieces,
    originalMacrosPerPiece: sourcePerPiece,
    reviewBasis: "КБЖУ источника были указаны на одну штуку; Mise пересчитал их на бытовую порцию.",
  };
  candidate.servings = portions;
  candidate.macros = Object.fromEntries(Object.entries(sourcePerPiece).map(([key, value]) => [key, round((Number(value) * sourcePieces) / portions)]));
  candidate.packing.portion = `${label} (1/${portions} партии)`;
}

function patchExplicitMealPrepDecisions(byId) {
  const rounded = byId.get("tmpm-28584");
  const originalServings = Number(rounded.servings);
  rounded.sourceYield = { servings: originalServings, resolution: "Округлено владельцем до 10 равных порций." };
  rounded.servings = 10;
  rounded.macros = Object.fromEntries(Object.entries(rounded.macros).map(([key, value]) => [key, round((Number(value) * originalServings) / 10)]));
  rounded.packing.portion = "1/10 готового блюда";

  const piecePortions = {
    "tmpm-26965": { sourcePieces: 60, portions: 10, label: "6 наггетсов" },
    "tmpm-26920": { sourcePieces: 40, portions: 20, label: "2 такитос" },
    "tmpm-26514": { sourcePieces: 80, portions: 20, label: "4 булочки" },
    "tmpm-25453": { sourcePieces: 84, portions: 17, label: "примерно 5 фрикаделек" },
    "tmpm-25030": { sourcePieces: 35, portions: 12, label: "примерно 3 панкейка" },
    "tmpm-24917": { sourcePieces: 30, portions: 15, label: "2 маффина" },
    "tmpm-24851": { sourcePieces: 80, portions: 20, label: "4 булочки" },
    "tmpm-24799": { sourcePieces: 47, portions: 16, label: "примерно 3 мини-тако" },
    "tmpm-24579": { sourcePieces: 48, portions: 8, label: "6 кусочков" },
    "tmpm-10514": { sourcePieces: 40, portions: 13, label: "примерно 3 вафли" },
    "tmpm-23518": { sourcePieces: 12, portions: 6, label: "2 маффина" },
    "tmpm-23228": { sourcePieces: 90, portions: 18, label: "5 наггетсов" },
    "tmpm-22550": { sourcePieces: 83, portions: 17, label: "примерно 5 фрикаделек" },
    "tmpm-22181": { sourcePieces: 48, portions: 5, label: "примерно 10 шариков" },
    "tmpm-18065": { sourcePieces: 49, portions: 7, label: "7 крокетов" },
    "tmpm-16283": { sourcePieces: 36, portions: 12, label: "3 хэшбрауна" },
    "tmpm-16249": { sourcePieces: 48, portions: 10, label: "примерно 5 кусочков" },
  };
  for (const [id, settings] of Object.entries(piecePortions)) {
    const candidate = byId.get(id);
    if (candidate) applyPiecePortion(candidate, settings);
  }
  applyPiecePortion(byId.get("tmpm-26689"), { sourcePieces: 12, portions: 6, label: "2 панкейка" });

  const pancakes = byId.get("tmpm-26689");
  pancakes.paraphrasedInstructionDraft[1] = {
    ...pancakes.paraphrasedInstructionDraft[1],
    text: "Аккуратно соедините блендерную смесь с белками, затем вмешайте сухие ингредиенты. Вылейте тесто на застеленный пергаментом и слегка смазанный противень 43 × 28 см, разровняйте. Выпекайте при 191 °C 20 минут, пока центр полностью не схватится и не станет упругим. Остудите и разрежьте на 12 частей. Замораживайте сначала одним слоем; разогревайте 1–2 минуты в микроволновке.",
    temperatureC: 191,
    duration: "20 мин",
    donenessCue: "центр полностью схватился и упругий",
  };
  pancakes.proceduralStatus = "ready";
  pancakes.proceduralBlockers = [];

  const loadedPotatoes = byId.get("tmpm-26528");
  loadedPotatoes.paraphrasedInstructionDraft[0] = {
    ...loadedPotatoes.paraphrasedInstructionDraft[0],
    text: "Разогрейте духовку до 204 °C. Нарежьте картофель кубиками, посолите, поперчите, перемешайте с оливковым маслом и запекайте 25 минут, перемешав примерно на середине, до румяной мягкости. Нарежьте лук, поблано и грибы крупно, кабачок средними кубиками; быстро обжарьте овощи в масле, сохранив упругость.",
    temperatureC: 204,
    duration: "25 мин",
    donenessCue: "картофель румяный и мягкий внутри",
  };
  loadedPotatoes.paraphrasedInstructionDraft[1] = {
    ...loadedPotatoes.paraphrasedInstructionDraft[1],
    text: "На второй сковороде обжарьте фарш до исчезновения розовых участков и равномерного подрумянивания. Добавьте томатный соус, паприку, чесночный порошок, кумин и соль и готовьте ещё 3–5 минут. Для кесо прогрейте творог, оба сыра, молоко, чесночный порошок, чипотле и соль около минуты и пробейте блендером. Храните соус отдельно; картофель для хрустящей корочки разогревайте 6 минут при 200 °C в аэрогриле.",
    duration: "фарш до готовности; после соуса ещё 3–5 мин",
    donenessCue: "фарш равномерно подрумянен, розовых участков нет",
  };
  loadedPotatoes.proceduralStatus = "ready";
  loadedPotatoes.proceduralBlockers = [];

  const chicken = byId.get("tmpm-25304");
  chicken.paraphrasedInstructionDraft[1] = {
    ...chicken.paraphrasedInstructionDraft[1],
    text: "Запекайте при 204 °C 8–9 минут, пока самый толстый кусочек не достигнет 74 °C внутри. Приподнимите один край противня, чтобы жидкость стекла в сторону, и остудите, пока мясо перестанет парить. Переложите на меньший противень, заморозьте открытыми одним слоем до твёрдости, затем упакуйте герметично. Пищевая порция — 100 г готовой курицы.",
    temperatureC: 204,
    duration: "8–9 мин",
    donenessCue: "74 °C в центре самого толстого кусочка",
  };
  chicken.proceduralStatus = "ready";
  chicken.proceduralBlockers = [];

  const oatmeal = byId.get("tmpm-25290");
  oatmeal.paraphrasedInstructionDraft[1] = {
    ...oatmeal.paraphrasedInstructionDraft[1],
    text: "Соедините сухую и жидкую смеси, переложите в смазанную форму 33 × 23 см и выпекайте при 177 °C 55–60 минут, пока центр полностью не схватится. Для топпинга слегка прогрейте арахисовую пасту, смешайте с сиропом и корицей и нанесите на остывшую овсянку.",
    temperatureC: 177,
    duration: "55–60 мин",
    donenessCue: "центр полностью схватился",
  };
  oatmeal.proceduralStatus = "ready";
  oatmeal.proceduralBlockers = [];
}

function replaceNamedIngredient(candidate, matcher, replacements) {
  const index = candidate.ingredients.findIndex((item) => matcher.test(String(item.name)));
  if (index < 0) return false;
  candidate.ingredients.splice(index, 1, ...replacements);
  reindexSteps(candidate);
  return true;
}

function patchCommonRiceWeights(candidates) {
  for (const candidate of candidates) {
    const servings = Number(candidate.servings);
    if (!Number.isFinite(servings) || servings <= 0) continue;
    for (const item of candidate.ingredients) {
      if (item.amountMetric != null) continue;
      const name = String(item.name).toLowerCase();
      if (!/(?:^|\b)(?:cooked |jasmine )?rice(?:\b|$)/u.test(name)) continue;
      if (/\b(?:or|and\/or|bread|dahl)\b/u.test(name) && !/^cooked rice and\/or dahl$/u.test(name)) continue;
      const grams = Math.round(servings * 60);
      item.name = "rice";
      item.amountMetric = String(grams);
      item.unitMetric = "g";
      item.original = `${grams} г сухого риса (сварить; примерно по 60 г на порцию)`;
      item.reviewResolution = "Бытовой стандарт Mise: 60 г сухого риса на порцию, если источник указал только cooked rice/to serve без массы.";
      if (!candidate.paraphrasedInstructionDraft.some((step) => /сварите рис/iu.test(step.text))) {
        candidate.paraphrasedInstructionDraft.push(recipeStep(
          `editorial-step-${candidate.paraphrasedInstructionDraft.length + 1}`,
          "Промойте сухой рис, сварите по инструкции на упаковке до готовности и подайте с основным блюдом.",
          candidate.ingredients.length,
          "cook",
          { equipment: ["pot"], donenessCue: "рис мягкий, без твёрдой сердцевины" },
        ));
      }
      reindexSteps(candidate);
    }
  }
}

function patchGoodFoodComponents(byId) {
  const creamyBeans = (grams) => [
    ingredient("canned white beans drained", Math.round(grams * 0.8), "g", `${Math.round(grams * 0.8)} г белой фасоли без жидкости`),
    ingredient("water or vegetable broth", Math.round(grams * 0.2), "ml", `${Math.round(grams * 0.2)} мл воды или овощного бульона`),
  ];
  const salsaVerde = () => [
    ingredient("parsley", 15, "g", "15 г петрушки"),
    ingredient("capers", 10, "g", "10 г каперсов"),
    ingredient("olive oil", 25, "ml", "25 мл оливкового масла"),
    ingredient("lemon juice", 10, "ml", "10 мл лимонного сока"),
  ];

  for (const [id, beanAmount] of [["goodfood-creamy-bean-kale-pasta", 550], ["goodfood-chickpea-spinach-gratin-with-salsa-verde", 600]]) {
    const candidate = byId.get(id);
    replaceNamedIngredient(candidate, /^creamy beans/iu, creamyBeans(beanAmount));
    replaceNamedIngredient(candidate, /^salsa verde/iu, salsaVerde());
    candidate.proceduralStatus = "ready";
    candidate.proceduralBlockers = [];
  }
  const pasta = byId.get("goodfood-creamy-bean-kale-pasta");
  pasta.paraphrasedInstructionDraft[0].text = "Слейте жидкость с белой фасоли и разомните вилкой примерно треть зёрен. Смешайте с оставшейся фасолью и водой или бульоном, переложите в широкую глубокую сковороду и прогрейте на сильном огне. Всыпьте пасту, влейте 750 мл кипятка и посолите.";
  pasta.paraphrasedInstructionDraft.push(recipeStep("editorial-step-3", "Для сальса-верде мелко порубите петрушку и каперсы, смешайте с оливковым маслом и лимонным соком. Полейте готовую пасту.", pasta.ingredients.length, "mix", { equipment: ["mixing_bowl"] }));
  reindexSteps(pasta);

  const gratin = byId.get("goodfood-chickpea-spinach-gratin-with-salsa-verde");
  gratin.paraphrasedInstructionDraft[1].text = "Слейте жидкость с белой фасоли и разомните вилкой примерно треть зёрен. В жаропрочной форме соедините всю фасоль, шпинат, нут, воду или бульон и крем-фреш. Поставьте форму на средний огонь, доведите до слабого кипения, снимите, посыпьте пармезаном и запекайте 10 минут до золотистых пузырьков.";
  gratin.paraphrasedInstructionDraft.push(recipeStep("editorial-step-3", "Для сальса-верде мелко порубите петрушку и каперсы, смешайте с оливковым маслом и лимонным соком. Добавьте соус перед подачей.", gratin.ingredients.length, "mix", { equipment: ["mixing_bowl"] }));
  reindexSteps(gratin);

  const currySauce = (scale) => [
    ingredient("red chilli", round(10 * scale), "g"),
    ingredient("garlic", round(25 * scale), "g"),
    ingredient("shallots", round(200 * scale), "g"),
    ingredient("ginger", round(50 * scale), "g"),
    ingredient("coriander", round(25 * scale), "g"),
    ingredient("light brown sugar", round(12 * scale), "g"),
    ingredient("sunflower oil", round(30 * scale), "ml"),
    ingredient("onion", round(110 * scale), "g"),
    ingredient("coconut milk", round(400 * scale), "ml"),
    ingredient("chicken broth", round(500 * scale), "ml"),
  ];
  const prawnRice = byId.get("goodfood-coconut-rice-with-prawn-stir-fry");
  replaceNamedIngredient(prawnRice, /^yellow coconut curry sauce/iu, currySauce(200 / 1400));
  prawnRice.paraphrasedInstructionDraft.unshift(recipeStep("editorial-step-1", "Пробейте чили, чеснок, шалот, имбирь, кинзу и сахар в пасту. Обжарьте лук с маслом и щепотками куркумы, мягкого карри, кориандра и кумина 8–10 минут, добавьте пасту ещё на 5 минут. Влейте кокосовое молоко и бульон и томите 20–25 минут до лёгкого загустения.", prawnRice.ingredients.length, "simmer", { duration: "20–25 мин", equipment: ["blender", "pot"], donenessCue: "соус слегка загустел" }));
  prawnRice.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
  reindexSteps(prawnRice);
  prawnRice.proceduralStatus = "ready";
  prawnRice.proceduralBlockers = [];

  const meatballCurry = byId.get("goodfood-meatball-chickpea-yellow-coconut-curry-with-rice-pickled-red-cabbage");
  replaceNamedIngredient(meatballCurry, /^spiced meatballs/iu, [
    ingredient("turkey thigh mince", 420, "g"),
    ingredient("garlic", 5, "g"),
    ingredient("lemon zest", 6, "g"),
    ingredient("parsley", 12, "g"),
  ]);
  replaceNamedIngredient(meatballCurry, /^yellow coconut curry sauce/iu, currySauce(800 / 1400));
  replaceNamedIngredient(meatballCurry, /^pickled red cabbage/iu, [
    ingredient("red cabbage", 170, "g"),
    ingredient("lemon juice", 15, "ml"),
    ingredient("olive oil", 10, "ml"),
    ingredient("caster sugar", 2, "g"),
    ingredient("mint", 5, "g"),
    ingredient("parsley", 5, "g"),
    ingredient("red onion", 30, "g"),
  ]);
  meatballCurry.paraphrasedInstructionDraft.unshift(
    recipeStep("editorial-step-1", "Смешайте фарш индейки с чесноком, лимонной цедрой, петрушкой, кумином, сумахом, душистым перцем, солью и перцем; сформуйте фрикадельки примерно по 20 г.", meatballCurry.ingredients.length, "mix", { equipment: ["mixing_bowl"] }),
    recipeStep("editorial-step-2", "Для соуса пробейте чили, чеснок, шалот, имбирь, кинзу и сахар в пасту. Обжарьте лук с маслом и щепотками куркумы, мягкого карри, кориандра и кумина 8–10 минут, добавьте пасту ещё на 5 минут. Влейте кокосовое молоко и бульон и томите 20–25 минут до лёгкого загустения.", meatballCurry.ingredients.length, "simmer", { duration: "20–25 мин", equipment: ["blender", "pot"], donenessCue: "соус слегка загустел" }),
    recipeStep("editorial-step-3", "Для маринованной капусты смешайте лимонный сок, оливковое масло и сахар. Добавьте тонко нашинкованную капусту, мяту, петрушку и красный лук и хорошо перемешайте.", meatballCurry.ingredients.length, "mix", { equipment: ["mixing_bowl"] }),
  );
  meatballCurry.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
  reindexSteps(meatballCurry);
  meatballCurry.proceduralStatus = "ready";
  meatballCurry.proceduralBlockers = [];
}

function splitSnackAggregate(document) {
  const index = document.candidates.findIndex((candidate) => candidate.id === "tmpm-25006");
  if (index < 0) return;
  const base = document.candidates[index];
  const make = ({ id, title, titleRu, macros, ingredients, steps, time = base.time }) => ({
    ...base,
    id,
    title,
    sourceTitle: `${base.sourceTitle} — ${title}`,
    titleRu,
    time,
    servings: 1,
    macros,
    ingredients,
    sourceInstructionCount: steps.length,
    instructionFacts: steps.map((step, i) => sourceFact(i + 1, step.action, { ...(step.durationMinutes ? { durationMinutes: step.durationMinutes } : {}), ...(step.equipment ? { equipment: step.equipment } : {}) })),
    paraphrasedInstructionDraft: steps.map((step, i) => recipeStep(`editorial-step-${i + 1}`, step.text, ingredients.length, step.action, { ...(step.duration ? { duration: step.duration } : {}), ...(step.equipment ? { equipment: step.equipment } : {}), ...(step.donenessCue ? { donenessCue: step.donenessCue } : {}) })),
    proceduralStatus: "ready",
    proceduralBlockers: [],
    packing: { ...base.packing, portion: "вся указанная порция", label: `${titleRu} · дата готовки` },
  });
  const split = [
    make({
      id: "tmpm-25006-hash-brown-breakfast-bowl",
      title: "Five-Minute Hash Brown Breakfast Bowl",
      titleRu: "Завтрак с хэшбрауном и яичным белком",
      macros: { kcal: 237, protein: 22.4, fat: 6.1, carbs: 23.1 },
      ingredients: base.ingredients.slice(0, 7),
      steps: [
        { action: "microwave", durationMinutes: [1], duration: "1 мин", equipment: ["microwave"], text: "Разогрейте хэшбраун в миске в микроволновке 1 минуту. Добавьте яичный белок, перемешайте и прогревайте короткими интервалами, пока белок полностью не схватится.", donenessCue: "яичный белок полностью схватился" },
        { action: "mix", text: "Добавьте йогурт, чеддер, зелёный лук и по желанию хрустящее масло с чили. Приправьте и подавайте." },
      ],
    }),
    make({
      id: "tmpm-25006-avocado-bean-rice-cakes",
      title: "Avocado and White Bean Rice Cakes",
      titleRu: "Рисовые хлебцы с авокадо и белой фасолью",
      macros: { kcal: 439, protein: 13.5, fat: 16.5, carbs: 64.5 },
      ingredients: base.ingredients.slice(7, 13),
      steps: [
        { action: "mash", text: "Разомните авокадо с белой фасолью и лимонным соком, посолите и поперчите." },
        { action: "assemble", text: "Распределите смесь по четырём рисовым хлебцам и посыпьте приправой для бейглов." },
      ],
    }),
    make({
      id: "tmpm-25006-breakfast-quesadilla",
      title: "Egg, Chicken and Cheese Quesadilla",
      titleRu: "Кесадилья с яйцом, курицей и сыром",
      macros: { kcal: 361, protein: 28.5, fat: 16.8, carbs: 31.5 },
      ingredients: [ingredient("egg", 50, "g", "1 яйцо (примерно 50 г без скорлупы)"), ...base.ingredients.slice(14, 17)],
      steps: [
        { action: "cook", equipment: ["frying_pan"], text: "На сковороде приготовьте яйцо до полного схватывания белка." },
        { action: "toast", equipment: ["frying_pan"], text: "Положите на половину тортильи яйцо, куриную нарезку и сыр, накройте второй половиной и подрумяньте с двух сторон, пока сыр не расплавится.", donenessCue: "сыр расплавился, тортилья подрумянилась" },
      ],
    }),
    make({
      id: "tmpm-25006-apple-yogurt-granola",
      title: "Apple Yogurt Granola Bowl",
      titleRu: "Йогурт с яблоком, гранолой и мёдом",
      macros: { kcal: 397, protein: 18, fat: 5, carbs: 73 },
      ingredients: base.ingredients.slice(17, 21),
      steps: [
        { action: "slice", text: "Нарежьте яблоко небольшими кусочками." },
        { action: "assemble", text: "Выложите в миску йогурт, яблоко и гранолу, полейте мёдом. Гранолу добавляйте прямо перед едой, чтобы она оставалась хрустящей." },
      ],
    }),
    make({
      id: "tmpm-25006-strawberry-lime-sorbet",
      title: "Strawberry Lime Sorbet",
      titleRu: "Клубнично-лаймовый сорбет",
      macros: { kcal: 214, protein: 2, fat: 1, carbs: 52 },
      ingredients: base.ingredients.slice(21, 25),
      steps: [
        { action: "blend", equipment: ["food_processor"], text: "Пробейте замороженную клубнику с кленовым сиропом, водой и соком лайма до гладкой густой массы." },
        { action: "freeze", equipment: ["freezer"], text: "Подавайте сразу как мягкий сорбет или заморозьте в закрытом контейнере до более плотной консистенции." },
      ],
      time: { prepMinutes: 5, cookMinutes: 0, totalMinutes: 5 },
    }),
  ];
  document.candidates.splice(index, 1, ...split);
}

function patchRound2Followups(byId) {
  const setAmount = (id, matcher, name, amountMetric, unitMetric = "g", original = `${amountMetric} ${unitMetric} ${name}`) => {
    const candidate = byId.get(id);
    const item = candidate?.ingredients.find((value) => matcher.test(String(value.name)));
    if (!item) return;
    Object.assign(item, { name, amountMetric: String(amountMetric), unitMetric, original });
  };
  for (const candidate of byId.values()) {
    for (const item of candidate.ingredients ?? []) {
      if (item.name === "mixed vegetables") item.name = "frozen stir fry blend vegetables";
      if (item.name === "chives") item.name = "small bunch chives finely snipped";
      if (item.name === "white sugar") item.name = "granulated sugar";
      if (item.name === "chicken bouillon") item.name = "chicken stock cube";
      if (item.name === "mixed soft herbs") item.name = "leftover soft herbs finely chopped, to garnish";
      if (item.name === "wheat flour") item.name = "plain flour";
      if (item.name === "seed mix") item.name = "mixed seeds";
      if (item.name === "stewing beef") item.name = "stewing beef cut into chunks";
      if (item.name === "lentils cooked") item.name = "lentils drained and rinsed";
    }
  }

  const chicken = byId.get("tmpm-25304");
  if (chicken && chicken.macros.fat == null) chicken.macros.fat = 4;
  if (chicken && chicken.macros.carbs == null) chicken.macros.carbs = 0;
  const fries = byId.get("tmpm-16861");
  if (fries && fries.macros.fat == null) fries.macros.fat = 0;

  setAmount("goodfood-satay-sweet-potato-curry", /^dry roasted peanuts/iu, "peanuts", 30, "g", "30 г жареного арахиса для подачи (по желанию)");
  setAmount("goodfood-big-batch-bolognese", /^parmesan to serve/iu, "parmesan", 120, "g", "120 г пармезана для подачи");
  setAmount("goodfood-vegan-shepherds-pie", /^tomato ketchup/iu, "ketchup", 40, "g", "40 г кетчупа для подачи (по желанию)");
  setAmount("goodfood-vegetarian-bolognese", /^vegetarian hard cheese/iu, "parmesan", 40, "g", "40 г твёрдого сыра для подачи (по желанию)");
  setAmount("goodfood-mini-lentil-shepherds-pies", /^peas to serve/iu, "peas", 300, "g", "300 г зелёного горошка для подачи (по желанию)");
  setAmount("goodfood-courgette-tomato-soup", /^crusty bread/iu, "bread", 400, "g", "400 г хлеба для подачи (по желанию)");
  setAmount("goodfood-creamy-chicken-sweetcorn-soup", /^(?:small bunch chives|chives)$/iu, "small bunch chives finely snipped", 20, "g", "20 г шнитт-лука");
  setAmount("goodfood-smoky-black-bean-chilli", /^soured cream/iu, "sour cream", 80, "g", "80 г сметаны для подачи");
  setAmount("goodfood-smoky-black-bean-chilli", /^grated cheddar/iu, "cheddar cheese", 80, "g", "80 г тёртого чеддера для подачи");
  setAmount("goodfood-lemon-orzo", /^large handful of finely chopped soft herbs/iu, "mixed soft herbs", 30, "g", "30 г мягкой зелени (шнитт-лук, укроп и базилик)");
  setAmount("goodfood-lentil-kofta-orzo-feta", /^(?:pinch of sugar|white sugar)$/iu, "granulated sugar", 1, "g", "1 г сахара (щепотка)");
  setAmount("goodfood-sausage-egg-muffins", /^ketchup/iu, "ketchup", 40, "g", "40 г кетчупа (по желанию)");

  const bourguignon = byId.get("goodfood-slow-cooker-beef-bourguignon");
  if (bourguignon) replaceNamedIngredient(bourguignon, /^mashed potatoes or crusty bread/iu, [ingredient("potato", 800, "g", "800 г картофеля для пюре к подаче")]);
  const pressureBolognese = byId.get("goodfood-big-batch-pressure-cooker-bolognese");
  if (pressureBolognese) replaceNamedIngredient(pressureBolognese, /^cooked spaghetti grated parmesan and basil/iu, [
    ingredient("pasta", 480, "g", "480 г сухих спагетти (сварить)"),
    ingredient("parmesan", 80, "g", "80 г тёртого пармезана"),
    ingredient("basil", 20, "g", "20 г листьев базилика"),
  ]);
  const peanutStew = byId.get("goodfood-chicken-sweet-potato-peanut-stew");
  if (peanutStew) replaceNamedIngredient(peanutStew, /^handful of chopped coriander and chopped peanuts/iu, [
    ingredient("coriander", 15, "g", "15 г рубленой кинзы для подачи"),
    ingredient("peanuts", 30, "g", "30 г рубленого арахиса для подачи"),
  ]);
  const indianSalad = byId.get("goodfood-indian-rice-salad-chicken");
  if (indianSalad) {
    replaceNamedIngredient(indianSalad, /^natural yogurt and mini poppadum crisps/iu, [
      ingredient("natural yogurt", 80, "g", "80 г натурального йогурта для подачи (по желанию)"),
      ingredient("poppadum crisps", 40, "g", "40 г мини-пападамов для подачи (по желанию)"),
    ]);
    setAmount(indianSalad.id, /^juice 1/iu, "lemon juice", 50, "ml", "50 мл лимонного сока (примерно 1½–2 лимона)");
  }

  const gochujang = byId.get("tmpm-26138");
  if (gochujang && gochujang.proceduralStatus !== "ready") {
    gochujang.paraphrasedInstructionDraft[1] = {
      ...gochujang.paraphrasedInstructionDraft[1],
      text: "В большой сковороде на половине масла обжаривайте фарш 6–8 минут до равномерного подрумянивания и исчезновения розовых участков. Добавьте оставшееся масло, лук и перец и готовьте 4–5 минут; внесите капусту и морковь ещё на 4–5 минут до мягкости. Влейте соус и прогревайте 2–3 минуты до пузырьков и яркого аромата чеснока. При желании посыпьте зелёным луком, подайте с рисом.",
      duration: "6–8 мин + 4–5 мин + 2–3 мин",
      donenessCue: "фарш без розовых участков, овощи мягкие, соус кипит",
    };
    gochujang.proceduralStatus = "ready";
    gochujang.proceduralBlockers = [];
  }

  const teriyaki = byId.get("tmpm-25463");
  if (teriyaki && teriyaki.proceduralStatus !== "ready") {
    replaceNamedIngredient(teriyaki, /^high protein beef meatballs/iu, [
      ingredient("ground beef (93/7)", 270, "g", "270 г говяжьего фарша 93/7"),
      ingredient("oat flour", 10, "g", "10 г овсяной муки"),
      ingredient("egg", 12, "g", "12 г взбитого яйца"),
    ]);
    setAmount(teriyaki.id, /^(?:frozen stir fry blend vegetables|mixed vegetables)$/iu, "frozen stir fry blend vegetables", 300, "g", "300 г замороженной овощной смеси для стир-фрая");
    setAmount(teriyaki.id, /^teriyaki sauce/iu, "teriyaki sauce", 60, "ml", "60 мл готового соуса терияки");
    teriyaki.paraphrasedInstructionDraft = [
      recipeStep("editorial-step-1", "Разогрейте духовку до 200 °C. Смешайте фарш, овсяную муку, яйцо, чесночный и луковый порошок, соль и перец; сформуйте 10 одинаковых фрикаделек и запекайте 17–20 минут до полной готовности.", teriyaki.ingredients.length, "bake", { temperatureC: 200, duration: "17–20 мин", equipment: ["oven", "baking_sheet"], donenessCue: "фрикадельки полностью готовы внутри" }),
      recipeStep("editorial-step-2", "Промойте сухой рис и сварите по инструкции на упаковке. Прогрейте овощную смесь до мягкости.", teriyaki.ingredients.length, "cook", { equipment: ["pot", "frying_pan"] }),
      recipeStep("editorial-step-3", "Разложите рис и овощи по двум контейнерам, добавьте по пять фрикаделек и соус терияки. Остудите и закройте.", teriyaki.ingredients.length, "assemble"),
    ];
    teriyaki.proceduralStatus = "ready";
    teriyaki.proceduralBlockers = [];
  }

  for (const id of ["goodfood-coconut-rice-with-prawn-stir-fry", "goodfood-meatball-chickpea-yellow-coconut-curry-with-rice-pickled-red-cabbage"]) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    for (const item of candidate.ingredients) {
      if (item.name === "red chilli") item.name = "red chilli deseeded and finely chopped";
      if (item.name === "shallots") item.name = "shallots roughly chopped";
      if (item.name === "light brown sugar") item.name = "light brown soft sugar";
      if (item.name === "coconut milk") item.name = "canned coconut milk";
    }
  }

  const vinaigrette = (scale) => [
    ingredient("lemon juice", round(60 * scale), "ml"),
    ingredient("apple cider vinegar", round(30 * scale), "ml"),
    ingredient("olive oil", round(200 * scale), "ml"),
    ingredient("dijon mustard", round(10 * scale), "g"),
    ingredient("honey", round(28 * scale), "g"),
    ingredient("parmesan", round(40 * scale), "g"),
  ];
  const lemonOrzo = (dryOrzo) => [
    ingredient("butter", round(dryOrzo * 0.1), "g"),
    ingredient("orzo pasta", dryOrzo, "g"),
    ingredient("chicken stock cube", round(dryOrzo / 250), "piece", `${round(dryOrzo / 250)} бульонного кубика`),
    ingredient("large handful of finely chopped soft herbs such as chives, dill and basil", round(dryOrzo * 0.06), "g"),
    ingredient("lemon juice", round(dryOrzo * 0.04), "ml"),
  ];
  const addPreparationSteps = (candidate, texts) => {
    if (candidate.reviewRound2Followups === 1) return;
    const prepSteps = texts.map((text, index) => recipeStep(`editorial-step-${index + 1}`, text, candidate.ingredients.length, index ? "cook" : "mix", { equipment: index ? ["pot"] : ["mixing_bowl"] }));
    candidate.paraphrasedInstructionDraft = [...prepSteps, ...candidate.paraphrasedInstructionDraft];
    candidate.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
    reindexSteps(candidate);
    candidate.proceduralStatus = "ready";
    candidate.proceduralBlockers = [];
    candidate.reviewRound2Followups = 1;
  };

  const marinated = byId.get("goodfood-marinated-chicken-with-orzo-tomato-feta");
  if (marinated && marinated.reviewRound2Followups !== 1) {
    replaceNamedIngredient(marinated, /^lemon & parmesan vinaigrette/iu, vinaigrette(200 / 330));
    replaceNamedIngredient(marinated, /^lemon orzo/iu, lemonOrzo(250));
    setAmount(marinated.id, /^(?:leftover soft herbs|mixed soft herbs)/iu, "leftover soft herbs finely chopped, to garnish", 15, "g", "15 г мягкой зелени для подачи");
    addPreparationSteps(marinated, [
      "Для заправки пробейте лимонный сок, яблочный уксус, оливковое масло, дижонскую горчицу, мёд и пармезан до гладкой эмульсии.",
      "Для лимонного орзо растопите масло, обжаривайте сухое орзо 4–5 минут, добавьте бульонный кубик и кипяток и варите около 10 минут до мягкости. Остудите и вмешайте зелень и лимонный сок.",
    ]);
  }

  const trout = byId.get("goodfood-lemon-orzo-with-trout-spiced-broccoli-peperonata");
  if (trout && trout.reviewRound2Followups !== 1) {
    replaceNamedIngredient(trout, /^spiced broccoli/iu, [ingredient("broccoli", 250, "g"), ingredient("olive oil", 8, "ml")]);
    replaceNamedIngredient(trout, /^lemon & parmesan vinaigrette/iu, vinaigrette(75 / 330));
    replaceNamedIngredient(trout, /^peperonata/iu, [
      ingredient("olive oil", 11, "ml"), ingredient("shallots roughly chopped", 40, "g"), ingredient("tomato paste", 11, "g"),
      ingredient("garlic", 5, "g"), ingredient("pepper", 115, "g"), ingredient("tomato", 60, "g"), ingredient("red wine vinegar", 2, "ml"),
    ]);
    replaceNamedIngredient(trout, /^herby lemon orzo/iu, lemonOrzo(330));
    setAmount(trout.id, /^(?:leftover soft herbs|mixed soft herbs)/iu, "leftover soft herbs finely chopped, to garnish", 15, "g", "15 г мягкой зелени для подачи");
    addPreparationSteps(trout, [
      "Подготовьте пряную брокколи: смешайте соцветия с оливковым маслом, копчёной паприкой, щепоткой кайенского перца и лимонной цедрой.",
      "Для заправки пробейте лимонный сок, яблочный уксус, оливковое масло, дижонскую горчицу, мёд и пармезан. Для пеперонаты обжарьте шалот 7 минут, добавьте томатную пасту и чеснок на 2 минуты, затем перец, томаты и уксус и томите под крышкой 30 минут.",
      "Для лимонного орзо растопите масло, обжаривайте сухое орзо 4–5 минут, добавьте бульонный кубик и кипяток и варите около 10 минут до мягкости. Вмешайте зелень и лимонный сок.",
    ]);
  }

  const lentilSoup = byId.get("goodfood-spiced-lentil-butternut-squash-soup");
  if (lentilSoup) replaceNamedIngredient(lentilSoup, /^dukkah .* natural yogurt/iu, [
    ingredient("seed mix", 40, "g", "40 г смеси семян или готовой дукки для подачи"),
    ingredient("natural yogurt to serve (optional)", 120, "g", "120 г натурального йогурта для подачи"),
  ]);

  const raguIngredients = (scale) => [
    ingredient("dried porcini mushrooms", round(15 * scale), "g"),
    ingredient("canola oil", round(60 * scale), "ml"),
    ingredient("stewing beef", round(800 * scale), "g"),
    ingredient("mushrooms", round(300 * scale), "g"),
    ingredient("onion", round(150 * scale), "g"),
    ingredient("carrot", round(300 * scale), "g"),
    ingredient("celery", round(80 * scale), "g"),
    ingredient("garlic", round(35 * scale), "g"),
    ingredient("tomato paste", round(100 * scale), "g"),
    ingredient("lentils cooked", round(240 * scale), "g"),
    ingredient("beef broth", round(500 * scale), "ml"),
    ingredient("butter", round(25 * scale), "g"),
  ];
  const inlineRagu = (candidate, scale) => {
    if (!candidate || candidate.reviewRound2Ragu === 1) return;
    if (!replaceNamedIngredient(candidate, /^leftover ragu/iu, raguIngredients(scale))) return;
    candidate.paraphrasedInstructionDraft.unshift(recipeStep(
      "editorial-step-1",
      "Для рагу замочите сухие грибы на 20–30 минут. Обжарьте говядину 10–12 минут до тёмной корочки и отложите; грибы готовьте 8–10 минут. Отдельно размягчите лук, морковь и сельдерей за 10–12 минут, добавьте чеснок и томатную пасту на 3–4 минуты, затем чечевицу, бульон и масло. Верните мясо и грибы, накройте и томите около 3 часов на слабом огне.",
      candidate.ingredients.length,
      "simmer",
      { duration: "около 3 ч", equipment: ["pot"], donenessCue: "говядина очень мягкая, рагу густое" },
    ));
    candidate.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
    reindexSteps(candidate);
    candidate.proceduralStatus = "ready";
    candidate.proceduralBlockers = [];
    candidate.reviewRound2Ragu = 1;
  };
  inlineRagu(byId.get("goodfood-beef-mushroom-marsala-stroganoff-with-herby-mash"), 0.5);
  inlineRagu(byId.get("goodfood-black-bean-spicy-beef-pasta"), 0.25);
  const harissa = byId.get("goodfood-harissa-beef-tomato-bulgur");
  inlineRagu(harissa, 0.5);
  if (harissa) replaceNamedIngredient(harissa, /^lemon wedges and natural yogurt/iu, [
    ingredient("lemon juice", 30, "ml", "30 мл лимонного сока для подачи"),
    ingredient("natural yogurt to serve (optional)", 100, "g", "100 г натурального йогурта для подачи"),
  ]);

  const flatbread = byId.get("goodfood-roasted-lemony-broccoli-mascarpone-flatbreads");
  if (flatbread && flatbread.reviewRound2Flatbread !== 1) {
    replaceNamedIngredient(flatbread, /^batch of flatbread dough/iu, [
      ingredient("active dry yeast", 6, "g"), ingredient("granulated sugar", 12, "g"), ingredient("water", 300, "ml"),
      ingredient("wheat flour", 500, "g"), ingredient("salt", 10, "g"), ingredient("olive oil", 30, "ml"),
    ]);
    replaceNamedIngredient(flatbread, /^peperonata/iu, [
      ingredient("olive oil", 11, "ml"), ingredient("shallots roughly chopped", 40, "g"), ingredient("tomato paste", 11, "g"),
      ingredient("garlic", 5, "g"), ingredient("pepper", 115, "g"), ingredient("tomato", 60, "g"), ingredient("red wine vinegar", 2, "ml"),
    ]);
    replaceNamedIngredient(flatbread, /^spiced broccoli/iu, [ingredient("broccoli", 400, "g"), ingredient("olive oil", 15, "ml")]);
    replaceNamedIngredient(flatbread, /^lemon & parmesan vinaigrette/iu, vinaigrette(50 / 330));
    flatbread.paraphrasedInstructionDraft.unshift(
      recipeStep("editorial-step-1", "Для теста смешайте дрожжи, сахар и тёплую воду и оставьте на 5 минут. Добавьте муку, соль и масло, вымешивайте 10 минут и оставьте под крышкой примерно на 2 часа до увеличения объёма.", flatbread.ingredients.length, "knead", { duration: "10 мин + около 2 ч", equipment: ["mixing_bowl"] }),
      recipeStep("editorial-step-2", "Для пеперонаты обжарьте шалот 7 минут, добавьте томатную пасту и чеснок на 2 минуты, затем перец, томаты и уксус и томите под крышкой 30 минут.", flatbread.ingredients.length, "simmer", { duration: "30 мин", equipment: ["frying_pan"] }),
      recipeStep("editorial-step-3", "Брокколи смешайте с маслом, копчёной паприкой, щепоткой кайенского перца и лимонной цедрой. Для заправки пробейте лимонный сок, яблочный уксус, масло, горчицу, мёд и пармезан.", flatbread.ingredients.length, "mix", { equipment: ["mixing_bowl"] }),
    );
    flatbread.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
    reindexSteps(flatbread);
    flatbread.proceduralStatus = "ready";
    flatbread.proceduralBlockers = [];
    flatbread.reviewRound2Flatbread = 1;
  }

  const lamb = byId.get("goodfood-crispy-lamb-pea-tabbouleh");
  if (lamb && lamb.proceduralStatus !== "ready") {
    lamb.paraphrasedInstructionDraft.unshift(recipeStep("editorial-step-1", "Приправьте 150 г баранины кумином, паприкой, солью и перцем, разложите тонким слоем и запекайте при 200 °C 12–15 минут до полной готовности. Остудите и крупно нарежьте.", lamb.ingredients.length, "bake", { temperatureC: 200, duration: "12–15 мин", equipment: ["oven", "baking_sheet"], donenessCue: "баранина полностью готова внутри" }));
    lamb.paraphrasedInstructionDraft.forEach((step, index) => { step.id = `editorial-step-${index + 1}`; step.dependsOn = index ? [`editorial-step-${index}`] : []; });
    reindexSteps(lamb);
    lamb.proceduralStatus = "ready";
    lamb.proceduralBlockers = [];
  }

  const salad = byId.get("goodfood-indian-rice-salad-chicken");
  if (salad) {
    for (const item of salad.ingredients) {
      if (item.name === "natural yogurt") item.name = "natural yogurt to serve (optional)";
    }
  }
}

function syncEditorialCards(editorialDocuments, candidatesById) {
  const allCards = editorialDocuments.flatMap((document) => document);
  const aggregateIndex = allCards.findIndex((card) => card.id === "tmpm-25006");
  if (aggregateIndex >= 0) {
    const replacementIds = [
      "tmpm-25006-hash-brown-breakfast-bowl",
      "tmpm-25006-avocado-bean-rice-cakes",
      "tmpm-25006-breakfast-quesadilla",
      "tmpm-25006-apple-yogurt-granola",
      "tmpm-25006-strawberry-lime-sorbet",
    ];
    const replacementCards = replacementIds.map((id) => {
      const candidate = candidatesById.get(id);
      return { id, titleRu: candidate.titleRu, paraphrasedInstructionDraft: candidate.paraphrasedInstructionDraft, proceduralStatus: candidate.proceduralStatus, proceduralBlockers: candidate.proceduralBlockers };
    });
    let cursor = aggregateIndex;
    for (const document of editorialDocuments) {
      if (cursor < document.length) {
        document.splice(cursor, 1, ...replacementCards);
        break;
      }
      cursor -= document.length;
    }
  }
  for (const document of editorialDocuments) {
    for (const card of document) {
      const candidate = candidatesById.get(card.id);
      if (!candidate) continue;
      card.titleRu = candidate.titleRu;
      card.paraphrasedInstructionDraft = candidate.paraphrasedInstructionDraft;
      card.proceduralStatus = candidate.proceduralStatus;
      card.proceduralBlockers = candidate.proceduralBlockers;
    }
  }
}

export async function applyRecipeReviewRound2({ cwd = process.cwd(), write = false } = {}) {
  const datasetEntries = await Promise.all(DATASET_PATHS.map(async (relativePath) => ({
    relativePath,
    path: resolve(cwd, relativePath),
    document: JSON.parse(await readFile(resolve(cwd, relativePath), "utf8")),
  })));
  const editorialEntries = await Promise.all(EDITORIAL_PATHS.map(async (relativePath) => ({
    relativePath,
    path: resolve(cwd, relativePath),
    document: JSON.parse(await readFile(resolve(cwd, relativePath), "utf8")),
  })));
  const alreadyApplied = datasetEntries.every((entry) => entry.document.recipeReviewRound2?.version === 1);
  if (!alreadyApplied) splitSnackAggregate(datasetEntries[0].document);
  const candidates = datasetEntries.flatMap((entry) => entry.document.candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  if (!alreadyApplied) {
    patchExplicitMealPrepDecisions(byId);
    patchCommonRiceWeights(candidates);
    patchGoodFoodComponents(byId);
    for (const entry of datasetEntries) {
      entry.document.recipeReviewRound2 = {
        version: 1,
        appliedAt: "2026-08-29",
        sourcePages: 217,
        recipeCards: candidates.length,
      };
    }
  }
  patchRound2Followups(byId);
  syncEditorialCards(editorialEntries.map((entry) => entry.document), byId);
  if (write) {
    await Promise.all([
      ...datasetEntries.map((entry) => atomicWrite(entry.path, entry.document)),
      ...editorialEntries.map((entry) => atomicWrite(entry.path, entry.document)),
    ]);
  }
  return { sourcePages: 217, recipeCards: candidates.length, written: write };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await applyRecipeReviewRound2({ write: process.argv.includes("--write") }))}\n`);
}
