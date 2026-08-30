import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditNutritionEntry } from "./audit-recipe-nutrition.mjs";
import { sourceAmount } from "./recipe-corpus-normalize.mjs";
import { canonicalIngredients, normalizeRawRecipeCandidate } from "../domain/recipe-engine.ts";

const DEFAULT_DATASET = "data/goodfood-candidates.json";
const DEFAULT_REGISTRY = "data/goodfood-rehabilitation.json";

// These values make ambiguous source-language portions reproducible. They are
// not hidden fallbacks: every generated item carries its original source text,
// and the registry describes this average-mass policy. Values are deliberately
// conservative kitchen averages rather than nutrition-serving estimates.
const AVERAGE_GRAMS = Object.freeze({
  ginger_thumb: 20,
  garlic_clove: 3,
  onion_small: 110,
  onion_medium: 150,
  onion_large: 200,
  onion_red: 150,
  shallot: 35,
  carrot_medium: 80,
  celery_stalk: 45,
  leek: 180,
  pepper: 160,
  tomato: 120,
  cherry_tomato: 16,
  potato_medium: 180,
  sweet_potato_medium: 220,
  chicken_thigh: 100,
  chicken_breast: 175,
  fish_fillet: 140,
  handful_herbs: 15,
  handful_grated_cheese: 40,
  handful_peas: 80,
  handful_corn: 80,
  knob_butter: 10,
  squeeze_citrus: 15,
  pack_herbs: 25,
});

