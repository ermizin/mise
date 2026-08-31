/* Mise · ActionBar — панель действий, COMPONENTS.md §18.

   L1: r26, padding 9, внутри Button primary r18 — концентричность 26 − 9 ≈ 17–18.
   Панель не уезжает под контент: она flex:none внизу колонки экрана,
   нижний отступ держит env(safe-area-inset-bottom).

   Точки прогресса — часть панели в макетах 8a и 8b, поэтому живут здесь,
   а не отдельным блоком над ней. */

import type { ReactNode } from "react";

export function ActionBar({
  step,
  steps,
  children,
}: {
  /** Индекс текущего экрана. Без него панель рисуется без точек. */
  step?: number;
  steps?: number;
  children: ReactNode;
}) {
  const dots = typeof step === "number" && typeof steps === "number";
  return (
    <div className="action-bar-slot">
      <div className="action-bar glass-1">
        {dots && (
          <div
            className="action-dots"
            role="img"
            aria-label={`Шаг ${step + 1} из ${steps}`}
          >
            {Array.from({ length: steps }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={index === step ? "is-current" : ""}
              />
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
