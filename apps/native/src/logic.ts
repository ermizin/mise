import { calculateNutritionTarget, macrosForCalories } from '@mise/domain/nutrition';
import type { Batch, Draft, Ingredient, MealSlot, Person, Plan, Recipe } from './types';
import type { MobileKitchenEquipment } from '@mise/domain/mobile';

export const SLOT_LABELS: Record<MealSlot, string> = { breakfast: 'Завтрак', snack1: 'Перекус 1', lunch: 'Обед', snack2: 'Перекус 2', dinner: 'Ужин' };
export const SLOTS: MealSlot[] = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'];
export const KITCHEN_EQUIPMENT: { id: MobileKitchenEquipment; label: string }[] = [
  { id: 'multicooker', label: 'Мультиварка' }, { id: 'air_fryer', label: 'Аэрогриль' },
  { id: 'stove', label: 'Плита' }, { id: 'pot', label: 'Кастрюля' }, { id: 'pan', label: 'Сковорода' },
  { id: 'oven', label: 'Духовка' }, { id: 'baking_dish', label: 'Форма или противень' },
  { id: 'blender', label: 'Блендер / измельчитель' }, { id: 'microwave', label: 'Микроволновка' },
  { id: 'waffle_iron', label: 'Вафельница' }, { id: 'pressure_cooker', label: 'Скороварка' },
];
export const DEFAULT_KITCHEN_EQUIPMENT: MobileKitchenEquipment[] = ['stove', 'pot', 'pan', 'oven', 'baking_dish'];
export const ALLERGEN_OPTIONS = [
  { id: 'milk', label: 'Молоко и молочные продукты' }, { id: 'egg', label: 'Яйца' }, { id: 'gluten', label: 'Глютен' },
  { id: 'fish', label: 'Рыба' }, { id: 'crustaceans', label: 'Ракообразные' }, { id: 'soy', label: 'Соя' },
  { id: 'peanut', label: 'Арахис' }, { id: 'treeNuts', label: 'Орехи' }, { id: 'sesame', label: 'Кунжут' },
  { id: 'mustard', label: 'Горчица' }, { id: 'molluscs', label: 'Моллюски' },
] as const;
export const DISLIKE_OPTIONS = [
  { id: 'fish', label: 'Рыба' }, { id: 'cottage', label: 'Творог' }, { id: 'egg', label: 'Яйца' },
  { id: 'tofu', label: 'Тофу' }, { id: 'broccoli', label: 'Брокколи' }, { id: 'buckwheat', label: 'Гречка' },
  { id: 'legumes', label: 'Бобовые' }, { id: 'avocado', label: 'Авокадо' }, { id: 'coconut', label: 'Кокос' },
  { id: 'turkey', label: 'Индейка' },
] as const;
export function localDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function plusDays(iso: string, days: number): string { const [year, month, day] = iso.split('-').map(Number); return localDate(new Date(year, month - 1, day + days, 12)); }
export function initialDraft(personId: string): Draft {
  const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
  return { periodDays: 7, mealSlots: slots, menuStyle: 'protein', kitchenEquipment: [...DEFAULT_KITCHEN_EQUIPMENT], start: localDate(), cookEveryDays: 3,
    people: [{ id: personId, name: 'Я', daily: macrosForCalories(2000, 'balanced'), includedSlots: slots, dislikes: [], hardExclusions: [], nutritionTargetMode: 'manual' }] };
}
export function validateDraft(draft: Draft): string | null {
  if (!Number.isInteger(draft.periodDays) || draft.periodDays < 1 || draft.periodDays > 14) return 'Выберите период от 1 до 14 дней.';
  if (!draft.mealSlots.length) return 'Выберите хотя бы один приём пищи.';
  if (draft.people.length < 1 || draft.people.length > 4) return 'Добавьте от 1 до 4 человек.';
  if (!Number.isInteger(draft.cookEveryDays) || draft.cookEveryDays < 1 || draft.cookEveryDays > draft.periodDays) return 'Укажите ритм готовки в пределах периода.';
  if (!Array.isArray(draft.kitchenEquipment) || new Set(draft.kitchenEquipment).size !== draft.kitchenEquipment.length || draft.kitchenEquipment.some(item => !KITCHEN_EQUIPMENT.some(option => option.id === item))) return 'Проверьте выбранную кухонную технику.';
  for (const person of draft.people) {
    if (!person.name.trim()) return 'Укажите имя каждого человека.';
    if (!person.includedSlots.length) return `Выберите приёмы пищи для ${person.name}.`;
    if (person.nutritionTargetMode === 'auto' && person.estimate) {
      const calculated = calculateNutritionTarget(person.estimate);
      if (!('target' in calculated)) return `Проверьте параметры расчёта для ${person.name}.`;
    }
    const { kcal, protein, fat, carbs } = person.daily;
    if (kcal < 1200 || kcal > 5000 || Math.abs(protein * 4 + fat * 9 + carbs * 4 - kcal) > 5) return `Проверьте КБЖУ для ${person.name}.`;
  }
  return null;
}
export function buildBatches(start: string, periodDays: number, cookEveryDays: number): Batch[] {
  const batches: Batch[] = [];
  for (let offset = 0; offset < periodDays; offset += cookEveryDays) {
    const days = Math.min(cookEveryDays, periodDays - offset);
    batches.push({ id: `batch-${offset}`, index: batches.length, start: plusDays(start, offset), end: plusDays(start, offset + days - 1), days });
  }
  return batches;
}
function normalizedName(value: string) { return value.trim().toLocaleLowerCase('ru'); }
export function recipeAllowed(recipe: Recipe, people: Person[]): boolean {
  const haystack = [recipe.title, ...recipe.ingredients.map(item => item.name), ...recipe.allergens].join(' ').toLocaleLowerCase('ru');
  return people.every(person => person.hardExclusions.every(term => !haystack.includes(normalizedName(term))));
}
export function candidatesFor(recipes: Recipe[], slot: MealSlot, people: Person[], batchDays: number): Recipe[] {
  return recipes.filter(recipe => recipe.mealSlots.includes(slot) && recipeAllowed(recipe, people) && (recipe.storageDays === undefined || recipe.storageDays >= batchDays || recipe.canFreeze));
}
export function mergeServerPlan(local: Plan | null, remote: Plan | null, hasPending: boolean): Plan | null { return hasPending ? local : remote ?? local; }
export function parseIngredient(value: unknown): Ingredient | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === 'string' ? item.name : typeof item.label === 'string' ? item.label : '';
  const amount = Number(item.amount ?? item.quantity ?? 0);
  const unit = typeof item.unit === 'string' ? item.unit : 'г';
  return name && Number.isFinite(amount) && amount > 0 ? { id: typeof item.id === 'string' ? item.id : undefined, name, amount, unit } : null;
}
