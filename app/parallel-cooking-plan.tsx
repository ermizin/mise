"use client";
import { useMemo, useState } from "react";
import { buildCookingOrder, buildParallelSchedule, validCookingWindow, type CookingWindow, type ParallelDish } from "../domain/parallel-cooking";
import type { KitchenProfile } from "../domain/kitchen";
import { genitiveAfterNumber } from "../lib/plural";
import { Note } from "./ui/note";
export function ParallelCookingPlan({ kitchen, dishes, planStale }: { kitchen: KitchenProfile; dishes: ParallelDish[]; planStale: boolean }) {
  const [enabled, setEnabled] = useState(kitchen.parallelCooking);
  const [windows, setWindows] = useState<Record<string, CookingWindow>>({});
  const schedule = useMemo(() => enabled ? buildParallelSchedule(dishes, kitchen, windows) : null, [dishes, kitchen, enabled, windows]);
  const order = schedule ? buildCookingOrder(schedule) : [];
  const eventLabels = { start: "Начните блюдо", wait: "Можно отойти по вашему плану", resume: "Вернитесь к блюду", finish: "Плановое завершение блюда" };
  function change(id: string, field: keyof CookingWindow, number: string) {
    setWindows(current => ({ ...current, [id]: { ...(current[id] ?? { afterMinutes: 1, minutes: 0 }), [field]: number === "" ? 0 : Number(number) } }));
  }
  return <section className="glass-card parallel-plan">
    <label aria-label="Параллельная готовка" htmlFor="batch-parallel" className="kitchen-parallel-toggle"><input id="batch-parallel" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><b>Параллельная готовка</b><small>Необязательный расчёт времени для этой партии</small></span></label>
    {schedule && <>
      {planStale && <Note tone="warn">Набор техники в меню не совпадает с профилем или не был сохранён. Расчёт использует кухню на момент открытия этого экрана и проверяет технику выбранных способов.</Note>}
      <p>Укажите интервалы, когда блюдо действительно можно оставить без внимания. По умолчанию вся готовка требует ваших рук. Эти интервалы действуют только пока открыт этот экран.</p>
      <details><summary>Когда блюда готовятся сами</summary>{dishes.map(dish => {
        if (!Number.isFinite(dish.totalMinutes) || dish.totalMinutes < 1 || dish.totalMinutes > 1440) return <p key={dish.id}>{dish.title}: нет времени для расчёта.</p>;
        const window = windows[dish.id];
        const invalid = window && window.minutes !== 0 && !validCookingWindow(window, Math.ceil(dish.totalMinutes));
        return <fieldset className="parallel-window" key={dish.id}><legend>{dish.title} · около {dish.totalMinutes} мин</legend>
          <label>С какой минуты<input type="number" inputMode="numeric" min={1} max={Math.max(1, Math.ceil(dish.totalMinutes)-2)} value={window?.afterMinutes ?? 1} onChange={event => change(dish.id,"afterMinutes",event.target.value)} /></label>
          <label>На сколько минут<input type="number" inputMode="numeric" min={0} max={Math.max(0,Math.ceil(dish.totalMinutes)-2)} value={window?.minutes ?? 0} onChange={event => change(dish.id,"minutes",event.target.value)} /></label>
          {invalid && <p role="alert">Оставьте время до и после свободного интервала. Сейчас всё блюдо считается требующим внимания.</p>}
        </fieldset>;
      })}</details>
      {schedule.conflicts.length > 0 ? <Note tone="warn">Не хватает данных или свободной утвари для расчёта {schedule.conflicts.length} {genitiveAfterNumber(schedule.conflicts.length, ["блюда", "блюд"])}. Общего расписания нет. Используйте обычные шаги ниже; проверьте технику и способы приготовления.</Note> : <>
        <p><b>Около {schedule.totalMinutes} мин · до {schedule.maxParallelDishes} {genitiveAfterNumber(schedule.maxParallelDishes, ["блюда", "блюд"])} в процессе</b></p>
        {schedule.sequentialMinutes > schedule.totalMinutes && <p>По одному: около {schedule.sequentialMinutes} мин.</p>}
        <p>Ориентир по времени рецептов и вашим интервалам. Один повар; посуда занята до конца блюда. Проверьте, что вся партия помещается: время не масштабируется по весу продуктов.</p>
        <details><summary>Интервалы блюд</summary><ol className="parallel-timeline">{schedule.dishes.map(dish => <li key={dish.id}><span className="parallel-time">{dish.start}–{dish.end} мин</span><div><b>{dish.title}</b><small>{dish.unattended ? `Вы указали: можно отойти с ${dish.start + dish.unattended.afterMinutes} по ${dish.start + dish.unattended.afterMinutes + dish.unattended.minutes} мин` : "Весь интервал требует внимания"}</small></div></li>)}</ol></details>
        <h3>Общий порядок готовки</h3>
        <p>Минуты от начала партии. Завершение — ориентир: проверьте готовность по рецепту перед следующим действием.</p>
        <ol className="parallel-timeline" aria-label="Общий порядок готовки">{order.map(event => <li key={`${event.dishId}:${event.kind}`}><span className="parallel-time">{event.minute} мин</span><div><b>{eventLabels[event.kind]}</b><small>{event.title}</small></div></li>)}</ol>
      </>}
      <p>Это порядок переключений между блюдами, а не автоматическое объединение шагов или запущенные таймеры. Кухня зафиксирована на момент открытия готовки; шаги рецептов и их порядок остаются ниже.</p>
    </>}
  </section>;
}
