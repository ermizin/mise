import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { instructionFacts, schemaInstructionTexts } from "./recipe-instruction-facts.mjs";

const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value, all[index + 1]] : ["", ""]));
const limit = Math.min(118, Math.max(1, Number(args.get("--limit") ?? 100)));
const output = resolve(args.get("--output") ?? "data/goodfood-candidates.json");
const previousStatuses = new Map();
try {
  const previous = JSON.parse(await readFile(output, "utf8"));
  for (const item of previous.candidates ?? []) previousStatuses.set(item.id, item.editorialStatus);
} catch {
  // Первый импорт начинается без редакционных статусов.
}

const headers = { "User-Agent": "Mise recipe research/1.0" };
const decode = (value = "") => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");
const clean = (value = "") => decode(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
const numeric = (value) => {
  const match = String(value ?? "").replace(",", ".").match(/[\d.]+/);
  return match ? Number(match[0]) : undefined;
};
const minutes = (value) => {
  const match = String(value ?? "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : undefined;
};
const firstImage = (image) => {
  const item = Array.isArray(image) ? image[0] : image;
  return typeof item === "string" ? item : item?.url;
};
const ingredientName = (value) => clean(value)
  .replace(/^[\d\s./¼½¾⅓⅔⅛⅜⅝⅞–-]+/, "")
  .replace(/^(?:g|kg|ml|litres?|l|tsp|tbsp|teaspoons?|tablespoons?)\b\s*/i, "")
  .replace(/^\([^)]*\)\s*/, "")
  .trim();

function localizationFor(title, ingredients) {
  const haystack = `${title} ${ingredients.map((item) => item.original).join(" ")}`.toLowerCase();
  const niche = ["pasta salad", "noodle salad", "biscuits and gravy", "canned soup", "tater tot"].some((term) => haystack.includes(term));
  const specialty = ["gochujang", "mirin", "chipotle", "cilantro", "poblano", "sriracha", "halloumi", "harissa", "chorizo", "couscous"].some((term) => haystack.includes(term));
  return {
    fit: niche ? "niche" : specialty ? "adapted" : "familiar",
    availability: specialty ? "specialty" : "common",
    excludeSuggested: niche,
    reviewNote: niche ? "Не включать автоматически: формат блюда непривычен для первого российского пула." : specialty ? "Нужна проверка доступности и понятная замена редкого продукта или соуса." : "Проверить перевод, хранение и КБЖУ.",
  };
}

function slotFor(category, title, id) {
  const categoryValue = `${Array.isArray(category) ? category.join(" ") : category ?? ""}`.toLowerCase();
  const titleValue = title.toLowerCase();
  const isMainCourse = /\bmain course\b/.test(categoryValue);
  const titleSignalsBreakfast = /\bpancakes?\b|\boats\b|\begg\s+(?:bites?|muffins?|scramble|bake|casserole|toast|wraps?|rolls?)\b|\bfrench toast\b|\bporridge\b/.test(titleValue);
  if (/\bbreakfast\b|\bbrunch\b/.test(categoryValue) || (!isMainCourse && titleSignalsBreakfast)) return "breakfast";
  if (/\bdessert\b|\bsnack\b|\bcookie\b|\bbrownie\b|\bmuffin\b|\bbar\b|\bsmoothie\b/.test(`${categoryValue} ${titleValue}`)) return "snack1";
  return id.length % 2 ? "dinner" : "lunch";
}

async function fetchText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Good Food returned ${response.status} for ${url}`);
  return response.text();
}

function jsonLdRecipe(html) {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const values = Array.isArray(JSON.parse(match[1])) ? JSON.parse(match[1]) : [JSON.parse(match[1])];
      const recipe = values.find((item) => item?.["@type"] === "Recipe" || item?.["@type"]?.includes?.("Recipe"));
      if (recipe) return recipe;
    } catch {
      // Некоторые рекламные блоки содержат невалидный JSON и не относятся к рецепту.
    }
  }
}

const links = [];
for (let page = 1; links.length < limit && page <= 5; page += 1) {
  const html = await fetchText(`https://www.bbcgoodfood.com/recipes/collection/meal-prep-recipes?page=${page}`);
  const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new Error(`Good Food collection page ${page} has no __NEXT_DATA__`);
  const items = JSON.parse(raw).props?.pageProps?.items ?? [];
  for (const item of items) if (item.postType === "recipe" && item.url && !links.includes(item.url)) links.push(item.url);
}

const candidates = [];
for (let offset = 0; offset < Math.min(limit, links.length); offset += 8) {
  const batch = links.slice(offset, Math.min(offset + 8, limit));
  const pages = await Promise.all(batch.map(async (url) => ({ url, html: await fetchText(url) })));
  for (const { url, html } of pages) {
    const recipe = jsonLdRecipe(html);
    if (!recipe) continue;
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const id = `goodfood-${slug}`;
    const ingredients = (recipe.recipeIngredient ?? []).map((original) => ({ name: ingredientName(original) || clean(original), original: clean(original) })).filter((item) => item.name);
    const nutrition = recipe.nutrition ?? {};
    const title = clean(recipe.name ?? recipe.headline);
    const sourceInstructions = schemaInstructionTexts(recipe.recipeInstructions);
    candidates.push({
      id,
      title,
      sourceTitle: title,
      sourceUrl: recipe.url ?? url,
      sourceQuery: "mealprep recipes",
      imageUrl: firstImage(recipe.image),
      imageUse: "source-preview-only",
      slot: slotFor(recipe.recipeCategory, title, id),
      course: Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory.join(", ") : clean(recipe.recipeCategory),
      time: {
        prepMinutes: minutes(recipe.prepTime),
        cookMinutes: minutes(recipe.cookTime),
        totalMinutes: minutes(recipe.totalTime) ?? ((minutes(recipe.prepTime) ?? 0) + (minutes(recipe.cookTime) ?? 0) || undefined),
      },
      servings: numeric(Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield),
      macros: {
        kcal: numeric(nutrition.calories),
        protein: numeric(nutrition.proteinContent),
        fat: numeric(nutrition.fatContent),
        carbs: numeric(nutrition.carbohydrateContent),
      },
      ingredients,
      ...instructionFacts(sourceInstructions),
      localization: localizationFor(title, ingredients),
      editorialStatus: previousStatuses.get(id) ?? "pending",
    });
  }
}

const completeCandidates = candidates.filter((item) => item.imageUrl && item.ingredients.length > 0 && Number.isFinite(item.time.totalMinutes) && Object.values(item.macros).every(Number.isFinite));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ importedAt: new Date().toISOString(), source: "Good Food — Meal prep ideas", candidates: completeCandidates }, null, 2)}\n`, "utf8");
console.log(`Imported ${completeCandidates.length} complete candidates to ${output}; skipped ${candidates.length - completeCandidates.length} incomplete cards`);
