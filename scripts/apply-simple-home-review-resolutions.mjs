import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const defaultReviewUrl = new URL("public/review-tool/simple-home-high-protein-review.html", projectRoot);
const resolutionsUrl = new URL("data/simple-home-review-resolutions-v2.json", projectRoot);

export const resolutions = JSON.parse(await readFile(resolutionsUrl, "utf8"));

export function extractRecipes(html) {
  const startMarker = "const recipes=";
  const endMarker = ";(function reviewClient()";
  const start = html.indexOf(startMarker);
  const payloadStart = start + startMarker.length;
  const payloadEnd = html.indexOf(endMarker, payloadStart);
  assert.ok(start >= 0 && payloadEnd > payloadStart, "review recipe payload is present");
  return JSON.parse(html.slice(payloadStart, payloadEnd));
}

function recipeById(recipes, recipeId) {
  const recipe = recipes.find((item) => item.id === recipeId);
  assert.ok(recipe, `recipe exists: ${recipeId}`);
  return recipe;
}

function ingredientByName(recipe, pattern) {
  const ingredient = recipe.ingredients.find((item) => pattern.test(item.name));
  assert.ok(ingredient, `${recipe.id} has ingredient ${pattern}`);
  return ingredient;
}

function ensureMeasuredIngredient(recipe, name, grams) {
  let ingredient = recipe.ingredients.find((item) => item.name === name);
  if (!ingredient) {
    ingredient = { name, grams, checkLabel: false };
    recipe.ingredients.push(ingredient);
  }
  ingredient.grams = grams;
  ingredient.checkLabel = false;
  return ingredient;
}

function measuredProteinStep(step, grams) {
  const measured = `${grams} г протеинового порошка`;
  if (/\d+(?:[.,]\d+)?\s*г\s+протеинов(?:ого порошка|ый порошок)/iu.test(step)) {
    return step.replace(/\d+(?:[.,]\d+)?\s*г\s+протеинов(?:ого порошка|ый порошок)/iu, measured);
  }
  return step.replace(/протеин(?!ов)/iu, measured);
}

function applyOvernightOatsRule(recipes) {
  const flavourSteps = {
    "new-oats-banana-blueberry": "Добавьте овсяные хлопья, банан, чернику и грецкие орехи, перемешайте.",
    "new-oats-chocolate": "Добавьте овсяные хлопья, какао и рубленый тёмный шоколад, перемешайте.",
    "new-oats-apple": "Добавьте овсяные хлопья, мелко нарезанное яблоко, корицу и грецкие орехи, перемешайте.",
    "new-oats-carrot": "Добавьте овсяные хлопья, мелко натёртую морковь, корицу и грецкие орехи, перемешайте.",
    "new-oats-blueberry-almond": "Добавьте овсяные хлопья, чернику, миндаль и яблочное пюре, перемешайте.",
    "new-oats-cinnamon-raisin": "Добавьте овсяные хлопья, изюм, размятый банан, корицу и грецкие орехи, перемешайте.",
    "foodru-oats-chocolate-shell": "Добавьте овсянку, банан и грецкие орехи; растопите тёмный шоколад и распределите его сверху тонким слоем.",
    "foodru-oats-no-cook": "Добавьте овсянку, размятый банан и какао, перемешайте."
  };
  const adaptationTexts = {
    "goodfood-banana-overnight-oats": "Добавлено 20 г протеина на порцию.",
    "new-oats-banana-blueberry": "Добавлено 25 г протеина на порцию.",
    "new-oats-chocolate": "Шоколад оставлен обычной рубленой плиткой; добавлено 25 г протеина на порцию.",
    "new-oats-apple": "Белковая основа из йогурта и 25 г протеина; кленовый сироп не нужен.",
    "new-oats-carrot": "Жирное кокосовое молоко заменено обычным; добавлено 25 г протеина на порцию.",
    "new-oats-blueberry-almond": "Сохранён низкосахарный профиль; добавлено 25 г протеина на порцию.",
    "new-oats-cinnamon-raisin": "Добавлено 25 г протеина; изюм оставлен малой вкусовой добавкой.",
    "foodru-oats-chocolate-shell": "Шоколад сокращён с 45 до 20 г; добавлено 25 г протеина на порцию.",
    "foodru-oats-no-cook": "Добавлены йогурт и 25 г протеина; банан нормирован до 100 г."
  };
  for (const { recipeId, proteinGrams } of resolutions.overnightOats) {
    const recipe = recipeById(recipes, recipeId);
    const protein = ingredientByName(recipe, /^Протеиновый порошок$/iu);
    protein.grams = proteinGrams;

    if (recipeId === "goodfood-banana-overnight-oats") {
      recipe.steps = [
        "Разомните банан вилкой.",
        `Смешайте банан с овсянкой, корицей, кленовым сиропом, молоком и ${proteinGrams} г протеинового порошка до однородности.`,
        "Накройте и оставьте в холодильнике на 6–8 часов.",
        "Утром перемешайте, добавьте миндаль и щепотку корицы.",
      ];
    } else {
      const stepIndex = recipe.steps.findIndex((step) => /протеин/iu.test(step));
      assert.ok(stepIndex >= 0, `${recipeId} mentions protein in its method`);
      recipe.steps[stepIndex] = measuredProteinStep(recipe.steps[stepIndex], proteinGrams);
      if (flavourSteps[recipeId]) recipe.steps[1] = flavourSteps[recipeId];
    }
    recipe.adaptation = adaptationTexts[recipeId];
  }
}

