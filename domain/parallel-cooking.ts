import type { KitchenProfile } from "./kitchen";
export type ParallelDish = { id: string; title: string; methodId: string; requiredEquipment: string[]; totalMinutes: number };
export type CookingWindow = { afterMinutes: number; minutes: number };
export type ScheduledDish = { id: string; title: string; start: number; end: number; unattended: CookingWindow | null };
export type ParallelSchedule = { dishes: ScheduledDish[]; totalMinutes: number; sequentialMinutes: number; maxParallelDishes: number; conflicts: string[] };
export function kitchenResources(kitchen: KitchenProfile): Record<string, number> {
  return { stove: kitchen.hob.burners, pot: kitchen.cookware.pot, pan: kitchen.cookware.pan,
    baking_dish: kitchen.cookware.tray + kitchen.cookware.baking_dish,
    ...Object.fromEntries(Object.entries(kitchen.appliances).map(([id, on]) => [id, on ? 1 : 0])) };
}
export function validCookingWindow(value: CookingWindow | undefined, duration: number): value is CookingWindow {
  // At least a minute of attended work before and after a user-declared window.
  // This bounds input, not a claim about loading/checking duration in a recipe.
  return Boolean(value && Number.isInteger(value.afterMinutes) && Number.isInteger(value.minutes) &&
    value.afterMinutes >= 1 && value.minutes >= 1 && value.afterMinutes + value.minutes < duration);
}
function resourcesFor(dish: ParallelDish): Record<string, number> {
  const resources = Object.fromEntries(dish.requiredEquipment.map(id => [id, 1]));
  // Without release points, reserve every vessel until the entire dish finishes.
  // A pot and a pan conservatively reserve two burners if both are required.
  if (resources.stove) resources.stove = Math.max(1, (resources.pot ?? 0) + (resources.pan ?? 0));
  return resources;
}
export function buildParallelSchedule(dishes: ParallelDish[], kitchen: KitchenProfile, windows: Record<string, CookingWindow> = {}): ParallelSchedule {
  const capacity = kitchenResources(kitchen);
  const scheduled: ScheduledDish[] = [];
  const reservations: { start: number; end: number; resources: Record<string, number> }[] = [];
  const cookBusy = new Set<number>();
  const conflicts: string[] = [];
  let sequentialMinutes = 0;
  const ids = new Set<string>();
  for (const dish of dishes) {
    const duration = Math.ceil(dish.totalMinutes);
    const resources = resourcesFor(dish);
    if (ids.has(dish.id) || dish.methodId === "missing" || !Number.isFinite(duration) || duration < 1 || duration > 1440 ||
      Object.entries(resources).some(([id, units]) => (capacity[id] ?? 0) < units)) { conflicts.push(dish.id); continue; }
    ids.add(dish.id);
    // Never infer hands-free time from action names, text, or active/total ratios.
    // Only a window explicitly entered by the person cooking may free the cook.
    const window = validCookingWindow(windows[dish.id], duration) ? windows[dish.id] : null;
    const attended: number[] = [];
    for (let minute = 0; minute < duration; minute++) if (!window || minute < window.afterMinutes || minute >= window.afterMinutes + window.minutes) attended.push(minute);
    sequentialMinutes += duration;
    let start = 0;
    const horizon = reservations.reduce((max, item) => Math.max(max, item.end), 0);
    for (; start <= horizon; start++) {
      if (attended.some(minute => cookBusy.has(start + minute))) continue;
      let fits = true;
      for (let minute = start; minute < start + duration && fits; minute++) {
        for (const [resource, units] of Object.entries(resources)) {
          const used = reservations.filter(item => item.start <= minute && minute < item.end).reduce((sum, item) => sum + (item.resources[resource] ?? 0), 0);
          if (used + units > (capacity[resource] ?? 0)) { fits = false; break; }
        }
      }
      if (fits) break;
    }
    reservations.push({ start, end: start + duration, resources });
    for (const minute of attended) cookBusy.add(start + minute);
    scheduled.push({ id: dish.id, title: dish.title, start, end: start + duration, unattended: window });
  }
  const totalMinutes = reservations.reduce((max, item) => Math.max(max, item.end), 0);
  let maxParallelDishes = 0;
  for (let minute = 0; minute < totalMinutes; minute++) maxParallelDishes = Math.max(maxParallelDishes, reservations.filter(item => item.start <= minute && minute < item.end).length);
  return { dishes: scheduled.sort((a,b) => a.start-b.start || a.id.localeCompare(b.id)), totalMinutes, sequentialMinutes, maxParallelDishes, conflicts };
}

export type CookingOrderEvent = {
  dishId: string;
  title: string;
  minute: number;
  kind: "finish" | "wait" | "resume" | "start";
};
/** A switch order, not inferred timings for individual recipe instructions. */
export function buildCookingOrder(schedule: ParallelSchedule): CookingOrderEvent[] {
  if (schedule.conflicts.length) return [];
  const events: CookingOrderEvent[] = [];
  for (const dish of schedule.dishes) {
    const common = { dishId: dish.id, title: dish.title };
    events.push({ ...common, minute: dish.start, kind: "start" });
    if (dish.unattended) {
      events.push({ ...common, minute: dish.start + dish.unattended.afterMinutes, kind: "wait" });
      events.push({ ...common, minute: dish.start + dish.unattended.afterMinutes + dish.unattended.minutes, kind: "resume" });
    }
    events.push({ ...common, minute: dish.end, kind: "finish" });
  }
  // Release work first; return to an existing dish before starting a new one.
  const priority = { finish: 0, wait: 1, resume: 2, start: 3 };
  return events.sort((a, b) => a.minute - b.minute || priority[a.kind] - priority[b.kind] ||
    (a.dishId < b.dishId ? -1 : a.dishId > b.dishId ? 1 : 0));
}
