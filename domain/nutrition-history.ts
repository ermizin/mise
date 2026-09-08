export type ActualNutritionSnapshot = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type NutritionSnapshot = {
  recipeId: string;
  actual: ActualNutritionSnapshot;
  capturedAt: number;
  calculationVersion: 2;
};

/** Immutable historical nutrition, keyed by a mealOccurrenceKey. */
export type NutritionHistory = Record<string, NutritionSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeActual(value: unknown): ActualNutritionSnapshot | null {
  if (!isRecord(value) || !validNumber(value.kcal) || !validNumber(value.protein) || !validNumber(value.fat) || !validNumber(value.carbs)) {
    return null;
  }
  return {
    kcal: value.kcal,
    protein: value.protein,
    fat: value.fat,
    carbs: value.carbs,
  };
}

function sanitizeSnapshot(value: unknown): NutritionSnapshot | null {
  if (!isRecord(value) || typeof value.recipeId !== "string" || !value.recipeId.trim() || !validNumber(value.capturedAt) || value.calculationVersion !== 2) {
    return null;
  }
  const actual = sanitizeActual(value.actual);
  return actual
    ? {
      recipeId: value.recipeId,
      actual,
      capturedAt: value.capturedAt,
      calculationVersion: 2,
    }
    : null;
}

/** Drops malformed persisted values and returns a fresh, serializable v2 record. */
export function normalizeNutritionHistory(value: unknown): NutritionHistory {
  if (!isRecord(value)) return {};
  const history: NutritionHistory = {};
  for (const [key, candidate] of Object.entries(value)) {
    const snapshot = sanitizeSnapshot(candidate);
    if (key && snapshot) history[key] = snapshot;
  }
  return history;
}

/**
 * Adds the first valid observation for an occurrence. Once present, a snapshot
 * remains authoritative even if a recipe's current calculation later changes.
 */
export function preserveNutritionSnapshot(
  history: unknown,
  mealOccurrenceKey: string,
  recipeId: string,
  actual: unknown,
  capturedAt: number,
): NutritionHistory {
  const normalized = normalizeNutritionHistory(history);
  if (normalized[mealOccurrenceKey]) return normalized;
  const snapshot = sanitizeSnapshot({ recipeId, actual, capturedAt, calculationVersion: 2 });
  if (!mealOccurrenceKey || !snapshot) return normalized;
  return { ...normalized, [mealOccurrenceKey]: snapshot };
}

/** Returns history only when it belongs to the recipe still assigned to the meal. */
export function getNutritionSnapshot(
  history: unknown,
  mealOccurrenceKey: string,
  recipeId: string,
): NutritionSnapshot | null {
  const snapshot = normalizeNutritionHistory(history)[mealOccurrenceKey];
  return snapshot?.recipeId === recipeId ? snapshot : null;
}
