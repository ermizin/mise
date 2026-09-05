/** Reviewed recipe chains only. Legacy timing/action projections are not inputs. */
export type StepCookingDish = {
  id: string;
  recipeId: string;
  title: string;
  methodId: string;
  requiredEquipment: string[];
  steps: { id: string; text: string; products: string[]; measurement: boolean }[];
};
export type StepCookingProfile = {
  recipeId: string;
  methodId: string;
  sourceRevision: string;
  provenance: string;
  requiredEquipment: string[];
  measurementMinutes: number;
  steps: {
    text: string;
    sourceStepId: string;
    dependsOn: string[];
    activeMinutes: number;
    waitMinutes: number;
    resumeMinutes: number;
    waitBasis?: string;
    deferred?: boolean;
  }[];
};
export type MergedCookingStep = {
  id: string;
  sourceStepId: string;
  dishId: string;
  dishTitle: string;
  instructionNumber: number;
  kind: "instruction" | "wait" | "resume" | "deferred";
  text: string;
  products: string[];
  start: number | null;
  end: number | null;
};
export type MergedCookingPlan = {
  available: boolean;
  reason: "ready" | "coverage" | "drift" | "resources";
  unavailableDishes: string[];
  steps: MergedCookingStep[];
  totalMinutes: number;
  sequentialMinutes: number;
};
const positive = (n: number) => Number.isInteger(n) && n > 0 && n <= 20160;
const nonNegative = (n: number) => n === 0 || positive(n);
const sameSet = (a: string[], b: string[]) => a.length === new Set(a).size && b.length === new Set(b).size &&
  a.length === b.length && a.every(value => b.includes(value));
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function buildMergedCookingPlan(
  dishes: StepCookingDish[],
  profiles: StepCookingProfile[],
  capacity: Record<string, number>,
): MergedCookingPlan {
  const failed = (reason: MergedCookingPlan["reason"], ids: string[]): MergedCookingPlan => ({
    available: false, reason, unavailableDishes: ids, steps: [], totalMinutes: 0, sequentialMinutes: 0,
  });
  if (!dishes.length || dishes.length > 20) return failed("coverage", dishes.map(dish => dish.id));
  if (new Set(dishes.map(dish => dish.id)).size !== dishes.length) return failed("drift", dishes.map(dish => dish.id));
  const deferredRows: MergedCookingStep[] = [];
  type TimedStep = MergedCookingStep & {start: number; end: number};
  const chains: { dish: StepCookingDish; rows: TimedStep[]; duration: number; resources: Record<string, number>; wait: number }[] = [];
  for (const dish of dishes) {
    const matches = profiles.filter(profile => profile.recipeId === dish.recipeId && profile.methodId === dish.methodId);
    if (matches.length !== 1) return failed("coverage", [dish.id]);
    const profile = matches[0];
    const [measurement, ...instructions] = dish.steps;
    if (!profile.sourceRevision || !profile.provenance || !positive(profile.measurementMinutes) ||
      !measurement?.measurement || instructions.some(step => step.measurement) || !instructions.length ||
      new Set(dish.steps.map(step => step.id)).size !== dish.steps.length ||
      profile.steps.length !== instructions.length || !sameSet(profile.requiredEquipment, dish.requiredEquipment)) {
      return failed("drift", [dish.id]);
    }
    const seen = new Set<string>();
    let deferred = false;
    for (let index = 0; index < profile.steps.length; index++) {
      const step = profile.steps[index];
      const expectedDependencies = index ? [profile.steps[index - 1].sourceStepId] : [];
      if (step.text !== instructions[index].text || !step.sourceStepId || seen.has(step.sourceStepId) ||
        !sameSet(step.dependsOn, expectedDependencies) ||
        (step.deferred ? step.activeMinutes !== 0 : !positive(step.activeMinutes)) ||
        !nonNegative(step.waitMinutes) || !nonNegative(step.resumeMinutes) ||
        (step.waitMinutes > 0 ? (!step.waitBasis || !positive(step.resumeMinutes)) : step.resumeMinutes !== 0)) {
        return failed("drift", [dish.id]);
      }
      if ((step.deferred !== undefined && typeof step.deferred !== "boolean") || (deferred && !step.deferred) || (step.deferred && (step.waitMinutes || step.resumeMinutes))) return failed("drift", [dish.id]);
      deferred ||= Boolean(step.deferred);
      seen.add(step.sourceStepId);
    }
    // Reserve the selected method's complete resource set until its dish finishes.
    // No implicit oven sharing or release points are inferred from instructions.
    const resources: Record<string, number> = Object.fromEntries(dish.requiredEquipment.map(id => [id, 1]));
    if (resources.stove) resources.stove = Math.max(1, (resources.pot ?? 0) + (resources.pan ?? 0));
    if (Object.entries(resources).some(([id, units]) => !Number.isInteger(capacity[id]) || capacity[id] < units)) {
      return failed("resources", [dish.id]);
    }
    const rows: TimedStep[] = [];
    let minute = 0;
    function add(source: StepCookingDish["steps"][number], instructionNumber: number, kind: MergedCookingStep["kind"], text: string, duration: number) {
      rows.push({ id: `${dish.id}:${source.id}:${kind}`, sourceStepId: source.id, dishId: dish.id, dishTitle: dish.title,
        instructionNumber, kind, text, products: kind === "instruction" ? [...source.products] : [], start: minute, end: minute + duration });
      minute += duration;
    }
    add(measurement, 0, "instruction", measurement.text, profile.measurementMinutes);
    instructions.forEach((source, index) => {
      const annotation = profile.steps[index];
      if (annotation.deferred) {
        deferredRows.push({id: `${dish.id}:${source.id}:deferred`, sourceStepId: source.id, dishId: dish.id, dishTitle: dish.title,
          instructionNumber: index + 1, kind: "deferred", text: source.text, products: [...source.products], start: null, end: null});
        return;
      }
      add(source, index + 1, "instruction", source.text, annotation.activeMinutes);
      if (annotation.waitMinutes) {
        add(source, index + 1, "wait", `Ожидание по шагу ${index + 1}. В это время выполняйте только действия других блюд, указанные на эти минуты. К следующему шагу этого блюда переходите после ожидания.`, annotation.waitMinutes);
        add(source, index + 1, "resume", `Вернитесь к шагу ${index + 1}: проверьте и завершите его по исходной инструкции.`, annotation.resumeMinutes);
      }
    });
    if (minute > 20160) return failed("drift", [dish.id]);
    chains.push({ dish, rows, duration: minute, resources, wait: profile.steps.reduce((sum, step) => sum + step.waitMinutes, 0) });
  }
  // Open the longest reviewed waiting opportunity first, stable by assignment id.
  chains.sort((a, b) => b.wait - a.wait || lexical(a.dish.id, b.dish.id));
  const reservations: { start: number; end: number; resources: Record<string, number> }[] = [];
  const occupied: {start:number; end:number}[] = [];
  const result: MergedCookingStep[] = [];
  let horizon = 0;
  let sequentialMinutes = 0;
  for (const chain of chains) {
    const attended = chain.rows.filter(row => row.kind !== "wait");
    let start = 0;
    // Jump between interval boundaries; multi-hour recipes must not require
    // iterating once per minute across the whole household schedule.
    while (start < horizon) {
      let next = start;
      for (const row of attended) for (const busy of occupied) {
        if (start + row.start < busy.end && start + row.end > busy.start) next = Math.max(next, busy.end - row.start);
      }
      const boundaries = [start, ...reservations.flatMap(item => [item.start, item.end])]
        .filter(minute => minute >= start && minute < start + chain.duration);
      for (const minute of boundaries) {
        const active = reservations.filter(item => item.start <= minute && minute < item.end);
        for (const [resource, units] of Object.entries(chain.resources)) {
          if (active.reduce((sum, item) => sum + (item.resources[resource] ?? 0), 0) + units > capacity[resource]) {
            next = Math.max(next, Math.min(...active.filter(item => item.resources[resource]).map(item => item.end)));
          }
        }
      }
      if (next === start) break;
      start = next;
    }
    occupied.push(...attended.map(row => ({start: start + row.start, end: start + row.end})));
    reservations.push({ start, end: start + chain.duration, resources: chain.resources });
    result.push(...chain.rows.map(row => ({ ...row, start: start + row.start, end: start + row.end })));
    horizon = Math.max(horizon, start + chain.duration);
    sequentialMinutes += chain.duration;
  }
  const kindOrder = { wait: 0, resume: 1, instruction: 2, deferred: 3 };
  result.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || kindOrder[a.kind] - kindOrder[b.kind] || lexical(a.id, b.id));
  deferredRows.sort((a,b) => lexical(a.dishId,b.dishId) || a.instructionNumber-b.instructionNumber);
  result.push(...deferredRows);
  return { available: true, reason: "ready", unavailableDishes: [], steps: result, totalMinutes: horizon, sequentialMinutes };
}
