export type MealSlot = "breakfast" | "snack1" | "lunch" | "snack2" | "dinner";
export type MacroKey = "kcal" | "protein" | "fat" | "carbs";
export type Macros = Record<MacroKey, number>;
export type MacroPreset = "balanced" | "protein" | "carbs" | "fat" | "custom";
export type MacroPresetOption = Exclude<MacroPreset, "custom">;
export type Sex = "male" | "female";
export type ActivityKey = "low" | "light" | "medium" | "high" | "athlete";
export type NutritionGoal = "maintenance" | "loss" | "gain";
export type NutritionTargetMode = "auto" | "manual";

export function normalizeNutritionTargetMode(
  value: unknown,
  hasEstimate: boolean,
  matchesEstimate: boolean,
): NutritionTargetMode {
  if (value === "auto" || value === "manual") return value;
  return hasEstimate && matchesEstimate ? "auto" : "manual";
}

export type NutritionWizardInput = {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  activity: ActivityKey;
  musclePriority: boolean;
  goal: NutritionGoal;
  monthlyWeightChangeKg: number;
};

export type NutritionIssue = {
  code:
    | "invalid_age"
    | "invalid_height"
    | "invalid_weight"
    | "invalid_monthly_change"
    | "extreme_monthly_change"
    | "extreme_energy_delta"
    | "minimum_calories_applied"
    | "maximum_calories_applied";
  severity: "error" | "warning";
  message: string;
};

export type NutritionCalculation = {
  bmr: number;
  tdee: number;
  dailyEnergyDelta: number;
  rawTargetCalories: number;
  target: Macros;
  issues: NutritionIssue[];
};

export type MealPlanTargets = {
  slots: Record<MealSlot, Macros>;
  selectedSlots: MealSlot[];
  planned: Macros;
  remaining: Macros;
  chocolateEquivalent: {
    grams: number;
    bars: number;
  };
};

const macroPresetShares: Record<
  MacroPresetOption,
  Pick<Macros, "protein" | "fat" | "carbs">
> = {
  balanced: { protein: 0.3, fat: 0.3, carbs: 0.4 },
  protein: { protein: 0.35, fat: 0.3, carbs: 0.35 },
  carbs: { protein: 0.25, fat: 0.25, carbs: 0.5 },
  fat: { protein: 0.3, fat: 0.4, carbs: 0.3 },
};

export const NUTRITION_CONFIG = {
  mealSlots: [
    { id: "breakfast", share: 0.25 },
    { id: "snack1", share: 0.1 },
    { id: "lunch", share: 0.3 },
    { id: "snack2", share: 0.1 },
    { id: "dinner", share: 0.25 },
  ] as const,
  activityFactors: {
    low: 1.2,
    light: 1.375,
    medium: 1.55,
    high: 1.725,
    athlete: 1.9,
  } satisfies Record<ActivityKey, number>,
  energyPerKgWeightChange: 7_700,
  averageDaysPerMonth: 30.4,
  minimumTargetCalories: 1_200,
  maximumTargetCalories: 5_000,
  warningMonthlyBodyWeightShare: 0.04,
  warningTdeeDeltaShare: 0.25,
  kcalPer100gChocolate: 535,
  chocolateBarWeightG: 100,
  validation: {
    age: [18, 100],
    height: [120, 230],
    weight: [35, 300],
    monthlyWeightChange: [0.1, 12],
  },
  macroPolicy: {
    proteinGPerKg: {
      standard: { maintenance: 1.2, loss: 1.5, gain: 1.4 },
      muscle: { maintenance: 2, loss: 2.2, gain: 2 },
    },
    fatCalorieShare: { standard: 0.3, muscle: 0.25 },
    maximumProteinCalorieShare: 0.4,
  },
  macroPresetShares,
} as const;

export const MEAL_SLOT_SHARES: Record<MealSlot, number> = Object.fromEntries(
  NUTRITION_CONFIG.mealSlots.map(({ id, share }) => [id, share]),
) as Record<MealSlot, number>;

export const ACTIVITY_FACTORS: Record<ActivityKey, number> =
  NUTRITION_CONFIG.activityFactors;

type PersonWithMealSlots = {
  id: string;
  includedSlots: MealSlot[];
};

