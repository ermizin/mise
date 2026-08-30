/* Mise · единый набор иконок.
   Штрих 1.7, currentColor, viewBox 24, никаких эмодзи и типографских глифов.
   Расширяет существующий Icon из app/page.tsx (8 имён → 24) — API тот же,
   так что старые вызовы <Icon name="calendar" /> продолжают работать.

   Правило: эмодзи остаётся ТОЛЬКО как изображение блюда в MediaThumb.
   Везде остальном — эти пиктограммы.

   Куда класть: app/ui/icon.tsx, удалить iconPaths и Icon из page.tsx. */

export type IconName =
  // навигация
  | "calendar"
  | "pot"
  | "basket"
  | "person"
  // действия
  | "plus"
  | "minus"
  | "chevron"
  | "chevron-left"
  | "check"
  | "close"
  | "edit"
  | "repeat"
  | "next-day"
  | "share"
  | "search"
  | "filter"
  // предметная область
  | "clock"
  | "snowflake"
  | "fridge"
  | "container"
  | "flame"
  | "scale"
  | "bell"
  | "label"
  // состояния
  | "warning"
  | "info";

const iconPaths: Record<IconName, string[]> = {
  calendar: [
    "M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z",
    "M4 10h16",
    "M8.5 3v4",
    "M15.5 3v4",
  ],
  pot: [
    "M5 10h14v5.5A3.5 3.5 0 0 1 15.5 19h-7A3.5 3.5 0 0 1 5 15.5z",
    "M3 12h2",
    "M19 12h2",
    "M9.5 3.5c0 1.6 1 1.6 1 3",
    "M14 3.5c0 1.6 1 1.6 1 3",
  ],
  basket: [
    "M4 9h16l-1.4 9.1A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.9z",
    "M8.5 9 12 3.5 15.5 9",
    "M10 13v3",
    "M14 13v3",
  ],
  person: [
    "M12 12.5a4.2 4.2 0 1 0 0-8.5 4.2 4.2 0 0 0 0 8.5z",
    "M4.8 20.5c0-3.5 3.2-5.8 7.2-5.8s7.2 2.3 7.2 5.8",
  ],

  plus: ["M12 5.5v13", "M5.5 12h13"],
  minus: ["M5.5 12h13"],
  chevron: ["m9.5 5.5 6.5 6.5-6.5 6.5"],
  "chevron-left": ["m14.5 5.5-6.5 6.5 6.5 6.5"],
  check: ["m5 12.5 4.6 4.6L19 7.5"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  edit: ["M4.5 19.5h4l10-10-4-4-10 10z", "m14.5 5.5 4 4"],
  repeat: [
    "M4.5 12a7.5 7.5 0 0 1 12.9-5.2",
    "M19.5 12a7.5 7.5 0 0 1-12.9 5.2",
    "m17.4 3.4v3.4h-3.4",
    "m6.6 20.6v-3.4h3.4",
  ],
  "next-day": [
    "M4.5 6.5h10a3 3 0 0 1 3 3v8",
    "m14.5 15 3 3 3-3",
    "M7 3.5v6",
    "M4 6.5h6",
  ],
  share: [
    "M12 15.5v-12",
    "m7.5 8 4.5-4.5L16.5 8",
    "M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
  ],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m16 16 4.5 4.5"],
  filter: ["M4 7h16", "M7 12h10", "M10 17h4"],

  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.2v5.1l3.4 2"],
  snowflake: [
    "m10 20-1.25-2.5L6 18",
    "M10 4 8.75 6.5 6 6",
    "m14 20 1.25-2.5L18 18",
    "m14 4 1.25 2.5L18 6",
    "m17 21-3-6h-4",
    "m17 3-3 6 1.5 3",
    "M2 12h6.5L10 9",
    "m20 10-1.5 2 1.5 2",
    "M22 12h-6.5L14 15",
    "m4 10 1.5 2L4 14",
    "m7 21 3-6-1.5-3",
    "m7 3 3 6h4",
  ],
  fridge: [
    "M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z",
    "M5 10h14",
    "M8 6.5v2",
    "M8 12.5v2.5",
  ],
  container: [
    "M5.5 8.5h13l-.9 9.6a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9z",
    "M4 6.5h16",
    "M9.5 12v4",
    "M14.5 12v4",
  ],
  flame: [
    "M12 20.5c3.3 0 5.5-2.1 5.5-5.1 0-4.2-4-5.6-3.1-11.4-2.9 1.3-5 4.4-5 7.3 0 1.3.4 2.2 1.1 2.9-1.5.2-2.5 1.4-2.5 3 0 2 1.8 3.3 4 3.3z",
  ],
  scale: ["M12 4.5v15", "M5 8.5h14", "M8.5 8.5 5 15.5h7z", "M15.5 8.5 12 15.5h7z"],
  bell: [
    "M12 3.5a5.5 5.5 0 0 1 5.5 5.5c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5A5.5 5.5 0 0 1 12 3.5z",
    "M9.8 17.5a2.3 2.3 0 0 0 4.4 0",
  ],
  label: [
    "M4.5 9.5 9.5 4.5h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-8l-5-5z",
    "M15.5 9.5h.01",
  ],

  warning: ["M12 4.5 21 19.5H3z", "M12 10v4", "M12 16.8h.01"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v6", "M12 7.6h.01"],
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {iconPaths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/* Что чем заменяется — карта для поиска по page.tsx:

   ☀️ 🥗 🌙          → иконка приёма пищи НЕ нужна: слот подписан словом
                       («Завтрак», «Обед», «Ужин») в t-kicker. Убрать совсем.
   🍏 🥛 💪 🌿 🥑     → убрать; в карточке стиля меню текст сам себя объясняет
   ❄️                → "snowflake" (разморозка, заморозка)
   🔔                → "bell"
   ▦ ⌑ ● ◉ ◎ ◒       → навигация: "calendar" / "pot" / "basket" / "person"
   ◷                 → "clock"
   ✦                 → убрать (декор)
   ∑                 → "scale" (итог, сводка)
   ⌕                 → "search"
   ⌘                 → "flame" (сложность / готовка)
   ↗ → ←             → "chevron" / "chevron-left"
   ✓                 → "check"
*/
