"use client";
import { useMemo, useState } from "react";
import { buildCookingOrder, buildParallelSchedule, kitchenResources, validCookingWindow, type CookingWindow, type ParallelDish } from "../domain/parallel-cooking";
import type { KitchenProfile } from "../domain/kitchen";
import { genitiveAfterNumber } from "../lib/plural";
import { buildMergedCookingPlan, type StepCookingDish } from "../domain/step-cooking";
import schedulingAnnotations from "../data/recipe-step-scheduling.json";
import { Note } from "./ui/note";
export function ParallelCookingPlan({ kitchen, dishes, planStale, stepDishes = [] }: { kitchen: KitchenProfile; dishes: ParallelDish[]; planStale: boolean; stepDishes?: StepCookingDish[] }) {
  const [enabled, setEnabled] = useState(kitchen.parallelCooking);
  const [mergeSteps, setMergeSteps] = useState(false);
  const completeSources = stepDishes.length === dishes.length && dishes.every(dish => stepDishes.some(source => source.id === dish.id && source.methodId === dish.methodId));
  const merged = useMemo(() => mergeSteps ? buildMergedCookingPlan(completeSources ? stepDishes : [], schedulingAnnotations.profiles, kitchenResources(kitchen)) : null, [mergeSteps, stepDishes, kitchen, completeSources]);
  const mergedReady = mergeSteps && merged?.available;
  const hasDeferred = merged?.steps.some(step => step.kind === "deferred") ?? false;
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
      <label aria-label="Объединить шаги рецептов" className="kitchen-parallel-toggle" htmlFor="merge-recipe-steps"><input id="merge-recipe-steps" type="checkbox" checked={mergeSteps} onChange={event => setMergeSteps(event.target.checked)} /><span><b>Объединить шаги рецептов</b><small>Автоматически составить единый список действий</small></span></label>
      {mergeSteps && !mergedReady && <Note tone="warn">{merged?.reason === "resources" ? "Для объединения шагов не хватает указанной техники или посуды." : "Для некоторых блюд или выбранных способов этой партии общий пошаговый план пока недоступен."} Продолжайте по обычным шагам ниже.</Note>}
      {mergedReady && merged && <>
        <h3>Общие шаги готовки</h3>
        <p><b>{hasDeferred ? "Эта часть готовки — около" : "Около"} {merged.totalMinutes} мин</b>{merged.totalMinutes < merged.sequentialMinutes ? ` · по одному около ${merged.sequentialMinutes} мин` : " · без пересечения действий"}</p>
        <p>Один повар; время активных действий приблизительное. Ожидание размечено по инструкциям рецептов. При увеличении партии работа может занять дольше: возвращайтесь к проверке блюда вовремя, даже если другое действие ещё не закончено.</p>
        <p>В шагах с ожиданием сначала выполните подготовку. Отдельные строки показывают, когда можно заняться другим блюдом и когда вернуться. Продукты каждого блюда отмеряйте отдельно.</p>
        <ol className="parallel-timeline merged-step-timeline" aria-label="Общие шаги готовки">{merged.steps.map(step => <li key={step.id}>
          <span className="parallel-time">{step.kind === "deferred" ? "По инструкции" : `${step.start}–${step.end} мин`}</span><div>
            <small>{step.dishTitle} · {step.instructionNumber ? `шаг ${step.instructionNumber}` : "продукты"}</small>
            <b>{step.kind === "deferred" ? "Дальше — в указанное в рецепте время" : step.kind === "wait" ? "Ожидание" : step.kind === "resume" ? "Вернуться и проверить" : step.instructionNumber ? "Начать шаг" : "Отмерить продукты"}</b>
            <p>{step.text}</p>
            {step.kind === "instruction" && step.start !== null && step.end !== null && <small>Ориентир на действия: {step.end - step.start} мин.</small>}
            {step.products.length > 0 && <details><summary>Продукты этого блюда</summary><ul>{step.products.map((product, index) => <li key={index}>{product}</li>)}</ul></details>}
          </div></li>)}</ol>
        {hasDeferred && <p>Строки «По инструкции» продолжают рецепт без назначенных минут: выполните их в исходном порядке и в указанное в тексте время. Долгое охлаждение, хранение и действия перед подачей могут относиться к следующей готовке; они не входят в расчёт выше.</p>}
        <p>Это общий план действий. Он не запускает таймеры и не меняет отметки готовки. Полные исходные инструкции и рассчитанные количества доступны в обычных шагах ниже.</p>
      </>}
      {!mergedReady && <>
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
      </>}
      {!mergedReady && <p>Это порядок переключений между блюдами, а не автоматическое объединение шагов или запущенные таймеры. Кухня зафиксирована на момент открытия готовки; шаги рецептов и их порядок остаются ниже.</p>}
    </>}
  </section>;
}