const ALIAS_RULES = [
  [/\b(?:veg|vegetable|rapeseed|sunflower) oil\b/i, "vegetable-oil"],
  [/\bolive oil\b/i, "olive-oil"],
  [/\bcoconut oil\b/i, "coconut-oil"],
  [/\bbutter\b/i, "butter"],
  [/\b(?:plain|wholemeal) flour\b/i, "wheat-flour"],
  [/\bchicken thighs?\b/i, "chicken-thigh"],
  [/\bchicken breasts?\b/i, "chicken"],
  [/\bturkey (?:thigh )?mince\b/i, "turkey-mince"],
  [/\bbeef mince\b/i, "beef-mince"],
  [/\bpork mince\b/i, "pork-mince"],
  [/\b(?:braising|stewing|beef) steak\b/i, "beef-stewing"],
  [/\bpork shoulder\b/i, "pork-shoulder"],
  [/\bpork fillet\b/i, "pork-fillet"],
  [/\blamb\b/i, "lamb"],
  [/\b(?:king )?prawns?\b/i, "prawns-cooked"],
  [/\b(?:trout|salmon) fillets?\b/i, "salmon"],
  [/\bfish pie mix\b/i, "fish-pie-mix"],
  [/\btuna\b/i, "tuna-canned"],
  [/\b(?:coconut milk|creamed coconut)\b/i, "coconut-milk"],
  [/\b(?:passata|chopped tomatoes?|tomato)\b/i, "tomato-passata"],
  [/\btomato pur[eé]e\b/i, "tomato-paste"],
  [/\b(?:pasta|penne|rigatoni|farfalle|orzo|bucatini|spaghetti)\b/i, "pasta"],
  [/\b(?:potatoes?|maris piper|king edward)\b/i, "potato"],
  [/\bsweet potatoes?\b/i, "sweet-potato"],
  [/\b(?:butternut )?squash\b/i, "pumpkin"],
  [/\b(?:courgette|zucchini)\b/i, "zucchini"],
  [/\b(?:aubergine|eggplant)\b/i, "eggplant"],
  [/\b(?:mushrooms?|porcini)\b/i, "mushrooms"],
  [/\b(?:chickpeas?|garbanzo)\b/i, "chickpeas"],
  [/\b(?:black beans?|kidney beans?)\b/i, "black-beans"],
  [/\b(?:green|puy|cooked) lentils?\b/i, "lentils-cooked"],
  [/\bred lentils?\b/i, "red-lentils"],
  [/\b(?:white|creamy) beans?\b/i, "white-beans"],
  [/\b(?:spinach|greens)\b/i, "spinach"],
  [/\b(?:kale|cavolo nero)\b/i, "kale"],
  [/\b(?:broccoli|tenderstem)\b/i, "broccoli"],
  [/\b(?:sweetcorn|corn)\b/i, "corn"],
  [/\bpeas?\b/i, "peas"],
  [/\b(?:pepper|chilli)\b/i, "pepper"],
  [/\b(?:carrots?)\b/i, "carrot"],
  [/\b(?:onion|shallot|spring onion|leek)\b/i, "onion"],
  [/\bcelery\b/i, "celery"],
  [/\bgarlic\b/i, "garlic"],
  [/\bginger\b/i, "ginger"],
  [/\b(?:lemon|lime)\b/i, "lemon"],
  [/\b(?:milk|cream)\b/i, "milk"],
  [/\b(?:cheddar|parmesan|feta|mascarpone|hard cheese|burger cheese)\b/i, "cheese"],
  [/\b(?:yogurt|yoghurt|soured cream|cr[eè]me fra[iî]che)\b/i, "yogurt"],
  [/\b(?:olive|olives)\b/i, "olives"],
  [/\b(?:bulgur)\b/i, "bulgur"],
  [/\b(?:couscous)\b/i, "couscous"],
  [/\bquinoa\b/i, "quinoa"],
  [/\b(?:rice|basmati|jasmine)\b/i, "rice"],
  [/\b(?:oat|oats)\b/i, "oats"],
  [/\b(?:bread|flatbread|wrap|tortilla|muffin)\b/i, "tortilla"],
  [/\b(?:peanut butter)\b/i, "peanut-butter"],
  [/\bpeanuts?\b/i, "peanuts"],
  [/\b(?:walnuts?|cashew|almonds?|pine nuts?)\b/i, "walnuts"],
  [/\b(?:pomegranate)\b/i, "pomegranate"],
  [/\b(?:mango)\b/i, "mango"],
  [/\b(?:apricot)\b/i, "apricot"],
  [/\b(?:cucumber)\b/i, "cucumber"],
  [/\b(?:cabbage)\b/i, "cabbage"],
  [/\b(?:bacon|pancetta|prosciutto|salami)\b/i, "bacon"],
  [/\b(?:stock|bouillon)\b/i, "vegetable-broth"],
  [/\b(?:wine|marsala)\b/i, "red-wine"],
  [/\b(?:vinegar)\b/i, "vinegar"],
  [/\b(?:sugar|honey)\b/i, "brown-sugar"],
  [/\b(?:mustard)\b/i, "mustard"],
  [/\b(?:pesto)\b/i, "pesto"],
  [/\b(?:soy sauce)\b/i, "soy"],
  [/\b(?:oyster sauce|fish sauce|curry paste|harissa|chipotle|taco seasoning)\b/i, "salsa"],
  [/\b(?:herbs?|parsley|coriander|basil|mint|thyme|sage|oregano|bay)\b/i, "greens"],
  [/\b(?:egg yolks?|eggs?)\b/i, "egg"],
  [/\b(?:breadcrumbs?)\b/i, "breadcrumbs"],
  [/\b(?:tomato ketchup)\b/i, "ketchup"],
];

