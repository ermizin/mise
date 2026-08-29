// Compatibility surface retained from the visual handoff. The canonical model
// lives in domain/nutrition.ts so formulas and policy exist in one place only.
export {
  ACTIVITY_FACTORS,
  MEAL_SLOT_SHARES,
  NUTRITION_CONFIG,
  calculateMacroTargets,
  calculateMealPlanTargets,
  calculateNutritionTarget,
  capMacrosAtCalories,
  fitMacrosToCalories,
  macroCalories,
  macrosForCalories,
  normalizeNutritionTargetMode,
  recalculateDailyMacros,
  shareForSlots,
  togglePersonMealSlot,
} from "../domain/nutrition";

export type {
  ActivityKey,
  MacroKey,
  MacroPreset,
  MacroPresetOption,
  Macros,
  MealPlanTargets,
  MealSlot,
  NutritionCalculation,
  NutritionGoal,
  NutritionIssue,
  NutritionTargetMode,
  NutritionWizardInput,
  Sex,
} from "../domain/nutrition";