export function togglePersonMealSlot<T extends PersonWithMealSlots>(
  people: readonly T[],
  planSlots: readonly MealSlot[],
  personId: string,
  slot: MealSlot,
) {
  const person = people.find((item) => item.id === personId);
  if (!person) return { people: [...people], mealSlots: [...planSlots] };

  const removing = person.includedSlots.includes(slot);
  const nextPeople = people.map((item) =>
    item.id !== personId
      ? item
      : {
          ...item,
          includedSlots: removing
            ? item.includedSlots.filter((itemSlot) => itemSlot !== slot)
            : [...item.includedSlots, slot],
        },
  );
  const slotStillUsed = nextPeople.some((item) =>
    item.includedSlots.includes(slot),
  );
  const selectedSlots = new Set(planSlots);
  if (slotStillUsed) selectedSlots.add(slot);
  else selectedSlots.delete(slot);

  return {
    people: nextPeople,
    mealSlots: NUTRITION_CONFIG.mealSlots
      .map(({ id }) => id)
      .filter((id) => selectedSlots.has(id)),
  };
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function macroCalories(
  macros: Pick<Macros, "protein" | "fat" | "carbs">,
) {
  return macros.protein * 4 + macros.fat * 9 + macros.carbs * 4;
}

export function fitMacrosToCalories(
  targetCalories: number,
  desired: Pick<Macros, "protein" | "fat" | "carbs">,
): Macros {
  const kcal = Math.max(0, Math.floor(finiteOrZero(targetCalories)));
  const positive = {
    protein: Math.max(0, finiteOrZero(desired.protein)),
    fat: Math.max(0, finiteOrZero(desired.fat)),
    carbs: Math.max(0, finiteOrZero(desired.carbs)),
  };
  const energy = macroCalories(positive);
  if (kcal === 0 || energy === 0) return { kcal, protein: 0, fat: 0, carbs: 0 };

  const factor = kcal / energy;
  const exact = {
    protein: positive.protein * factor,
    fat: positive.fat * factor,
    carbs: positive.carbs * factor,
  };
  const result = {
    protein: Math.floor(exact.protein),
    fat: Math.floor(exact.fat),
    carbs: Math.floor(exact.carbs),
  };

  const keys = ["protein", "carbs", "fat"] as const;
  while (true) {
    const remaining = kcal - macroCalories(result);
    const candidate = keys
      .filter((key) => (key === "fat" ? 9 : 4) <= remaining)
      .sort((a, b) => exact[b] - result[b] - (exact[a] - result[a]))[0];
    if (!candidate) break;
    result[candidate] += 1;
  }

  return { kcal, ...result };
}

export function capMacrosAtCalories(
  targetCalories: number,
  desired: Pick<Macros, "protein" | "fat" | "carbs">,
): Macros {
  const cap = Math.max(0, Math.floor(finiteOrZero(targetCalories)));
  const positive = {
    protein: Math.max(0, finiteOrZero(desired.protein)),
    fat: Math.max(0, finiteOrZero(desired.fat)),
    carbs: Math.max(0, finiteOrZero(desired.carbs)),
  };
  if (macroCalories(positive) > cap) return fitMacrosToCalories(cap, positive);
  const result = {
    protein: Math.floor(positive.protein),
    fat: Math.floor(positive.fat),
    carbs: Math.floor(positive.carbs),
  };
  return { kcal: macroCalories(result), ...result };
}

export function macrosForCalories(
  kcalInput: number,
  preset: MacroPresetOption,
): Macros {
  const kcal = Math.max(0, Math.floor(finiteOrZero(kcalInput)));
  const shares = macroPresetShares[preset];
  return fitMacrosToCalories(kcal, {
    protein: (kcal * shares.protein) / 4,
    fat: (kcal * shares.fat) / 9,
    carbs: (kcal * shares.carbs) / 4,
  });
}

export function recalculateDailyMacros(
  kcalInput: number,
  current: Macros,
  preset: MacroPreset,
): Macros {
  const kcal = Math.max(0, Math.floor(finiteOrZero(kcalInput)));
  if (preset !== "custom") return macrosForCalories(kcal, preset);
  if (macroCalories(current) <= 0) return macrosForCalories(kcal, "balanced");
  return fitMacrosToCalories(kcal, current);
}

export function repairLegacyDailyMacros(
  daily: Macros,
  preset: MacroPreset,
): Macros {
  const values = [daily.kcal, daily.protein, daily.fat, daily.carbs];
  const canRepair =
    values.every(Number.isFinite) &&
    daily.kcal >= NUTRITION_CONFIG.minimumTargetCalories &&
    daily.kcal <= NUTRITION_CONFIG.maximumTargetCalories &&
    daily.protein >= 0 &&
    daily.fat >= 0 &&
    daily.carbs >= 0;
  if (!canRepair || Math.abs(macroCalories(daily) - daily.kcal) <= 5)
    return daily;
  return recalculateDailyMacros(daily.kcal, daily, preset);
}

export function calculateMacroTargets(
  targetCalories: number,
  weightKg: number,
  musclePriority: boolean,
  goal: NutritionGoal,
): Macros {
  const kcal = Math.max(0, Math.floor(finiteOrZero(targetCalories)));
  const policyKey = musclePriority ? "muscle" : "standard";
  const policy = NUTRITION_CONFIG.macroPolicy;
  const desiredProtein =
    Math.max(0, finiteOrZero(weightKg)) * policy.proteinGPerKg[policyKey][goal];
  const proteinCap = Math.floor((kcal * policy.maximumProteinCalorieShare) / 4);
  const protein = Math.min(Math.round(desiredProtein), proteinCap);
  const remainingAfterProtein = Math.max(0, kcal - protein * 4);
  const desiredFat = Math.round((kcal * policy.fatCalorieShare[policyKey]) / 9);
  const fat = Math.min(desiredFat, Math.floor(remainingAfterProtein / 9));
  const carbs = Math.floor(Math.max(0, kcal - protein * 4 - fat * 9) / 4);
  return { kcal, protein, fat, carbs };
}

function rangeIssue(
  value: number,
  range: readonly number[],
  code: NutritionIssue["code"],
  label: string,
): NutritionIssue | null {
  if (Number.isFinite(value) && value >= range[0] && value <= range[1])
    return null;
  return {
    code,
    severity: "error",
    message: `${label}: допустимый диапазон ${range[0]}–${range[1]}.`,
  };
}

export function calculateNutritionTarget(
  input: NutritionWizardInput,
): NutritionCalculation | { issues: NutritionIssue[] } {
  const validation = NUTRITION_CONFIG.validation;
  const issues = [
    rangeIssue(input.age, validation.age, "invalid_age", "Возраст"),
    rangeIssue(input.height, validation.height, "invalid_height", "Рост"),
    rangeIssue(input.weight, validation.weight, "invalid_weight", "Вес"),
  ].filter((issue): issue is NutritionIssue => Boolean(issue));

  if (input.goal !== "maintenance") {
    const changeIssue = rangeIssue(
      input.monthlyWeightChangeKg,
      validation.monthlyWeightChange,
      "invalid_monthly_change",
      "Изменение веса в месяц",
    );
    if (changeIssue) issues.push(changeIssue);
  }
  if (issues.some(({ severity }) => severity === "error")) return { issues };

  const bmr =
    10 * input.weight +
    6.25 * input.height -
    5 * input.age +
    (input.sex === "male" ? 5 : -161);
  const tdee = bmr * ACTIVITY_FACTORS[input.activity];
  const requestedChange =
    input.goal === "maintenance" ? 0 : input.monthlyWeightChangeKg;
  const dailyEnergyDelta =
    (NUTRITION_CONFIG.energyPerKgWeightChange * requestedChange) /
    NUTRITION_CONFIG.averageDaysPerMonth;
  const signedDelta =
    input.goal === "loss"
      ? -dailyEnergyDelta
      : input.goal === "gain"
        ? dailyEnergyDelta
        : 0;
  const rawTargetCalories = tdee + signedDelta;

  if (
    requestedChange / input.weight >
    NUTRITION_CONFIG.warningMonthlyBodyWeightShare
  ) {
    issues.push({
      code: "extreme_monthly_change",
      severity: "warning",
      message:
        "Темп изменения веса выглядит высоким для введённой массы тела — проверьте цель.",
    });
  }
  if (dailyEnergyDelta / tdee > NUTRITION_CONFIG.warningTdeeDeltaShare) {
    issues.push({
      code: "extreme_energy_delta",
      severity: "warning",
      message:
        "Изменение калорий больше четверти текущей оценки расхода — проверьте цель.",
    });
  }

  const roundedTargetCalories = Math.round(rawTargetCalories / 10) * 10;
  const targetCalories = Math.min(
    NUTRITION_CONFIG.maximumTargetCalories,
    Math.max(NUTRITION_CONFIG.minimumTargetCalories, roundedTargetCalories),
  );
  if (targetCalories > roundedTargetCalories) {
    issues.push({
      code: "minimum_calories_applied",
      severity: "warning",
      message: `Расчёт упирается в нижнюю границу ${NUTRITION_CONFIG.minimumTargetCalories} ккал; это повод пересмотреть цель, а не медицинская рекомендация.`,
    });
  }
  if (targetCalories < roundedTargetCalories) {
    issues.push({
      code: "maximum_calories_applied",
      severity: "warning",
      message: `Расчёт ограничен верхней границей ${NUTRITION_CONFIG.maximumTargetCalories} ккал; проверьте параметры и цель.`,
    });
  }

  return {
    bmr: round(bmr),
    tdee: round(tdee),
    dailyEnergyDelta: round(dailyEnergyDelta),
    rawTargetCalories: round(rawTargetCalories),
    target: calculateMacroTargets(
      targetCalories,
      input.weight,
      input.musclePriority,
      input.goal,
    ),
    issues,
  };
}

function allocateCalories(targetCalories: number): Record<MealSlot, number> {
  const total = Math.max(0, Math.floor(finiteOrZero(targetCalories)));
  const exact = NUTRITION_CONFIG.mealSlots.map(({ id, share }, index) => ({
    id,
    index,
    exact: total * share,
  }));
  const result = Object.fromEntries(
    exact.map(({ id, exact: value }) => [id, Math.floor(value)]),
  ) as Record<MealSlot, number>;
  let remaining =
    total - Object.values(result).reduce((sum, value) => sum + value, 0);
  for (const { id } of [...exact].sort(
    (a, b) =>
      b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) ||
      a.index - b.index,
  )) {
    if (remaining <= 0) break;
    result[id] += 1;
    remaining -= 1;
  }
  return result;
}