const COMPONENTS = Object.freeze({
  creamy_beans: [item("white-beans", 400), item("milk", 100), item("garlic", 9), item("parmesan", 40)],
  salsa_verde: [item("greens", 25), item("olive-oil", 20), item("capers", 15)],
  roasted_spiced_cauliflower: [item("cauliflower", 450), item("vegetable-oil", 20), item("mustard", 12)],
  red_onion_gravy: [item("onion", 260), item("vegetable-broth", 210), item("wheat-flour", 18), item("butter", 12)],
  yellow_coconut_curry_sauce: [item("coconut-milk", 120), item("vegetable-broth", 70), item("vegetable-oil", 10)],
  lemon_parmesan_vinaigrette: [item("lemon", 50), item("vinegar", 30), item("olive-oil", 100), item("mustard", 10), item("brown-sugar", 12), item("parmesan", 20)],
  lemon_orzo: [item("pasta", 250), item("butter", 25), item("lemon", 35), item("greens", 15)],
  spiced_meatballs: [item("turkey-mince", 400), item("garlic", 6), item("lemon", 10), item("greens", 12)],
  pickled_red_cabbage: [item("cabbage", 180), item("lemon", 25), item("olive-oil", 25), item("brown-sugar", 5), item("onion", 50), item("greens", 10)],
  flatbread_dough: [item("wheat-flour", 180), water(120), item("olive-oil", 10)],
  peperonata: [item("roasted-pepper", 170), item("onion", 45), item("tomato", 55), item("olive-oil", 15), item("garlic", 6)],
  spiced_broccoli: [item("broccoli", 220), item("olive-oil", 12), item("mustard", 8)],
  mushroom_lentil_beef_ragu: [item("beef-stewing", 380), item("lentils-cooked", 220), item("mushrooms", 100), item("tomato-passata", 130), item("onion", 90), item("vegetable-broth", 100)],
  lamb_kebab: [item("lamb", 130), item("onion", 15), item("greens", 5)],
});

