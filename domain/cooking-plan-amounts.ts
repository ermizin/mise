import { aggregateCookingAmounts, nutritionForFamily, physicalBatchAmountsViable, solveRecipeFamily, type RecipeFamily } from "./recipe-engine";
import { calculateMealPlanTargets, type Macros, type MealSlot } from "./nutrition";

export type CookingPlanPerson = { id: string; daily: Macros; includedSlots: MealSlot[]; hardExclusions?: string[] };
export type CookingPlanTuning = { protein: number; fat: number; carbs: number };
export type CookingPlanFlex = Record<keyof CookingPlanTuning, [number, number]>;
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function solveRecipeFamilyMeal(
  family: RecipeFamily,
  input: Parameters<typeof solveRecipeFamily>[1],
) {
  const direct = solveRecipeFamily(family, input);
  if (direct.viable || direct.reason === "hard_exclusion") return direct;
  // A capped meal protein floor must also be reachable by the search. The
  // primary solve still aims for the slot's full proportional protein share,
  // but that objective can steer the best candidate just outside the calorie
  // window even when a floor-clearing variant exists inside it.
  if (
    input.proteinFloor !== undefined &&
    input.targetProtein !== undefined &&
    input.targetProtein > input.proteinFloor
  ) {
    const floorAligned = solveRecipeFamily(family, {
      ...input,
      targetProtein: input.proteinFloor,
    });
    if (floorAligned.viable) return floorAligned;
  }
  const maxRepeats = Math.max(
    1,
    Math.min(8, Math.floor(family.geometryLockedMax ?? 8)),
  );
  const repeated = [];
  for (let repeat = 2; repeat <= maxRepeats; repeat += 1) {
    // The engine solves integer calorie ceilings. Flooring here prevents a
    // half-calorie sub-target from rounding up and crossing the original meal
    // ceiling after the complete serving is repeated.
    const targetCalories = Math.floor(input.targetCalories / repeat);
    if (
      targetCalories < family.minViableCalories ||
      targetCalories > family.maxViableCalories
    )
      continue;
    const variant = solveRecipeFamily(family, {
      ...input,
      targetCalories,
      targetProtein:
        input.targetProtein === undefined
          ? undefined
          : input.targetProtein / repeat,
      proteinFloor:
        input.proteinFloor === undefined
          ? undefined
          : input.proteinFloor / repeat,
      targetFat:
        input.targetFat === undefined ? undefined : input.targetFat / repeat,
      targetCarbs:
        input.targetCarbs === undefined
          ? undefined
          : input.targetCarbs / repeat,
      // The complete logical meal owns one pooled share of the physical
      // cooking fat, however many ordinary servings it contains.
      cookingFatShare: (input.cookingFatShare ?? 1) / repeat,
    });
    if (!variant.viable) continue;
    const nutrition = Object.fromEntries(
      Object.entries(variant.nutrition).map(([key, value]) => [
        key,
        round(value * repeat, 1),
      ]),
    ) as Macros;
    if (nutrition.kcal > input.targetCalories + 0.2) continue;
    repeated.push({
      ...variant,
      targetCalories: input.targetCalories,
      targetProtein: input.targetProtein,
      targetFat: input.targetFat,
      targetCarbs: input.targetCarbs,
      amounts: Object.fromEntries(
        Object.entries(variant.amounts).map(([id, amount]) => [
          id,
          round(amount * repeat, 3),
        ]),
      ),
      nutrition,
      explanation: [
        `Одна порция этого приёма пищи состоит из ${repeat} обычных порций рецепта.`,
        ...variant.explanation,
      ],
      repeat,
    });
  }
  return (
    repeated.sort(
      (left, right) =>
        right.nutrition.kcal - left.nutrition.kcal,
    )[0] ?? direct
  );
}

/** Recomputes one physical batch from durable plan targets and trusted recipe data. */
export function plannedCookingAmounts(
  family: RecipeFamily, flex: CookingPlanFlex, people: CookingPlanPerson[], slot: MealSlot,
  days: number, tuningFor: (person: CookingPlanPerson) => CookingPlanTuning | undefined = () => undefined,
): Record<string, number> | null {
  if (!people.length || !Number.isInteger(days) || days < 1 || days > 14) return null;
  const portionCount = people.length * days;
  const proposals = people.map(person => {
    const target = person.includedSlots.includes(slot)
      ? calculateMealPlanTargets(person.daily, person.includedSlots).slots[slot]
      : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    const tuning = tuningFor(person);
    const ratios = tuning ? {
      protein: clamp(tuning.protein, ...flex.protein), fat: clamp(tuning.fat, ...flex.fat), carbs: clamp(tuning.carbs, ...flex.carbs),
    } : { protein: 1, fat: 1, carbs: 1 };
    const solved = solveRecipeFamilyMeal(family, {
      targetCalories: target.kcal, targetProtein: Math.min(target.kcal / 8, target.protein * ratios.protein),
      proteinFloor: 0, proteinGoalMode: "soft", targetFat: target.fat * ratios.fat, targetCarbs: target.carbs * ratios.carbs,
      hardExclusions: person.hardExclusions, cookingFatShare: 1 / portionCount,
    });
    return { solved, target, repeat: "repeat" in solved ? Number(solved.repeat) : 1 };
  });
  if (proposals.some(proposal => !proposal.solved.viable)) return null;
  const amounts = aggregateCookingAmounts(family.ingredients, proposals.map(proposal => proposal.solved.amounts), days, proposals.map(proposal => proposal.repeat));
  const totalCalories = proposals.reduce((sum, proposal) => sum + proposal.solved.nutrition.kcal, 0);
  if (!physicalBatchAmountsViable(family.ingredients, people.length, days, proposals.map(proposal => proposal.repeat))) return null;
  for (const proposal of proposals) {
    const share = totalCalories > 0 ? proposal.solved.nutrition.kcal / totalCalories / days : 0;
    const nutrition = nutritionForFamily(family, Object.fromEntries(Object.entries(amounts).map(([id, amount]) => [id, amount * share])));
    if (Object.values(nutrition).some(value => !Number.isFinite(value) || value < 0) || nutrition.kcal < proposal.target.kcal * 0.9 || nutrition.kcal > proposal.target.kcal * 1.05) return null;
  }
  return amounts;
}
