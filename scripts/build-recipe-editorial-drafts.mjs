import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_DATASETS = [
  new URL("../data/mealprepmanual-candidates.json", import.meta.url),
  new URL("../data/goodfood-candidates.json", import.meta.url),
];

const THERMAL_ACTIONS = new Set(["cook", "bake", "roast", "grill", "boil", "simmer", "saute", "fry", "air_fry"]);
const SUPPORTED_ACTIONS = new Set([
  "preheat", "heat", "cook", "bake", "roast", "grill", "boil", "simmer", "saute", "fry", "air_fry",
  "mix", "combine", "stir", "whisk", "blend", "chop", "dice", "slice", "season", "marinate", "add",
  "place", "transfer", "divide", "assemble", "cover", "cool", "refrigerate", "freeze", "reheat",
]);

const actionText = {
  heat: "Разогрейте",
  cook: "Готовьте",
  bake: "Запекайте",
  roast: "Запекайте",
  grill: "Готовьте на гриле",
  boil: "Доведите до кипения",
  simmer: "Томите на слабом огне",
  saute: "Обжарьте",
  fry: "Обжарьте",
  air_fry: "Готовьте в аэрогриле",
  mix: "Смешайте",
  combine: "Соедините",
  stir: "Перемешайте",
  whisk: "Взбейте",
  blend: "Пробейте блендером",
  chop: "Нарежьте",
  dice: "Нарежьте кубиком",
  slice: "Нарежьте ломтиками",
  season: "Приправьте",
  marinate: "Замаринуйте",
  add: "Добавьте",
  place: "Выложите",
  transfer: "Переложите",
  divide: "Разделите",
  assemble: "Соберите блюдо",
  cover: "Накройте",
  cool: "Остудите",
  refrigerate: "Уберите в холодильник",
  freeze: "Уберите в морозильную камеру",
  reheat: "Разогрейте перед подачей",
};

const equipmentText = {
  oven: { object: "духовку", context: "в духовке" },
  stovetop: { object: "плиту", context: "на плите" },
  skillet: { object: "сковороду", context: "на сковороде" },
  frying_pan: { object: "сковороду", context: "на сковороде" },
  pot: { object: "кастрюлю", context: "в кастрюле" },
  saucepan: { object: "сотейник", context: "в сотейнике" },
  slow_cooker: { object: "мультиварку", context: "в мультиварке" },
  air_fryer: { object: "аэрогриль", context: "в аэрогриле" },
  microwave: { object: "микроволновую печь", context: "в микроволновой печи" },
  baking_sheet: { object: "противень", context: "на противне" },
  baking_dish: { object: "форму для запекания", context: "в форме для запекания" },
  blender: { object: "блендер", context: "в блендере" },
  food_processor: { object: "кухонный комбайн", context: "в кухонном комбайне" },
  mixing_bowl: { object: "миску", context: "в миске" },
};

const donenessText = {
  golden: "до золотистой корочки",
  browned: "до румяности",
  cooked_through: "до полной готовности внутри",
  tender: "до мягкости",
  crispy: "до хрустящей корочки",
  thickened: "до загустения",
  fork_tender: "до мягкости при прокалывании вилкой",
  internal_temperature: "до указанной внутренней температуры",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ingredientIdsFor(candidate) {
  const ingredients = asArray(candidate.ingredients).length ? candidate.ingredients : asArray(candidate.sourceIngredients);
  return ingredients.map((ingredient, index) => {
    const supplied = typeof ingredient?.id === "string" && ingredient.id.trim() ? ingredient.id.trim() : undefined;
    return supplied ?? `source-ingredient-${index + 1}`;
  });
}

function factActions(fact) {
  const values = [fact?.action, ...asArray(fact?.actions)]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function oneTemperature(fact) {
  const values = asArray(fact?.temperatureC)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 40 && value <= 300);
  if (values.length === 1) return `${values[0]}°C`;
  if (values.length > 1) return null;
  const match = typeof fact?.temperature === "string" && fact.temperature.match(/\b(\d{2,3})\s*°?\s*C\b/i);
  return match ? `${Number(match[1])}°C` : undefined;
}

function oneDuration(fact) {
  const values = asArray(fact?.durationMinutes)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 24 * 60);
  if (values.length === 1) return `${values[0]} мин`;
  if (values.length > 1) return null;
  const match = typeof fact?.duration === "string" && fact.duration.match(/\b(\d+(?:\.\d+)?)\s*min\b/i);
  return match ? `${Number(match[1])} мин` : undefined;
}

function equipmentFor(fact, kind) {
  const known = asArray(fact?.equipment).filter((item) => typeof item === "string" && equipmentText[item]);
  const first = known[0];
  return first ? equipmentText[first][kind] : undefined;
}

function donenessFor(fact) {
  const known = asArray(fact?.donenessCue).filter((item) => typeof item === "string" && donenessText[item]);
  return known.length === 1 ? donenessText[known[0]] : known.length > 1 ? null : undefined;
}

function actionNeedsIngredients(action) {
  return !new Set(["preheat", "heat", "cover", "cool", "refrigerate", "freeze"]).has(action);
}

