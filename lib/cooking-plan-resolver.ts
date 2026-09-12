import catalog from "../data/cooking-plan-catalog.json";
import { plannedCookingAmounts, type CookingPlanFlex, type CookingPlanPerson, type CookingPlanTuning } from "../domain/cooking-plan-amounts";
import type { RecipeFamily } from "../domain/recipe-engine";
import type { MealSlot } from "../domain/nutrition";
import type { SelectedCookingRecipe } from "../domain/cooking/types";
import { cookingSourceDescriptor } from "../domain/cooking/compile";
import { plannedCookingDishes } from "./cooking-session-context";

/** Server-only: client quantities are never the authority for a new session. */
export function resolvePlannedCookingRecipes(plan: Record<string, unknown>, batchId: string): SelectedCookingRecipe[] | null {
  const identities = plannedCookingDishes(plan, batchId);
  const batch = Array.isArray(plan.batches) ? plan.batches.find(item => item?.id === batchId) : undefined;
  if (!identities?.length || !batch || !Array.isArray(plan.people)) return null;
  const people = plan.people as CookingPlanPerson[];
  const tuning = plan.tuning as Record<string, CookingPlanTuning> | undefined;
  const recipes: SelectedCookingRecipe[] = [];
  for (const identity of identities) {
    const recipe = catalog.recipes.find(item => item.recipeId === identity.recipeId);
    const source = cookingSourceDescriptor(identity.recipeId, identity.methodId);
    const slot = identity.dishKey.slice(batchId.length + 1).split(":")[0] as MealSlot;
    if (!recipe?.cookingFamily || !source) return null;
    const family = recipe.cookingFamily as unknown as RecipeFamily;
    const amounts = plannedCookingAmounts(family, recipe.flex as CookingPlanFlex,
      people.filter(person => identity.personIds.includes(person.id)), slot, batch.days,
      person => tuning?.[`${batchId}:${slot}:${person.id}`]);
    if (!amounts) return null;
    recipes.push({ ...identity, sourceStepsChecksum: source.fingerprint,
      cookingAmounts: Object.fromEntries(family.ingredients.map(ingredient => [ingredient.sourceIngredientId, {
        amount: amounts[ingredient.sourceIngredientId] ?? 0,
        unit: ingredient.unit, canonicalId: ingredient.canonicalIngredientId,
      }])),
    });
  }
  return recipes;
}
