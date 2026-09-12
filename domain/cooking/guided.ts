import type { ResourceKind, ResourceUse } from "./types";

export type GuidedBackgroundCategory = "oven" | "covered_simmer" | "boil" | "cold_wait";

const allowedKinds: Record<GuidedBackgroundCategory, readonly ResourceKind[]> = {
  oven: ["oven", "baking_dish"],
  covered_simmer: ["burner", "pot", "pan", "multicooker", "pressure_cooker"],
  boil: ["burner", "pot", "pan", "multicooker", "pressure_cooker"],
  cold_wait: ["fridge", "bowl"],
};

/** Kitchen kinds which can perform the source-backed background action. */
export function allowedGuidedBackgroundResourceKinds(category: GuidedBackgroundCategory): readonly ResourceKind[] {
  return allowedKinds[category];
}

/** Reject confirmations that name utensils but no appliance appropriate to the source action. */
export function validGuidedBackgroundResources(category: GuidedBackgroundCategory, resources: readonly ResourceUse[], methodResources: readonly ResourceUse[]): boolean {
  if (!resources.length || resources.some(resource => !allowedKinds[category].includes(resource.kind))) return false;
  const kinds = new Set(resources.map(resource => resource.kind));
  const sourceKinds = new Set(methodResources.map(resource => resource.kind));
  if (category === "cold_wait") return kinds.has("fridge");
  if (category === "oven") return sourceKinds.has("oven") && sourceKinds.has("baking_dish") && kinds.has("oven") && kinds.has("baking_dish");
  const sourceVessels = [...sourceKinds].filter((kind): kind is "pot" | "pan" => kind === "pot" || kind === "pan");
  const sourceAppliance = (["multicooker", "pressure_cooker"] as const).find(kind => sourceKinds.has(kind));
  if (sourceAppliance && kinds.has(sourceAppliance)) return true;
  return sourceKinds.has("burner") && kinds.has("burner") && sourceVessels.length > 0 && sourceVessels.every(kind => kinds.has(kind));
}