function applyZeroSauceRule(recipes) {
  for (const recipeId of resolutions.zeroSauceSandwichRecipeIds) {
    const recipe = recipeById(recipes, recipeId);
    const sauce = ingredientByName(recipe, /(?:Готовая салатная заправка|Zero-соус)/iu);
    sauce.name = "Низкокалорийный zero-соус";
    sauce.grams = 15;
    sauce.checkLabel = true;
    if (!recipe.steps.some((step) => /15\s*г\s+zero-соуса/iu.test(step))) {
      recipe.steps.push("Добавьте 15 г zero-соуса и соберите сэндвич непосредственно перед едой.");
    }
    recipe.adaptation = "Белковая начинка 130–160 г; 15 г низкокалорийного zero-соуса с обязательной сверкой этикетки.";
  }

  const ingredientNames = {
    "new-sandwich-boiled-chicken": ["Куриная грудка", "Куриная грудка, варёная", false],
    "new-sandwich-smoked-chicken": ["Куриное бедро без кожи", "Копчёная курица без кожи", true],
    "new-sandwich-turkey-ham": ["Ветчина", "Ветчина из индейки", true],
    "new-sandwich-balyk": ["Ветчина", "Балык", true]
  };
  for (const [recipeId, [currentName, nextName, checkLabel]] of Object.entries(ingredientNames)) {
    const recipe = recipeById(recipes, recipeId);
    const ingredient = ingredientByName(recipe, new RegExp(`^(?:${currentName}|${nextName})$`, "iu"));
    ingredient.name = nextName;
    ingredient.checkLabel = checkLabel;
  }
}

function applyIndividualResolutions(recipes) {
  const casserole = recipeById(recipes, "goodfood-family-meals-chicken-veg-casserole");
  casserole.steps = casserole.steps.filter((step) => !/Если используете нут/iu.test(step));
  if (!casserole.steps.some((step) => /дайте постоять 5 минут/iu.test(step))) {
    casserole.steps.push("Снимите с огня, дайте постоять 5 минут и разделите на порции.");
  }
  casserole.adaptation = "Нут и рис убраны из условных шагов: карточка содержит только измеримые ингредиенты блюда.";

  const fishCakes = recipeById(recipes, "goodfood-family-meals-easy-fish-cakes");
  const cheese = ingredientByName(fishCakes, /(?:Полутвёрдый сыр \(обычный\)|Чеддер \(обычный\))/iu);
  cheese.name = "Чеддер (обычный)";
  cheese.checkLabel = true;
  fishCakes.steps = fishCakes.steps.map((step) => step.replace(/ с небольшим количеством сливочного масла/giu, ""));
  fishCakes.steps = fishCakes.steps.map((step) => step.replace(/полутвёрдым сыром/giu, "чеддером"));
  fishCakes.adaptation = "Чеддер сохранён из исходного рецепта; для конкретного продукта сверить этикетку.";

  const buckwheat = recipeById(recipes, "new-home-buckwheat-legs");
  buckwheat.steps = buckwheat.steps.map((step) => step.replace(/ножки/giu, "бёдра"));

  const beefRecipeIds = [
    "foodru-oblomov-beef-veg",
    "foodru-oblomov-chashushuli",
    "foodru-oblomov-borscht"
  ];
  for (const recipeId of beefRecipeIds) {
    const recipe = recipeById(recipes, recipeId);
    recipe.steps = recipe.steps.map((step) => step.replace(/курица должна достичь 74°C в центре/giu, "говядина должна стать мягкой"));
  }
  const gingerPork = recipeById(recipes, "foodru-oblomov-ginger-pork");
  gingerPork.steps = gingerPork.steps.map((step) => step.replace(/курица должна достичь 74°C в центре/giu, "свинина должна полностью приготовиться"));
}