export function calculateMealPlanTargets(
  daily: Macros,
  selectedSlots: MealSlot[],
): MealPlanTargets {
  const calories = allocateCalories(daily.kcal);
  const slots = Object.fromEntries(
    NUTRITION_CONFIG.mealSlots.map(({ id }) => [
      id,
      fitMacrosToCalories(calories[id], daily),
    ]),
  ) as Record<MealSlot, Macros>;
  const selected = [...new Set(selectedSlots)].filter(
    (slot): slot is MealSlot => slot in slots,
  );
  const planned = selected.reduce<Macros>(
    (sum, slot) => ({
      kcal: sum.kcal + slots[slot].kcal,
      protein: sum.protein + slots[slot].protein,
      fat: sum.fat + slots[slot].fat,
      carbs: sum.carbs + slots[slot].carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
  const remaining = {
    kcal: Math.max(0, daily.kcal - planned.kcal),
    protein: Math.max(0, daily.protein - planned.protein),
    fat: Math.max(0, daily.fat - planned.fat),
    carbs: Math.max(0, daily.carbs - planned.carbs),
  };
  const chocolateGrams =
    remaining.kcal > 0
      ? (remaining.kcal / NUTRITION_CONFIG.kcalPer100gChocolate) * 100
      : 0;
  return {
    slots,
    selectedSlots: selected,
    planned,
    remaining,
    chocolateEquivalent: {
      grams: round(chocolateGrams),
      bars: round(chocolateGrams / NUTRITION_CONFIG.chocolateBarWeightG, 1),
    },
  };
}

export function shareForSlots(selectedSlots: MealSlot[], slot: MealSlot) {
  return selectedSlots.includes(slot) ? MEAL_SLOT_SHARES[slot] : 0;
}
