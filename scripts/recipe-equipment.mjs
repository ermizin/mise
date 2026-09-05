import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { recipeEffortDifficulty } from "../domain/recipe-engine.ts";

const manifest = JSON.parse(await readFile(new URL("../data/recipe-equipment.json", import.meta.url), "utf8"));
export const kitchenEquipmentIds = manifest.equipmentIds;
const entries = new Map(manifest.recipes.map((entry) => [entry.recipeId, entry]));
if (entries.size !== manifest.recipes.length) throw new Error("Duplicate recipe equipment entry");

export function recipeEquipmentFor(id, title, steps) {
  const entry = entries.get(id);
  if (!entry || entry.title !== title) throw new Error(`Equipment review missing or outdated: ${id}`);
  const digest = createHash("sha256").update(JSON.stringify(steps)).digest("hex");
  if (entry.sourceStepsSha256 !== digest) throw new Error(`Cooking instructions changed; review equipment: ${id}`);
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