function stepBlockers(fact, index) {
  const prefix = `source_step_${index + 1}`;
  const actions = factActions(fact);
  if (!actions.length) return [`${prefix}_missing_action`];
  const action = actions[0];
  if (!SUPPORTED_ACTIONS.has(action)) return [`${prefix}_unsupported_action:${action}`];
  const temperature = oneTemperature(fact);
  const duration = oneDuration(fact);
  const doneness = donenessFor(fact);
  const blockers = [];
  if (temperature === null) blockers.push(`${prefix}_ambiguous_temperature`);
  if (duration === null) blockers.push(`${prefix}_ambiguous_duration`);
  if (doneness === null) blockers.push(`${prefix}_ambiguous_doneness`);
  if (action === "preheat" && (!temperature || !equipmentFor(fact, "object"))) blockers.push(`${prefix}_preheat_needs_temperature_and_equipment`);
  if (action === "heat" && !equipmentFor(fact, "object")) blockers.push(`${prefix}_heat_needs_equipment`);
  if (THERMAL_ACTIONS.has(action) && !temperature && !duration && !doneness) blockers.push(`${prefix}_thermal_action_needs_time_temperature_or_doneness`);
  return blockers;
}

function sourceStepText(fact) {
  const action = factActions(fact)[0];
  const temperature = oneTemperature(fact);
  const duration = oneDuration(fact);
  const doneness = donenessFor(fact);
  const context = equipmentFor(fact, "context");
  if (action === "preheat") return `Разогрейте ${equipmentFor(fact, "object")} до ${temperature}.`;

  const parts = [actionText[action]];
  if (context && !["grill", "air_fry"].includes(action)) parts.push(context);
  if (temperature && action !== "preheat") parts.push(`при ${temperature}`);
  if (duration) parts.push(`в течение ${duration}`);
  if (doneness) parts.push(doneness);
  return `${parts.join(" ")}.`;
}

/**
 * Builds original Russian steps from deliberately prose-free source facts.
 * It refuses to bridge missing procedural facts with invented cooking settings.
 */
export function buildParaphrasedInstructionDraft(candidate) {
  const blockers = [];
  const servings = Number(candidate?.servings);
  const ingredientIds = ingredientIdsFor(candidate ?? {});
  const facts = asArray(candidate?.instructionFacts);

  if (!Number.isFinite(servings) || servings <= 0) blockers.push("missing_or_invalid_servings");
  if (!ingredientIds.length) blockers.push("missing_ingredients");
  if (!facts.length) blockers.push("missing_instruction_facts");
  facts.forEach((fact, index) => blockers.push(...stepBlockers(fact, index)));
  if (blockers.length) return { draft: [], blockers: [...new Set(blockers)] };

  const draft = [{
    id: "editorial-step-1",
    text: `Подготовьте ингредиенты из карточки на ${servings} ${servings === 1 ? "порцию" : "порции"}.`,
    ingredientIds,
    dependsOn: [],
    action: "prepare",
  }];

  for (const [index, fact] of facts.entries()) {
    const action = factActions(fact)[0];
    const id = `editorial-step-${index + 2}`;
    draft.push({
      id,
      text: sourceStepText(fact),
      ingredientIds: actionNeedsIngredients(action) ? ingredientIds : [],
      action,
      ...(oneTemperature(fact) ? { temperature: oneTemperature(fact) } : {}),
      ...(oneDuration(fact) ? { duration: oneDuration(fact) } : {}),
      ...(asArray(fact.equipment).length ? { equipment: asArray(fact.equipment) } : {}),
      ...(donenessFor(fact) ? { donenessCue: donenessFor(fact) } : {}),
      dependsOn: [draft.at(-1).id],
    });
  }
  return { draft, blockers: [] };
}

export function buildEditorialDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.candidates)) throw new Error("Dataset must contain candidates[]");
  const blocked = [];
  let drafted = 0;
  let existingDrafts = 0;
  const candidates = dataset.candidates.map((candidate) => {
    if (Array.isArray(candidate.paraphrasedInstructionDraft) && candidate.paraphrasedInstructionDraft.length) {
      existingDrafts += 1;
      return candidate;
    }
    const result = buildParaphrasedInstructionDraft(candidate);
    if (result.blockers.length) {
      blocked.push({ id: candidate.id, blockers: result.blockers });
      return candidate;
    }
    drafted += 1;
    return { ...candidate, paraphrasedInstructionDraft: result.draft };
  });
  return { dataset: { ...dataset, candidates }, summary: { total: candidates.length, drafted, existingDrafts, blocked } };
}

async function atomicWriteJson(path, value) {
  const directory = dirname(path);
  const tempPath = join(directory, `.recipe-editorial-${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function updateEditorialDraftDatasets(paths = DEFAULT_DATASETS.map(fileURLToPath), { dryRun = false } = {}) {
  const originals = await Promise.all(paths.map(async (path) => ({ path, dataset: JSON.parse(await readFile(path, "utf8")) })));
  const built = originals.map(({ path, dataset }) => ({ path, ...buildEditorialDataset(dataset) }));
  if (!dryRun) await Promise.all(built.map(({ path, dataset }) => atomicWriteJson(path, dataset)));
  return {
    dryRun,
    total: built.reduce((sum, item) => sum + item.summary.total, 0),
    drafted: built.reduce((sum, item) => sum + item.summary.drafted, 0),
    existingDrafts: built.reduce((sum, item) => sum + item.summary.existingDrafts, 0),
    blocked: built.flatMap((item) => item.summary.blocked),
  };
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node scripts/build-recipe-editorial-drafts.mjs [--dry-run] [--mealprepmanual path] [--goodfood path]\n");
    return;
  }
  const paths = [
    resolve(argumentValue("--mealprepmanual") ?? fileURLToPath(DEFAULT_DATASETS[0])),
    resolve(argumentValue("--goodfood") ?? fileURLToPath(DEFAULT_DATASETS[1])),
  ];
  const report = await updateEditorialDraftDatasets(paths, { dryRun: process.argv.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
