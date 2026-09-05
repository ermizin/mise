export const applianceChoices = [
  { id: "oven", label: "Духовка", icon: "oven" },
  { id: "multicooker", label: "Мультиварка", icon: "multicooker" },
  { id: "microwave", label: "Микроволновка", icon: "microwave" },
  { id: "blender", label: "Блендер", icon: "blender" },
  { id: "processor", label: "Комбайн", icon: "processor" },
  { id: "steamer", label: "Пароварка", icon: "steamer" },
  { id: "air_fryer", label: "Аэрогриль", icon: "airfryer" },
  { id: "scale", label: "Весы", icon: "scale" },
  { id: "waffle_iron", label: "Вафельница", icon: "waffle" },
  { id: "pressure_cooker", label: "Скороварка", icon: "pot" },
] as const;
export const cookwareChoices = [
  { id: "saucepan", label: "Сотейник", icon: "pot" },
  { id: "pot", label: "Кастрюля от 3 л", icon: "pot" },
  { id: "pan", label: "Сковорода", icon: "pan" },
  { id: "tray", label: "Противень", icon: "tray" },
  { id: "baking_dish", label: "Форма для запекания", icon: "tray" },
] as const;
export type ApplianceId = typeof applianceChoices[number]["id"];
export type CookwareId = typeof cookwareChoices[number]["id"];
export type KitchenEquipmentId = "stove" | "pot" | "pan" | "oven" | "baking_dish" | "multicooker" | "air_fryer" | "blender" | "microwave" | "waffle_iron" | "pressure_cooker";
export type KitchenProfile = {
  appliances: Record<ApplianceId, boolean>;
  hob: { burners: number; type: "gas" | "electric" | "induction" };
  cookware: Record<CookwareId, number>;
  custom: { id: string; title: string; count: number }[];
  containers: { count: number; compartments: number };
  parallelCooking: boolean;
};
export function defaultKitchen(equipment?: readonly string[]): KitchenProfile {
  const selected = equipment ?? ["stove", "pot", "oven", "baking_dish", "scale"];
  return {
    appliances: Object.fromEntries(applianceChoices.map(({ id }) => [id, selected.includes(id)])) as KitchenProfile["appliances"],
    hob: { burners: selected.includes("stove") ? 4 : 0, type: "electric" },
    cookware: { saucepan: 0, pot: selected.includes("pot") ? 1 : 0, pan: selected.includes("pan") ? 1 : 0, tray: selected.includes("baking_dish") ? 1 : 0, baking_dish: 0 },
    custom: [], containers: { count: 0, compartments: 1 }, parallelCooking: false,
  };
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown, max: number) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;
export function isKitchenProfile(v: unknown): v is KitchenProfile {
  if (!object(v) || !object(v.appliances) || !object(v.hob) || !object(v.cookware) || !object(v.containers)) return false;
  const { appliances, hob, cookware, containers } = v;
  return Object.keys(appliances).length === applianceChoices.length && applianceChoices.every(({ id }) => typeof appliances[id] === "boolean") &&
    cookwareChoices.every(({ id }) => count(cookware[id], 12)) && count(hob.burners, 6) &&
    typeof hob.type === "string" && ["gas", "electric", "induction"].includes(hob.type) &&
    count(containers.count, 200) && count(containers.compartments, 5) && Number(containers.compartments) >= 1 &&
    typeof v.parallelCooking === "boolean" && Array.isArray(v.custom) && v.custom.length <= 20 &&
    v.custom.every(item => object(item) && typeof item.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) &&
      typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= 60 && count(item.count, 12)) &&
    new Set(v.custom.map(item => item.id)).size === v.custom.length;
}
export function kitchenEquipment(profile: KitchenProfile): KitchenEquipmentId[] {
  const result: KitchenEquipmentId[] = [];
  for (const id of ["oven", "multicooker", "microwave", "blender", "air_fryer", "waffle_iron", "pressure_cooker"] as const) {
    if (profile.appliances[id]) result.push(id);
  }
  // Processor, steamer and saucepan are not silently treated as interchangeable
  // with an appliance/cookware required by the curated recipe method.
  if (profile.hob.burners > 0) result.push("stove");
  if (profile.cookware.pot > 0) result.push("pot");
  if (profile.cookware.pan > 0) result.push("pan");
  if (profile.cookware.tray + profile.cookware.baking_dish > 0) result.push("baking_dish");
  return result;
}
export function sameEquipment(a?: readonly string[], b?: readonly string[]) {
  return a !== undefined && b !== undefined && [...a].sort().join(",") === [...b].sort().join(",");
}
export function kitchenSummary(profile: KitchenProfile) {
  return [...applianceChoices.filter(({id}) => profile.appliances[id]).map(({label}) => label),
    `${profile.hob.burners} конф.`, `${Object.values(profile.cookware).reduce((a,b) => a+b, 0)} предм. посуды`].join(" · ");
}
