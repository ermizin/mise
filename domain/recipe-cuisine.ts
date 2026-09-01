import recipeCuisinesJson from "../data/recipe-cuisines.json";

/* Кухня карточки — редакционное решение, а не вывод из названия.
   Ключевые слова врут: «имбирный» встречается в американской выпечке,
   «запеканка» — в британском pasta bake, halal — это требование к продуктам,
   а «Цезарь» придуман в Тихуане. Поэтому единственный источник правды —
   проверяемый файл `data/recipe-cuisines.json`, в котором у каждой карточки
   есть явная строка с id, названием на момент разметки и кухней. */

export const cuisineOrder = [
  "russian",
  "georgian",
  "asian",
  "indian",
  "mexican",
  "italian",
  "mediterranean",
  "american",
  "european",
  "international",
] as const;

export type Cuisine = (typeof cuisineOrder)[number];

export const cuisineLabels: Record<Cuisine, string> = {
  russian: "Русская",
  georgian: "Грузинская",
  asian: "Азиатская",
  indian: "Индийская",
  mexican: "Мексиканская",
  italian: "Итальянская",
  mediterranean: "Средиземноморская",
  american: "Американская",
  european: "Европейская",
  international: "Без выраженной кухни",
};

export type CuisineAssignment = {
  id: string;
  title: string;
  origin: "runtime" | "legacy" | "generated";
  cuisine: Cuisine;
  note?: string;
};

export type CuisineMarkup = {
  schemaVersion: number;
  basis: string;
  reviewedOn: string;
  cuisines: Cuisine[];
  assignments: CuisineAssignment[];
};

export const recipeCuisineMarkup = recipeCuisinesJson as CuisineMarkup;

export const recipeCuisineAssignments: CuisineAssignment[] =
  recipeCuisineMarkup.assignments;

const cuisineById = new Map<string, Cuisine>(
  recipeCuisineAssignments.map((assignment) => [assignment.id, assignment.cuisine]),
);

const cuisineSet = new Set<string>(cuisineOrder);

export function isCuisine(value: unknown): value is Cuisine {
  return typeof value === "string" && cuisineSet.has(value);
}

/* Строгий поиск без подстраховок: неизвестный id — это дыра в разметке,
   и её должен ловить тест, а не молчаливый дефолт «international». */
export function lookupRecipeCuisine(id: string): Cuisine | null {
  return cuisineById.get(id) ?? null;
}

export function recipeCuisine(id: string): Cuisine {
  const cuisine = cuisineById.get(id);
  if (!cuisine)
    throw new Error(
      `Рецепт ${id} не размечен по кухне в data/recipe-cuisines.json`,
    );
  return cuisine;
}

export function markedRecipeIds(): string[] {
  return recipeCuisineAssignments.map((assignment) => assignment.id);
}

/* Фильтр представления. `null` — фильтр не выбран, показываем всё. */
export function matchesCuisine(
  value: Cuisine | undefined,
  filter: Cuisine | null,
): boolean {
  if (!filter) return true;
  return value === filter;
}

export function filterByCuisine<T extends { cuisine?: Cuisine }>(
  items: T[],
  filter: Cuisine | null,
): T[] {
  if (!filter) return items;
  return items.filter((item) => matchesCuisine(item.cuisine, filter));
}

export function availableCuisines(items: { cuisine?: Cuisine }[]): Cuisine[] {
  const present = new Set(items.map((item) => item.cuisine));
  return cuisineOrder.filter((cuisine) => present.has(cuisine));
}

/* Переход между слотами Визарда. Кухня, которой в новом слоте нет, оставила бы
   пользователя перед пустым списком с невидимой причиной — такой фильтр
   сбрасывается. Кухня, которая в новом слоте есть, переносится. */
export function carryCuisineFilter(
  current: Cuisine | null,
  nextAvailable: Cuisine[],
): Cuisine | null {
  if (!current) return null;
  return nextAvailable.includes(current) ? current : null;
}
