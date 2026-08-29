import { createHash } from "node:crypto";

const decode = (value = "") => String(value)
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");

export const sourceInstructionText = (value = "") => decode(String(value)
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim());

const actionMatchers = [
  ["preheat", /\bpreheat\b/i], ["heat", /\bheat\b/i], ["cook", /\bcook\b/i],
  ["bake", /\bbak(?:e|es|ed|ing)\b/i], ["roast", /\broast(?:s|ed|ing)?\b/i],
  ["grill", /\bgrill(?:s|ed|ing)?\b/i], ["boil", /\bboil(?:s|ed|ing)?\b/i],
  ["simmer", /\bsimmer(?:s|ed|ing)?\b/i], ["saute", /\b(?:saut[eé]|saut[eé]s|saut[eé]ed|saut[eé]ing)\b/i],
  ["fry", /\bfry|fried|frying\b/i], ["air_fry", /\bair[ -]?fry\b/i],
  ["mix", /\bmix(?:es|ed|ing)?\b/i], ["combine", /\bcombin(?:e|es|ed|ing)\b/i],
  ["stir", /\bstir(?:s|red|ring)?\b/i], ["whisk", /\bwhisk(?:s|ed|ing)?\b/i],
  ["blend", /\bblend(?:s|ed|ing)?\b/i], ["chop", /\bchop(?:s|ped|ping)?\b/i],
  ["dice", /\bdic(?:e|es|ed|ing)\b/i], ["slice", /\bslic(?:e|es|ed|ing)\b/i],
  ["season", /\bseason(?:s|ed|ing)?\b/i], ["marinate", /\bmarinat(?:e|es|ed|ing)\b/i],
  ["add", /\badd(?:s|ed|ing)?\b/i], ["place", /\bplac(?:e|es|ed|ing)\b/i],
  ["transfer", /\btransfer(?:s|red|ring)?\b/i], ["divide", /\bdivid(?:e|es|ed|ing)\b/i],
  ["assemble", /\bassembl(?:e|es|ed|ing)\b/i], ["cover", /\bcover(?:s|ed|ing)?\b/i],
  ["cool", /\bcool(?:s|ed|ing)?\b/i], ["refrigerate", /\brefrigerat(?:e|es|ed|ing)\b/i],
  ["freeze", /\bfreez(?:e|es|ing)|\bfroze(?:n)?\b/i], ["reheat", /\breheat(?:s|ed|ing)?\b/i],
];

const equipmentMatchers = [
  ["oven", /\boven\b/i], ["stovetop", /\bstove(?:top)?\b/i], ["skillet", /\bskillet\b/i],
  ["frying_pan", /\b(?:frying )?pan\b/i], ["pot", /\bpot\b/i], ["saucepan", /\bsaucepan\b/i],
  ["slow_cooker", /\bslow cooker\b/i], ["air_fryer", /\bair fryer\b/i],
  ["microwave", /\bmicrowave\b/i], ["baking_sheet", /\b(?:sheet pan|baking sheet)\b/i],
  ["baking_dish", /\b(?:baking dish|casserole dish)\b/i], ["blender", /\bblender\b/i],
  ["food_processor", /\bfood processor\b/i], ["mixing_bowl", /\bmixing bowl\b/i],
];

const donenessMatchers = [
  ["golden", /\bgolden(?: brown)?\b/i], ["browned", /\bbrowned?\b/i],
  ["cooked_through", /\bcooked through\b/i], ["tender", /\btender\b/i],
  ["crispy", /\bcrispy\b/i], ["thickened", /\bthicken(?:ed)?\b/i],
  ["fork_tender", /\bfork[- ]tender\b/i], ["internal_temperature", /\binternal temperature\b/i],
];

const matches = (source, matchers) => matchers.filter(([, pattern]) => pattern.test(source)).map(([token]) => token);

function temperatures(source) {
  const values = [];
  for (const match of source.matchAll(/\b(\d{2,3})\s*°?\s*([FC])\b/gi)) {
    const value = Number(match[1]);
    const unit = match[2].toUpperCase();
    const celsius = unit === "F" ? Math.round((value - 32) * 5 / 9) : value;
    if (celsius >= 40 && celsius <= 300 && !values.includes(celsius)) values.push(celsius);
  }
  return values;
}

function durations(source) {
  const values = [];
  for (const match of source.matchAll(/\b(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\s*)?(\d+(?:\.\d+)?)?\s*(?:minutes?|mins?|min)\b/gi)) {
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const total = Math.round(hours * 60 + minutes);
    if (total > 0 && total <= 24 * 60 && !values.includes(total)) values.push(total);
  }
  for (const match of source.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/gi)) {
    const total = Math.round(Number(match[1]) * 60);
    if (total > 0 && total <= 24 * 60 && !values.includes(total)) values.push(total);
  }
  return values;
}

export function sourceInstructionHash(instructions) {
  const canonical = instructions.map(sourceInstructionText).filter(Boolean).join("\n");
  return canonical ? createHash("sha256").update(canonical, "utf8").digest("hex") : undefined;
}

// Facts intentionally omit source prose. Editorial Russian steps must be authored separately.
export function instructionFacts(instructions) {
  const sourceInstructions = instructions.map(sourceInstructionText).filter(Boolean);
  return {
    sourceInstructionCount: sourceInstructions.length,
    sourceInstructionHash: sourceInstructionHash(sourceInstructions),
    instructionFacts: sourceInstructions.map((source, index) => {
      const temperatureC = temperatures(source);
      const durationMinutes = durations(source);
      const equipment = matches(source, equipmentMatchers);
      const donenessCue = matches(source, donenessMatchers);
      const actions = matches(source, actionMatchers);
      return {
        id: `source-step-${index + 1}`,
        order: index + 1,
        actions,
        ...(actions[0] ? { action: actions[0] } : {}),
        ...(temperatureC.length ? { temperatureC, temperature: temperatureC.map((value) => `${value}°C`).join(", ") } : {}),
        ...(durationMinutes.length ? { durationMinutes, duration: durationMinutes.map((value) => `${value} min`).join(", ") } : {}),
        ...(equipment.length ? { equipment } : {}),
        ...(donenessCue.length ? { donenessCue } : {}),
        // Kept for RecipeInstruction structural compatibility without retaining source text.
        text: "",
        ingredientIds: [],
      };
    }),
  };
}

export function wprmInstructionTexts(html) {
  return [...String(html).matchAll(/class="[^"]*wprm-recipe-instruction-text[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)]
    .map((match) => sourceInstructionText(match[1]))
    .filter(Boolean);
}

export function schemaInstructionTexts(value) {
  const output = [];
  const visit = (item) => {
    if (typeof item === "string") output.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      if (typeof item.text === "string") output.push(item.text);
      else if (typeof item.name === "string") output.push(item.name);
      else if (Array.isArray(item.itemListElement)) item.itemListElement.forEach(visit);
    }
  };
  visit(value);
  return output.map(sourceInstructionText).filter(Boolean);
}
