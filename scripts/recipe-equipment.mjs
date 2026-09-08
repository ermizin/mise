import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { recipeEffortDifficulty } from "../domain/recipe-engine.ts";

const manifest = JSON.parse(await readFile(new URL("../data/recipe-equipment.json", import.meta.url), "utf8"));
export const kitchenEquipmentIds = manifest.equipmentIds;
const entries = new Map(manifest.recipes.map((entry) => [entry.recipeId, entry]));
if (entries.size !== manifest.recipes.length) throw new Error("Duplicate recipe equipment entry");

const historicalPackingText = "Разделите готовый выход по числу рассчитанных контейнеров, подпишите имя, приём пищи и дату, затем уберите на хранение.";

function fingerprint(steps) {
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex");
}

function historicalSplitTexts(steps) {
  const expanded = [];
  for (const step of steps) {
    const parts = String(step)
      .split(/(?<=[.!?])\s+(?=[А-ЯЁ])/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const merged = [];
    for (const part of parts) {
      if (part.length < 20 && merged.length) merged[merged.length - 1] += ` ${part}`;
      else merged.push(part);
    }
    if (merged.length > 1 && merged[0].length < 20) {
      merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
    }
    expanded.push(...merged);
  }
  return expanded;
}

export function matchesEquipmentInstructionFingerprint(expectedFingerprint, steps) {
  if (expectedFingerprint === fingerprint(steps)) return true;
  const historical = historicalSplitTexts(steps);
  if (expectedFingerprint === fingerprint(historical)) return true;
  // This is the only historical generated text accepted by the gate. It was
  // appended solely when the old splitter produced one instruction and is not
  // part of the grouped editorial source now.
  return historical.length === 1 &&
    expectedFingerprint === fingerprint([...historical, historicalPackingText]);
}

export function recipeEquipmentFor(id, title, steps) {
  const entry = entries.get(id);
  if (!entry || entry.title !== title) throw new Error(`Equipment review missing or outdated: ${id}`);
  if (!matchesEquipmentInstructionFingerprint(entry.sourceStepsSha256, steps)) {
    throw new Error(`Cooking instructions changed; review equipment: ${id}`);
  }
  if (!entry.methods.length || new Set(entry.methods.map((method) => method.id)).size !== entry.methods.length)
    throw new Error(`Invalid equipment methods: ${id}`);
  for (const method of entry.methods) {
    if (!Array.isArray(method.requiredEquipment) || new Set(method.requiredEquipment).size !== method.requiredEquipment.length || method.requiredEquipment.some((item) => !kitchenEquipmentIds.includes(item)))
      throw new Error(`Invalid equipment requirements: ${id}/${method.id}`);
    if ((method.requiredEquipment.includes("pot") || method.requiredEquipment.includes("pan")) && !method.requiredEquipment.includes("stove"))
      throw new Error(`Stovetop cookware has no heat source: ${id}/${method.id}`);
    if (!method.id || !method.label) throw new Error(`Unnamed equipment method: ${id}`);
    if (method.id !== "original" && (!Array.isArray(method.steps) || method.steps.length < 3 || method.steps.some((step) => typeof step !== "string" || !step.trim()) || !method.requiredEquipment.includes(method.id) || !Number.isFinite(method.timeMinutes) || !Number.isFinite(method.activeMinutes) || method.activeMinutes <= 0 || method.timeMinutes < method.activeMinutes || !method.note))
      throw new Error(`Incomplete appliance cooking method: ${id}/${method.id}`);
  }
  return structuredClone(entry.methods).map((method) => method.id === "original" ? method : {
    ...method,
    difficulty: recipeEffortDifficulty(method.activeMinutes, method.requiredEquipment.filter((id) => id !== "stove").length),
  });
}

export function equipmentCoverage(recipes) {
  const multicooker = recipes.filter((recipe) => recipe.equipmentOptions?.some((method) => method.id === "multicooker"));
  const airFryer = recipes.filter((recipe) => recipe.equipmentOptions?.some((method) => method.id === "air_fryer"));
  const unique = new Set([...multicooker, ...airFryer].map((recipe) => recipe.id));
  if (unique.size < 50) throw new Error(`Appliance coverage is ${unique.size}; expected at least 50 unique active recipes`);
  return { multicooker: multicooker.length, airFryer: airFryer.length, uniqueRecipes: unique.size };
}
