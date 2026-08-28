/* Mise · Note — тонированный блок L4.
   Один компонент вместо четырнадцати частных классов (COMPONENTS.md §9).

   Тон несёт смысл, а не настроение:
     warn  — предупреждение, ошибка, требуемое действие
     mint  — хранение, заморозка, успех, подтверждённый расчёт
     lilac — ТОЛЬКО онбординг и инструктаж

   Один тонированный блок на экран. Значения тонов — в globals.css
   (.tint-warn / .tint-mint / .tint-lilac), раскладка — в .note. */

import type { ReactNode } from "react";

export type NoteTone = "warn" | "mint" | "lilac";

export function Note({
  tone = "warn",
  icon,
  label,
  action,
  className,
  role,
  children,
}: {
  tone?: NoteTone;
  icon?: ReactNode;
  label?: ReactNode;
  /* Одно действие справа — «Начать заново», «Вернуть». Не кнопка-акцент. */
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
  children?: ReactNode;
}) {
  return (
    <div
      className={["note", `tint-${tone}`, className].filter(Boolean).join(" ")}
      role={role}
    >
      {icon ? <span className="note-icon">{icon}</span> : null}
      <p className="note-body">
        {label ? <b className="note-label">{label}</b> : null}
        {children ? <small className="note-text">{children}</small> : null}
      </p>
      {action ? <span className="note-action">{action}</span> : null}
    </div>
  );
}