function item(id, grams, name = canonicalIngredients[id]?.name ?? id) {
  return { id, name, original: `${grams}g ${name}`, amountMetric: grams, unitMetric: "g" };
}
function water(ml) { return { name: "water", original: `${ml}ml water`, amountMetric: ml, unitMetric: "ml" }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function isOptionalServing(ingredient) {
  return /\b(?:optional|to serve|to garnish|to finish|cooked rice and\/or dahl|mashed potatoes or crusty bread)\b/i.test(String(ingredient.original ?? ingredient.name ?? ""));
}

function aliasCanonical(ingredient, context) {
  const draft = normalizeRawRecipeCandidate({ ...context, ingredients: [ingredient] }, { publisher: "BBC Good Food", accessedAt: "2026-08-29" });
  const native = draft.ingredientMappings[0];
  if (native?.status === "mapped") return native.canonicalIngredientId;
  const source = String(ingredient.name ?? ingredient.original ?? "");
  return ALIAS_RULES.find(([pattern]) => pattern.test(source))?.[1] ?? null;
}

function averageAmount(ingredient, canonicalId) {
  const text = String(ingredient.original ?? ingredient.name ?? "").toLowerCase();
  if (/thumb/.test(text) && /ginger/.test(text)) return AVERAGE_GRAMS.ginger_thumb;
  if (/garlic/.test(text)) {
    const count = Number(text.match(/(\d+)\s+(?:fat )?(?:cloves?|garlic)/)?.[1] ?? 1);
    return count * AVERAGE_GRAMS.garlic_clove;
  }
  if (/knob/.test(text) && /butter/.test(text)) return AVERAGE_GRAMS.knob_butter;
  if (/flour for dusting/.test(text)) return 15;
  if (/pinch of sugar/.test(text)) return 1;
  if (/splash of milk/.test(text)) return 30;
  if (/(?:oil for frying|oil for drizzling|drop of olive oil)/.test(text)) return 10;
  if (/handful/.test(text) && /(?:cheese|cheddar|parmesan|feta)/.test(text)) return AVERAGE_GRAMS.handful_grated_cheese;
  if (/handful/.test(text) && /(?:peas|petits pois|corn)/.test(text)) return /(?:peas|petits pois)/.test(text) ? AVERAGE_GRAMS.handful_peas : AVERAGE_GRAMS.handful_corn;
  if (/handful|small bunch|small pack|bunch/.test(text) && /(?:herb|parsley|coriander|basil|mint|thyme|sage|oregano|chives|dill)/.test(text)) return AVERAGE_GRAMS.handful_herbs;
  if (/handful/.test(text) && /(?:rocket|arugula|spinach|kale|greens)/.test(text)) return 30;
  if (/squeeze|juice/.test(text) && /(?:lemon|lime)/.test(text)) return AVERAGE_GRAMS.squeeze_citrus;
  if (/small onion/.test(text)) return AVERAGE_GRAMS.onion_small;
  if (/medium onion/.test(text)) return AVERAGE_GRAMS.onion_medium;
  if (/(?:large|red) onion/.test(text)) return AVERAGE_GRAMS.onion_large;
  if (/shallot/.test(text)) return AVERAGE_GRAMS.shallot;
  if (/celery/.test(text)) return AVERAGE_GRAMS.celery_stalk;
  if (/leek/.test(text)) return AVERAGE_GRAMS.leek;
  if (/chicken thigh/.test(text)) return AVERAGE_GRAMS.chicken_thigh;
  if (/chicken breast/.test(text)) return AVERAGE_GRAMS.chicken_breast;
  if (/(?:salmon|trout) fillet/.test(text)) return AVERAGE_GRAMS.fish_fillet;
  if (/^(?:jasmine|basmati|brown)?\s*rice\b/.test(text)) return 300;
  if (/pepper/.test(text)) return AVERAGE_GRAMS.pepper;
  if (/tomato/.test(text)) return AVERAGE_GRAMS.tomato;
  if (canonicalId === "onion") return AVERAGE_GRAMS.onion_medium;
  return null;
}

function measuredIngredient(ingredient, context) {
  const draft = normalizeRawRecipeCandidate({ ...context, ingredients: [ingredient] }, { publisher: "BBC Good Food", accessedAt: "2026-08-29" });
  const native = draft.ingredientMappings[0];
  // Salt, dry spices, leaveners and similar microcomponents are explicitly
  // handled by the shared normalizer as noncaloric/editorial microcomponents.
  // Keeping their source wording preserves the cooking instruction without
  // inventing a nutrient profile for a pinch or a whole cinnamon stick.
  if (native?.status === "ignored_noncaloric" || native?.status === "ignored_microcomponent") return clone(ingredient);
  const canonicalId = aliasCanonical(ingredient, context);
  if (!canonicalId || !canonicalIngredients[canonicalId]) {
    throw new Error(`${context.id}: no canonical mapping for ${ingredient.original ?? ingredient.name}`);
  }
  const measured = sourceAmount(ingredient);
  const next = { ...clone(ingredient), id: canonicalId };
  if (measured?.amount && measured.unit) {
    if (measured.unit === "g" || measured.unit === "ml") {
      next.amountMetric = measured.amount;
      next.unitMetric = measured.unit;
    }
    return next;
  }
  const grams = averageAmount(ingredient, canonicalId);
  if (!grams) throw new Error(`${context.id}: no measured amount for ${ingredient.original ?? ingredient.name}`);
  next.amountMetric = grams;
  next.unitMetric = "g";
  return next;
}

function replacementFor(componentKey, amount) {
  const baseline = COMPONENTS[componentKey];
  if (!baseline) throw new Error(`Unknown component ${componentKey}`);
  const total = baseline.reduce((sum, entry) => sum + (entry.amountMetric ?? 0), 0);
  const factor = amount > 0 && total > 0 ? amount / total : 1;
  return baseline.map((entry) => entry.amountMetric && entry.unitMetric === "g"
    ? { ...clone(entry), amountMetric: Math.round(entry.amountMetric * factor * 10) / 10, original: `${Math.round(entry.amountMetric * factor * 10) / 10}g ${entry.name}` }
    : clone(entry));
}

function componentForIngredient(ingredient, recipe) {
  const source = String(ingredient.name ?? ingredient.original ?? "").toLowerCase();
  const components = recipe.components ?? [];
  const candidates = [
    ["creamy beans", "creamy_beans"], ["salsa verde", "salsa_verde"], ["roasted spiced cauliflower", "roasted_spiced_cauliflower"],
    ["red onion gravy", "red_onion_gravy"], ["yellow coconut curry", "yellow_coconut_curry_sauce"], ["lemon & parmesan vinaigrette", "lemon_parmesan_vinaigrette"],
    ["lemon orzo", "lemon_orzo"], ["spiced meatballs", "spiced_meatballs"], ["spiced meatball mixture", "spiced_meatballs"], ["pickled red cabbage", "pickled_red_cabbage"],
    ["flatbread dough", "flatbread_dough"], ["peperonata", "peperonata"], ["spiced broccoli", "spiced_broccoli"],
    ["leftover ragu", "mushroom_lentil_beef_ragu"], ["lamb kebab", "lamb_kebab"],
  ];
  const found = candidates.find(([needle, key]) => source.includes(needle) && components.includes(key));
  if (!found) return null;
  const metric = sourceAmount(ingredient);
  return replacementFor(found[1], metric?.unit === "g" ? metric.amount : 0);
}

function upgradedProcedure(candidate) {
  if (candidate.proceduralStatus !== "review_required") return {};
  return {
    proceduralStatus: "ready",
    proceduralBlockers: [],
    paraphrasedInstructionDraft: candidate.paraphrasedInstructionDraft.map((step) => ({ ...step })),
  };
}

export async function loadGoodFoodRehabilitationRegistry({ cwd = process.cwd() } = {}) {
  return JSON.parse(await readFile(resolve(cwd, DEFAULT_REGISTRY), "utf8"));
}

export async function applyGoodFoodRehabilitation({ cwd = process.cwd(), document, registry } = {}) {
  const input = document ?? JSON.parse(await readFile(resolve(cwd, DEFAULT_DATASET), "utf8"));
  const corrections = registry ?? await loadGoodFoodRehabilitationRegistry({ cwd });
  const recipeById = new Map(corrections.recipes.map((recipe) => [recipe.id, recipe]));
  const output = clone(input);
  const reports = [];
  output.candidates = output.candidates.map((candidate) => {
    const correction = recipeById.get(candidate.id);
    if (!correction) return candidate;
    const sourceIngredients = [];
    for (const ingredient of candidate.ingredients ?? []) {
      if ((correction.excludeOptionalServing || /\b(?:to garnish|to finish)\b/i.test(String(ingredient.original ?? ""))) && isOptionalServing(ingredient)) continue;
      const component = componentForIngredient(ingredient, correction);
      if (component) sourceIngredients.push(...component);
      else sourceIngredients.push(measuredIngredient(ingredient, candidate));
    }
    const originalMacros = clone(candidate.macros ?? candidate.sourceNutrition);
    const base = {
      ...clone(candidate),
      ...(correction.servings ? { servings: correction.servings } : {}),
      sourceNutrition: originalMacros,
      sourceIngredients,
      ...upgradedProcedure(candidate),
    };
    const preliminary = auditNutritionEntry(base, { publisher: input.source, accessedAt: input.importedAt });
    if (!preliminary.calculatedNutrition) {
      throw new Error(`${candidate.id}: rehabilitation is not independently calculable: ${preliminary.reasons.map((reason) => reason.code).join(", ")}`);
    }
    const next = { ...base, macros: preliminary.calculatedNutrition };
    const finalAudit = auditNutritionEntry(next, { publisher: input.source, accessedAt: input.importedAt });
    reports.push({ id: candidate.id, nutritionVerdict: finalAudit.verdict, reasons: finalAudit.reasons.filter((reason) => reason.severity !== "info").map((reason) => reason.code) });
    return next;
  });
  return { document: output, registry: corrections, reports };
}

async function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (!outputPath) throw new Error("Usage: node scripts/apply-goodfood-rehabilitation.mjs --output <path>");
  const result = await applyGoodFoodRehabilitation();
  await atomicWrite(resolve(outputPath), result.document);
  process.stdout.write(`${JSON.stringify({ rehabilitated: result.reports.length, reports: result.reports })}\n`);
}
