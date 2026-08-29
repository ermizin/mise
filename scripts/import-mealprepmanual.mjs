import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { instructionFacts, wprmInstructionTexts } from "./recipe-instruction-facts.mjs";

const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value, all[index + 1]] : ["", ""]));
const limit = Math.min(500, Math.max(1, Number(args.get("--limit") ?? 250)));
const output = resolve(args.get("--output") ?? "data/mealprepmanual-candidates.json");
const previousStatuses = new Map();
try {
  const previous = JSON.parse(await readFile(output, "utf8"));
  for (const item of previous.candidates ?? []) previousStatuses.set(item.id, item.editorialStatus);
} catch {
  // Первый импорт начинается без редакционных статусов.
}
const endpoint = new URL("https://mealprepmanual.com/wp-json/wp/v2/posts");
const perPage = Math.min(100, limit);
endpoint.searchParams.set("per_page", String(perPage));
endpoint.searchParams.set("_fields", "id,link,title,content");

const decode = (value = "") => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");
const text = (value = "") => decode(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
const first = (html, pattern) => text(html.match(pattern)?.[1] ?? "");
const numeric = (html, className) => {
  const value = html.match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\d.]+)`, "i"))?.[1];
  return value ? Number(value) : undefined;
};
const duration = (html, prefix) => {
  const hours = numeric(html, `wprm-recipe-${prefix}_time-hours`) ?? 0;
  const minutes = numeric(html, `wprm-recipe-${prefix}_time-minutes`) ?? 0;
  return hours || minutes ? hours * 60 + minutes : undefined;
};
const nutrition = (html, key) => {
  const block = html.match(new RegExp(`wprm-nutrition-label-text-nutrition-container-${key}[\\s\\S]{0,700}?wprm-nutrition-label-text-nutrition-value[^>]*>([\\d.]+)`, "i"));
  return block ? Number(block[1]) : undefined;
};
const ingredientFacts = (html) => [...html.matchAll(/<li class="wprm-recipe-ingredient"[\s\S]*?<\/li>/gi)].map((match) => {
  const row = match[0];
  const metric = row.match(/wprm-recipe-ingredient-unit-system-2[^>]*>[\s\S]*?ingredient-amount[^>]*>([^<]+)<[\s\S]*?ingredient-unit[^>]*>([^<]+)</i);
  return {
    name: first(row, /wprm-recipe-ingredient-name[^>]*>([\s\S]*?)<\/span>/i),
    amountMetric: metric ? text(metric[1]) : undefined,
    unitMetric: metric ? text(metric[2]) : undefined,
    original: text(row),
  };
}).filter((item) => item.name);

function localizationFor(title, ingredients) {
  const haystack = `${title} ${ingredients.map((item) => item.name).join(" ")}`.toLowerCase();
  const niche = ["pasta salad", "savory baked oatmeal", "chicken dip", "buffalo chicken biscuits", "tater tot", "biscuits and gravy", "ranch seasoning", "canned soup"].some((term) => haystack.includes(term));
  const specialty = ["gochujang", "mirin", "chipotle", "cilantro", "poblano", "queso", "enchilada", "sriracha", "sloppy joe", "monterey jack", "liquid egg whites"].some((term) => haystack.includes(term));
  return {
    fit: niche ? "niche" : specialty ? "adapted" : "familiar",
    availability: specialty ? "specialty" : "common",
    excludeSuggested: niche,
    reviewNote: niche ? "Не включать автоматически: формат блюда непривычен для первого российского пула." : specialty ? "Нужна замена редкого продукта, перца, зелени или соуса." : "Проверить перевод, хранение и КБЖУ.",
  };
}

function slotFor(course, title, id) {
  const value = `${course} ${title}`.toLowerCase();
  if (/\bbreakfast\b|\bpancakes?\b|\boats\b|\begg\s+bites?\b|\bfrench toast\b/.test(value)) return "breakfast";
  if (/dessert|snack|bite|cookie|brownie|muffin|bar\b/.test(value)) return "snack1";
  return id % 2 ? "dinner" : "lunch";
}

const posts = [];
let page = 1;
let totalPages = 1;
while (posts.length < limit && page <= totalPages) {
  endpoint.searchParams.set("page", String(page));
  const response = await fetch(endpoint, { headers: { "User-Agent": "Mise recipe research/1.0" } });
  if (!response.ok) throw new Error(`Meal Prep Manual returned ${response.status} on page ${page}`);
  totalPages = Number(response.headers.get("x-wp-totalpages") ?? totalPages);
  posts.push(...await response.json());
  page += 1;
}
const candidates = posts.slice(0, limit).map((post) => {
  const html = post.content?.rendered ?? "";
  const title = text(post.title?.rendered ?? "");
  const ingredients = ingredientFacts(html);
  const course = first(html, /wprm-recipe-course[^>]*>([\s\S]*?)<\/span>/i);
  const imageUrl = decode(html.match(/wprm-recipe-image[\s\S]{0,800}?<a href="([^"]+)"/i)?.[1] ?? "");
  const sourceInstructions = wprmInstructionTexts(html);
  return {
    id: `tmpm-${post.id}`,
    title,
    sourceTitle: title,
    sourceUrl: post.link,
    sourceQuery: "mealprep recipes",
    imageUrl: imageUrl || undefined,
    imageUse: "source-preview-only",
    slot: slotFor(course, title, post.id),
    course,
    time: {
      prepMinutes: duration(html, "prep"),
      cookMinutes: duration(html, "cook"),
      totalMinutes: duration(html, "total"),
    },
    servings: numeric(html, "wprm-recipe-servings"),
    macros: {
      kcal: nutrition(html, "calories"),
      protein: nutrition(html, "protein"),
      fat: nutrition(html, "fat"),
      carbs: nutrition(html, "carbohydrates"),
    },
    ingredients,
    ...instructionFacts(sourceInstructions),
    localization: localizationFor(title, ingredients),
    editorialStatus: previousStatuses.get(`tmpm-${post.id}`) ?? "pending",
  };
}).filter((item) => item.title && item.ingredients.length > 0);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ importedAt: new Date().toISOString(), source: "The Meal Prep Manual", candidates }, null, 2)}\n`, "utf8");
console.log(`Imported ${candidates.length} candidates to ${output}`);
