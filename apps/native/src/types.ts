import type { ChildActivity, ChildNutritionInput, Macros, MealSlot, NutritionWizardInput, Sex } from '@mise/domain/nutrition';
import type { MobileBootstrap, MobileKitchenEquipment } from '@mise/domain/mobile';
export type { ChildActivity, ChildNutritionInput, Macros, MealSlot, NutritionWizardInput, Sex };
export type MenuStyle = 'simple' | 'protein' | 'budget';
export type Ingredient = { id?: string; name: string; amount: number; unit: string };
export type Recipe = { id: string; title: string; mealSlots: MealSlot[]; ingredients: Ingredient[]; allergens: string[]; spicy?: boolean; storageDays?: number; canFreeze?: boolean; instructions?: string[]; imageUrl?: string; photoOrigin?: MobileBootstrap['recipes'][number]['photo']['origin']; kcal?: number; menuTags: string[]; costTier?: number; storage?: MobileBootstrap['recipes'][number]['storage']; effort?: MobileBootstrap['recipes'][number]['effort']; packing?: MobileBootstrap['recipes'][number]['packing']; equipmentOptions: MobileBootstrap['recipes'][number]['equipmentOptions'] };
/** No `kind`: an adult. A child keeps only sex, age and activity, never an adult estimate. */
export type Person = { id: string; name: string; daily: Macros; includedSlots: MealSlot[]; dislikes: string[]; hardExclusions: string[]; estimate?: NutritionWizardInput; nutritionTargetMode: 'auto' | 'manual'; kind?: 'adult' | 'child'; childEstimate?: Partial<ChildNutritionInput> };
export type Batch = { id: string; index: number; start: string; end: string; days: number };
export type ShoppingItem = { id: string; key: string; name: string; group: string; unit: string; quantity: number; checked: boolean; batchIds: string[] };
export type CookingSession = { key: string; recipeId: string; personIds: string[]; portions: { personId: string; target: Macros; actual: Macros; amounts: Record<string, number>; viable: boolean }[]; amounts: Record<string, number>; frozenDays: number };
export type Plan = { id: string; createdAt: string; start: string; end: string; periodDays: number; cookEveryDays: number; menuStyle: MenuStyle; kitchenEquipment: MobileKitchenEquipment[]; mealSlots: MealSlot[]; people: Person[]; batches: Batch[]; selections: Record<string, string>; selectionAssignments?: Record<string, { recipeId: string; personIds: string[] }[]>; cooking?: CookingSession[]; shopping: ShoppingItem[]; cookedBatchIds?: string[]; cookedWeights?: Record<string, { total: number }>; mealExecution?: { eaten: string[] } };
export type Draft = { periodDays: number; mealSlots: MealSlot[]; menuStyle: MenuStyle; kitchenEquipment: MobileKitchenEquipment[]; people: Person[]; cookEveryDays: number; start: string };
export type Bootstrap = { recipes: Recipe[]; raw: MobileBootstrap };
