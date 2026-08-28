/* Mise · русская плюрализация.
   Куда класть: lib/plural.ts

   Заменяет тернарники в page.tsx. Места, где сейчас неверно:
   — быстрый выбор периода: «3 дней / 5 дней»
   — шкала готовки (page.tsx:949): «2 дней / 3 дней»
   — «Неделя»: «3 блюд»
   — «12 вариантов» при 2–4
   — сводка: «3 рецептов · 21 порций»
*/

type PluralForms = readonly [one: string, few: string, many: string];

/** plural(1, ['день','дня','дней']) → 'день' */
export function plural(n: number, forms: PluralForms): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** withPlural(3, ['день','дня','дней']) → '3 дня' */
export function withPlural(n: number, forms: PluralForms): string {
  return `${n} ${plural(n, forms)}`;
}

export const FORMS = {
  day: ["день", "дня", "дней"],
  dish: ["блюдо", "блюда", "блюд"],
  portion: ["порция", "порции", "порций"],
  recipe: ["рецепт", "рецепта", "рецептов"],
  option: ["вариант", "варианта", "вариантов"],
  person: ["человек", "человека", "человек"],
  meal: ["приём", "приёма", "приёмов"],
  container: ["контейнер", "контейнера", "контейнеров"],
  item: ["позиция", "позиции", "позиций"],
  hour: ["час", "часа", "часов"],
  minute: ["минута", "минуты", "минут"],
  batch: ["партия", "партии", "партий"],
  gram: ["грамм", "грамма", "граммов"],
} as const satisfies Record<string, PluralForms>;

/* Проверка на приёмке — 1, 2, 5, 11, 21:
   withPlural(1,  FORMS.day) → '1 день'
   withPlural(2,  FORMS.day) → '2 дня'
   withPlural(5,  FORMS.day) → '5 дней'
   withPlural(11, FORMS.day) → '11 дней'
   withPlural(21, FORMS.day) → '21 день'
*/
