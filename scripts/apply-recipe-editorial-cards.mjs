import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATASET_PATHS = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
];
const EDITORIAL_PATHS = [
  "data/recipe-editorial/cards-a.json",
  "data/recipe-editorial/cards-b.json",
  "data/recipe-editorial/cards-c.json",
];
const cyrillic = /[А-Яа-яЁё]/;
const GENERIC_PROCEDURE_PHRASES = [
  /подготовьте и отмерьте ингредиенты из карточки/i,
  /готовьте до полной готовности и нужной текстуры/i,
  /соедините готовые компоненты, перемешайте до равномерности/i,
];
const THERMAL_ACTIONS = new Set(["cook", "bake", "roast", "grill", "boil", "simmer", "saute", "fry", "air_fry", "reheat"]);
const STORAGE_REFERENCE = "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/leftovers-and-food-safety";

function editorialStorage(candidate, card) {
  const actions = new Set(card.paraphrasedInstructionDraft.map((step) => step.action).filter(Boolean));
  const thermal = [...actions].some((action) => THERMAL_ACTIONS.has(action));
  const explicitFreeze = actions.has("freeze") || /\bfreez(?:e|er|ing)|freeze-ahead\b/i.test(`${candidate.title} ${candidate.sourceTitle}`);
  return {
    refrigeratorDays: 3,
    freezerDays: explicitFreeze ? 60 : 0,
    freezable: explicitFreeze,
    coolWithinHours: 2,
    reheatToC: thermal ? 74 : null,
    refrigerator: "До 3 суток при температуре не выше 4°C; убрать в холодильник не позднее чем через 2 часа после приготовления.",
    freezer: explicitFreeze ? "До 60 суток при −18°C для сохранения качества." : "Заморозка не подтверждена для этой карточки.",
    thaw: explicitFreeze ? "Размораживать в холодильнике; после разморозки использовать в течение 3 суток." : "Не требуется.",
    reheat: thermal ? "Разогреть до 74°C в центре порции." : "Подавать без повторного нагрева.",
    reference: STORAGE_REFERENCE,
  };
}

function editorialPacking(candidate, card) {
  const servings = Number(candidate.servings);
  return {
    portion: Number.isFinite(servings) && servings > 0 ? `1/${servings} готового блюда` : "Выход порции требует проверки",
    separate: /salad|wrap|sandwich|burger|taco|flatbread/i.test(String(candidate.title)) ? "Влажный соус и свежие хрустящие компоненты держать отдельно до подачи." : undefined,
    label: `${card.titleRu} · дата готовки · использовать в течение 3 суток`,
  };
}

function validateCard(card, candidate) {
  if (!card || card.id !== candidate.id) throw new Error(`Editorial order mismatch: expected ${candidate.id}, got ${card?.id ?? "missing"}`);
  if (typeof card.titleRu !== "string" || !cyrillic.test(card.titleRu)) throw new Error(`${card.id}: Russian title is required`);
  if (!Array.isArray(card.paraphrasedInstructionDraft)) throw new Error(`${card.id}: draft must be an array`);
  if (!Array.isArray(card.proceduralBlockers)) throw new Error(`${card.id}: proceduralBlockers must be an array`);
  if (!new Set(["ready", "review_required"]).has(card.proceduralStatus)) throw new Error(`${card.id}: invalid proceduralStatus`);
  if (card.proceduralStatus === "ready" && (!card.paraphrasedInstructionDraft.length || card.proceduralBlockers.length)) {
    throw new Error(`${card.id}: ready procedure needs a non-empty draft and no blockers`);
  }
  if (card.proceduralStatus === "review_required" && !card.proceduralBlockers.length) {
    throw new Error(`${card.id}: review_required procedure needs a blocker`);
  }
  const ingredientIds = new Set((candidate.ingredients ?? candidate.sourceIngredients ?? []).map((ingredient, index) => ingredient.id ?? `source-ingredient-${index + 1}`));
  const earlierSteps = new Set();
  for (const [index, step] of card.paraphrasedInstructionDraft.entries()) {
    if (!step?.id || earlierSteps.has(step.id)) throw new Error(`${card.id}: duplicate or missing step id at ${index + 1}`);
    if (typeof step.text !== "string" || !cyrillic.test(step.text)) throw new Error(`${card.id}/${step.id}: independently written Russian text is required`);
    if (card.proceduralStatus === "ready" && GENERIC_PROCEDURE_PHRASES.some((pattern) => pattern.test(step.text))) {
      throw new Error(`${card.id}/${step.id}: generic procedure placeholder is not allowed`);
    }
    if (!Array.isArray(step.ingredientIds) || step.ingredientIds.some((id) => !ingredientIds.has(id))) throw new Error(`${card.id}/${step.id}: invalid ingredientIds`);
    if (!Array.isArray(step.dependsOn) || step.dependsOn.some((id) => !earlierSteps.has(id))) throw new Error(`${card.id}/${step.id}: dependency must reference an earlier step`);
    earlierSteps.add(step.id);
  }
}

async function atomicWrite(path, document) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function applyRecipeEditorialCards({ cwd = process.cwd(), write = false } = {}) {
  const datasetEntries = await Promise.all(DATASET_PATHS.map(async (relativePath) => ({
    relativePath,
    path: resolve(cwd, relativePath),
    document: JSON.parse(await readFile(resolve(cwd, relativePath), "utf8")),
  })));
  const candidates = datasetEntries.flatMap((entry) => entry.document.candidates);
  const cards = (await Promise.all(EDITORIAL_PATHS.map(async (relativePath) => JSON.parse(await readFile(resolve(cwd, relativePath), "utf8"))))).flat();
  if (candidates.length !== cards.length) throw new Error(`Expected one editorial card per candidate; got ${candidates.length}/${cards.length}`);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Editorial card IDs must be unique");
  candidates.forEach((candidate, index) => validateCard(cards[index], candidate));

  let cursor = 0;
  const output = datasetEntries.map((entry) => ({
    ...entry,
    document: {
      ...entry.document,
      candidates: entry.document.candidates.map((candidate) => {
        const card = cards[cursor++];
        return {
          ...candidate,
          titleRu: card.titleRu,
          paraphrasedInstructionDraft: card.paraphrasedInstructionDraft,
          proceduralStatus: card.proceduralStatus,
          proceduralBlockers: card.proceduralBlockers,
          storage: editorialStorage(candidate, card),
          packing: editorialPacking(candidate, card),
        };
      }),
    },
  }));
  if (write) await Promise.all(output.map((entry) => atomicWrite(entry.path, entry.document)));
  return {
    total: cards.length,
    ready: cards.filter((card) => card.proceduralStatus === "ready").length,
    reviewRequired: cards.filter((card) => card.proceduralStatus === "review_required").length,
    written: write,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await applyRecipeEditorialCards({ write: process.argv.includes("--write") });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