function applyPepperGravyRule(recipes) {
  const beef = recipeById(recipes, "foodru-oblomov-pepper-beef");
  ensureMeasuredIngredient(beef, "Вода", 250);
  ensureMeasuredIngredient(beef, "Чёрный перец горошком", 1.3);
  beef.macros = { kcal: 409, protein: 43.4, fat: 18.2, carbs: 19.4 };
  beef.steps = [
    "Нарежьте говядину, лук и чеснок; отмерьте муку, масло, перец и 250 мл воды на порцию.",
    "Обжарьте говядину партиями до румяной корочки, добавьте лук и чеснок. Влейте воду, добавьте перец и тушите под крышкой 45–50 минут до мягкости мяса.",
    "Разотрите масло с мукой, постепенно вмешайте горячую жидкость из кастрюли, верните подливу к мясу и готовьте ещё 5–7 минут до загустения.",
    "Разделите говядину и подливу на равные порции."
  ];
  beef.adaptation = "КБЖУ пересчитаны на одну порцию с 200 г сырой говядины; показатели источника относятся к 100 г сырой смеси. Вода не добавляет калорий.";

  const chicken = recipeById(recipes, "foodru-oblomov-pepper-chicken");
  ensureMeasuredIngredient(chicken, "Вода", 250);
  ensureMeasuredIngredient(chicken, "Чёрный перец горошком", 1.3);
  chicken.macros = { kcal: 375, protein: 47.6, fat: 10.9, carbs: 19.4 };
  chicken.steps = [
    "Нарежьте курицу, лук и чеснок; отмерьте муку, масло, перец и 250 мл воды на порцию.",
    "Обжарьте курицу партиями до румяной корочки, добавьте лук и чеснок. Влейте воду, добавьте перец и готовьте под крышкой до 74°C в центре курицы.",
    "Разотрите масло с мукой, постепенно вмешайте горячую жидкость из сковороды, верните подливу к курице и готовьте ещё 5–7 минут до загустения.",
    "Разделите курицу и подливу на равные порции."
  ];
  chicken.adaptation = "Куриная версия пересчитана отдельно; жидкость и перец сохранены в измеримом составе, вода не добавляет калорий.";
}

export function applyResolutions(inputRecipes) {
  const recipes = structuredClone(inputRecipes);
  const ids = new Set(recipes.map((recipe) => recipe.id));
  assert.equal(ids.size, recipes.length, "recipe ids are unique");
  for (const recipeId of resolutions.rejectedRecipeIds) {
    assert.ok(ids.has(recipeId) || recipes.length === resolutions.expectedOutputRecipes, `rejected recipe exists: ${recipeId}`);
  }

  let output = recipes.filter((recipe) => !resolutions.rejectedRecipeIds.includes(recipe.id));
  for (const [recipeId, title] of Object.entries(resolutions.titleOverrides)) {
    recipeById(output, recipeId).title = title;
  }
  applyOvernightOatsRule(output);
  applyZeroSauceRule(output);
  applyIndividualResolutions(output);
  applyPepperGravyRule(output);

  assert.equal(output.length, resolutions.expectedOutputRecipes, "resolved review recipe count");
  return output;
}

export function renderResolvedReview(html) {
  const recipes = applyResolutions(extractRecipes(html));
  const startMarker = "const recipes=";
  const endMarker = ";(function reviewClient()";
  const start = html.indexOf(startMarker) + startMarker.length;
  const end = html.indexOf(endMarker, start);
  const newCount = recipes.filter((recipe) => recipe.kind === "new").length;
  const existingCount = recipes.filter((recipe) => recipe.kind === "existing").length;
  let output = `${html.slice(0, start)}${JSON.stringify(recipes)}${html.slice(end)}`;
  output = output.replace(
    /<p>\d+ карточки: \d+ новых \+ \d+ из базы\. Минимум 25,7 г белка на порцию\. Веса ниже — на одну базовую порцию\.<\/p>/u,
    `<p>${recipes.length} карточек: ${newCount} новых + ${existingCount} из базы. Групповые правки уже применены; веса ниже — на одну базовую порцию.</p>`,
  );
  output = output.replace(/mise-simple-home-high-protein-review-v\d+/gu, "mise-simple-home-high-protein-review-v2");
  output = output.replace('source: { report: "simple-home-high-protein-review" }', 'source: { report: "simple-home-high-protein-review-v2" }');
  return output;
}

async function main() {
  const inputPath = process.argv[2] || fileURLToPath(defaultReviewUrl);
  const outputPath = process.argv[3] || inputPath;
  const html = await readFile(inputPath, "utf8");
  await writeFile(outputPath, renderResolvedReview(html));
  console.log(`Updated ${outputPath}: ${resolutions.expectedOutputRecipes} recipes`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
