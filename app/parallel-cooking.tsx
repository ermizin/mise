"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compileCookingSession, cookingOperationManifest, cookingRequirements } from "../domain/cooking/compile";
import { applyCookingEvent, initialCookingExecution, replanCookingSession } from "../domain/cooking/replan";
import { scheduleCookingSession } from "../domain/cooking/schedule";
import { cookingSourceSignature } from "../domain/cooking/source";
import type { CookingEvent, CookingOperation, CookingSessionInput, ResourceKind } from "../domain/cooking/types";
import { createCookingSessionClient, type CookingClientSnapshot, type CookingEnvelope } from "../lib/cooking-session-client";
import { cookingPlanSnapshotSignature } from "../lib/cooking-session-context";

export type ParallelCookingDish = CookingSessionInput["recipes"][number] & {
  title: string;
  ingredientNames: Record<string, string>;
  products: string[];
};
type Props = {
  plan: unknown; planId: string; batchId: string; clientId: string;
  dishes: ParallelCookingDish[]; equipment?: string[];
  onClose: () => void; fallback: ReactNode; portioning: ReactNode;
};
type Setup = { input: CookingSessionInput; signature: string; planSnapshotSignature: string };
const labels: Record<ResourceKind, string> = { cook: "Человек у плиты", burner: "Конфорки", pot: "Кастрюли", pan: "Сковороды", oven: "Духовка", tray: "Противни и формы", board: "Доски", knife: "Ножи", sink: "Мойка", blender: "Блендер", microwave: "Микроволновка" };
const equipmentFor: Partial<Record<ResourceKind, string>> = { burner: "stove", pot: "pot", pan: "pan", oven: "oven", tray: "baking_dish", blender: "blender", microwave: "microwave" };
const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
const clock = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const amount = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const unit = (value: string) => value === "g" ? "г" : value === "ml" ? "мл" : value === "piece" ? "шт." : value;

export function ParallelCookingView(props: Props) {
  const key = `mise-cooking-v2:${props.planId}:${props.batchId}`;
  const setupKey = `${key}:setup`;
  const planSnapshotSignature = cookingPlanSnapshotSignature(props.plan, props.batchId, props.dishes);
  const manifests = props.dishes.map(dish => cookingOperationManifest(dish.recipeId, dish.methodId));
  const supported = props.dishes.length > 0 && manifests.every(Boolean);
  const kinds = [...new Set(manifests.flatMap(manifest => manifest?.operations.flatMap(operation => operation.resources.map(resource => resource.kind)) ?? []))].filter(kind => kind !== "cook");
  const [counts, setCounts] = useState<Partial<Record<ResourceKind, number>>>({});
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [pace, setPace] = useState<CookingSessionInput["pace"]>("comfortable");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [ordinary, setOrdinary] = useState(false);
  const [portioning, setPortioning] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requirements = cookingRequirements({ recipes: props.dishes });
  function count(kind: ResourceKind) {
    return counts[kind] ?? (props.equipment && equipmentFor[kind] && !props.equipment.includes(equipmentFor[kind]!) ? 0 : 1);
  }
  const resources: CookingSessionInput["kitchen"]["resources"] = [{ id: "cook", kind: "cook" }, ...kinds.flatMap(kind => Array.from({ length: count(kind) }, (_, index) => {
    const id = `${kind}-${index + 1}`;
    return { id, kind, capacities: Object.fromEntries(["g", "ml"].filter(unit => capacities[`${id}:${unit}`]).map(unit => [unit, Number(capacities[`${id}:${unit}`])])) };
  }))];
  const capacityKinds = new Set(requirements.map(item => item.resourceId.split("-")[0]));

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const local = localStorage.getItem(setupKey);
        if (local) {
          const saved = JSON.parse(local) as Setup;
          if (!saved || typeof saved.signature !== "string" || typeof saved.planSnapshotSignature !== "string" || !saved.input) throw new Error("invalid_setup");
          const restored = compileCookingSession(saved.input);
          if (restored.diagnostics.length || await cookingSourceSignature(saved.input) !== saved.signature) throw new Error("invalid_setup");
          if (saved.planSnapshotSignature !== planSnapshotSignature) {
            setMessage("Меню изменилось после начала готовки. Сохранённая сессия требует проверки; новые действия не запускаются.");
          }
          if (!cancelled) setSetup(saved);
        } else {
          const response = await fetch(`/api/cooking-session?planId=${encodeURIComponent(props.planId)}&batchId=${encodeURIComponent(props.batchId)}`, { headers: { "X-Mise-Client": props.clientId } });
          if (response.ok) {
            const stored = await response.json() as { session: CookingEnvelope | null; signature?: string; planSnapshotSignature?: string };
            if (stored.session && stored.signature) {
              const restoredSetup = { input: stored.session.input, signature: stored.signature, planSnapshotSignature: stored.planSnapshotSignature ?? "unknown-source" };
              localStorage.setItem(setupKey, JSON.stringify(restoredSetup));
              if (!cancelled) setSetup(restoredSetup);
            }
          }
        }
      } catch { if (!cancelled) setMessage("Не удалось восстановить готовку. Проверьте подключение; сохранённый прогресс остаётся на устройстве."); }
      finally { if (!cancelled) setLoaded(true); }
    }
    void restore();
    return () => { cancelled = true; };
  }, [setupKey, props.planId, props.batchId, props.clientId, props.plan, planSnapshotSignature]);

  async function start() {
    setBusy(true); setMessage("");
    try {
      const input: CookingSessionInput = { sessionId: crypto.randomUUID(), planId: props.planId, recipes: props.dishes.map(({ dishKey, recipeId, methodId, personIds, cookingAmounts, sourceStepsChecksum }) => ({ dishKey, recipeId, methodId, personIds, cookingAmounts, sourceStepsChecksum })), kitchen: { resources }, durationOverrides: Object.fromEntries(Object.entries(durations).map(([key, value]) => [key, Number(value) * 60])), pace };
      const compiled = compileCookingSession(input);
      const schedule = scheduleCookingSession(compiled);
      if (compiled.operations.length > 300) { setMessage("Слишком много отдельных заходов. Увеличьте подтверждённую загрузку посуды или сократите эту партию в меню."); return; }
      if (compiled.diagnostics.length || schedule.diagnostics.some(item => item.code !== "optimized_schedule_unavailable")) {
        setMessage([...compiled.diagnostics, ...schedule.diagnostics].map(item => item.message).join(" ")); return;
      }
      const next = { input, signature: await cookingSourceSignature(input), planSnapshotSignature };
      localStorage.setItem(setupKey, JSON.stringify(next));
      setSetup(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить готовку."); }
    finally { setBusy(false); }
  }
  if (ordinary) return <>{props.fallback}</>;
  if (portioning) return <>{props.portioning}</>;
  if (setup) return <CookingRun key={setup.signature} {...props} setup={setup} storageKey={key}
    sourceChanged={setup.planSnapshotSignature !== planSnapshotSignature} onPortioning={() => setPortioning(true)} />;
  if (!supported) return loaded ? <>{props.fallback}</> : <main className="app-shell cooking-batch-shell"><header className="cooking-batch-header glass-1"><button onClick={props.onClose}>Закрыть</button><b>Готовка по шагам</b></header><div className="cooking-batch-content"><p role="status">Восстанавливаю готовку…</p></div></main>;
  return <main className="app-shell cooking-batch-shell"><header className="cooking-batch-header glass-1"><button onClick={props.onClose}>Закрыть</button><b>План готовки</b></header>
    <div className="cooking-batch-content">
      <section className="glass-card"><h1>Подтвердите кухню</h1><p>Один человек готовит, пока другие блюда могут находиться на нагреве. Укажите доступную сейчас утварь.</p>
        {kinds.map(kind => <label key={kind} className="field"><span>{labels[kind]}</span><select value={count(kind)} onChange={event => setCounts(value => ({ ...value, [kind]: Number(event.target.value) }))}>
          {[0, 1, 2, 3, 4].filter(n => !["oven", "sink", "blender", "microwave"].includes(kind) || n <= 1).map(n => <option key={n} value={n}>{n}</option>)}
        </select></label>)}
      </section>
      <section className="glass-card"><h2>Сколько помещается за один заход</h2><p>Укажите загрузку продуктами, при которой они помещаются и готовятся как в рецепте. Если вся партия не поместится, план добавит заходы.</p>
        {requirements.map((item, index) => <p key={`${item.dishKey}:${index}`}>{props.dishes.find(dish => dish.dishKey === item.dishKey)?.title}: {item.ingredientIds.map(id => props.dishes.find(dish => dish.dishKey === item.dishKey)?.ingredientNames[id] ?? id).join(", ")} — всего {amount(item.intendedLoad)} {unit(item.capacityUnit)}.</p>)}
        {resources.filter(resource => capacityKinds.has(resource.kind)).flatMap(resource => [...new Set(requirements.filter(item => item.resourceId.split("-")[0] === resource.kind).map(item => item.capacityUnit))].map(loadUnit => <label className="field" key={`${resource.id}:${loadUnit}`}><span>{labels[resource.kind]} · {resource.id.split("-").at(-1)}: допустимая загрузка этих продуктов, {unit(loadUnit)}</span><input type="number" inputMode="decimal" min="1" value={capacities[`${resource.id}:${loadUnit}`] ?? ""} onChange={event => setCapacities(value => ({ ...value, [`${resource.id}:${loadUnit}`]: event.target.value }))} /></label>))}
      </section>
      {manifests.flatMap((manifest, index) => manifest?.operations.filter(operation => operation.unknownDuration).map(operation => <label className="field glass-card" key={`${props.dishes[index].dishKey}:${operation.key}`}><span>{props.dishes[index].title} · {operation.title}: время по упаковке или вашему опыту, мин</span><input type="number" min="1" max="1440" inputMode="numeric" value={durations[`${props.dishes[index].dishKey}:${operation.key}`] ?? ""} onChange={event => setDurations(value => ({ ...value, [`${props.dishes[index].dishKey}:${operation.key}`]: event.target.value }))} /></label>) ?? [])}
      <section className="glass-card"><h2>Темп</h2><label className="field"><span>Как вам удобнее готовить</span><select value={pace} onChange={event => setPace(event.target.value as CookingSessionInput["pace"])}><option value="comfortable">Спокойно</option><option value="speed">Быстрее</option></select></label><p>Время активных действий приблизительное. Проверка готовности всегда остаётся за вами.</p></section>
      {message && <p role="alert">{message}</p>}
      <button className="primary-button" disabled={!loaded || busy} onClick={() => void start()}>{busy ? "Собираю план…" : "Составить план готовки"}</button>
      <button className="text-button" onClick={() => setOrdinary(true)}>Обычная пошаговая готовка</button>
    </div>
  </main>;
}

function CookingRun(props: Props & { setup: Setup; storageKey: string; sourceChanged: boolean; onPortioning: () => void }) {
  const { setup } = props;
  const client = useMemo(() => createCookingSessionClient({ fetch: (...args) => fetch(...args), storage: localStorage, clientId: () => props.clientId, now: Date.now,
    key: props.storageKey, planId: props.planId, batchId: props.batchId, signature: setup.signature, planSnapshotSignature: setup.planSnapshotSignature }), [props.clientId, props.storageKey, props.planId, props.batchId, setup]);
  const [snapshot, setSnapshot] = useState<CookingClientSnapshot>(() => client.restore());
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState("");
  const [showAll, setShowAll] = useState(false);
  const expiryEvents = useRef(new Set<string>());
  useEffect(() => {
    const unsubscribe = client.subscribe(setSnapshot);
    let cancelled = false;
    async function init() {
      try {
        if (!client.snapshot().session && !client.snapshot().requiresUserAction) {
          const compiled = compileCookingSession(setup.input), schedule = scheduleCookingSession(compiled);
          if (schedule.diagnostics.some(item => item.code !== "optimized_schedule_unavailable")) throw new Error(schedule.diagnostics[0].message);
          await client.create({ input: setup.input, compiled, schedule, execution: initialCookingExecution(compiled) }, { operationIds: compiled.operations.map(operation => operation.id), recipeIds: [...new Set(setup.input.recipes.map(recipe => recipe.recipeId))] });
        }
        await client.refresh();
        await client.sync();
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Синхронизация отложена."); }
    }
    void init();
    const online = () => { void client.sync(); };
    window.addEventListener("online", online);
    const timer = window.setInterval(() => { setNow(Date.now()); void client.sync(); }, 1000);
    return () => { cancelled = true; unsubscribe(); window.clearInterval(timer); window.removeEventListener("online", online); };
  }, [client, setup]);
  const session = snapshot.session;
  const execution = session?.execution;
  const operations = useMemo(() => session?.compiled.operations ?? [], [session]);
  const schedule = session && execution ? replanCookingSession(session.compiled, execution, now) : null;
  const status = useMemo(() => execution?.statusByOperation ?? {}, [execution]);
  const active = operations.filter(operation => status[operation.id] === "active" || status[operation.id] === "needs_check");
  const blocked = Boolean(props.sourceChanged || snapshot.requiresUserAction);
  function dispatch(type: CookingEvent["type"], operation?: CookingOperation, extra?: Partial<CookingEvent>) {
    if (blocked) return;
    try {
      const at = Date.now();
      client.enqueue({ id: crypto.randomUUID(), type, occurredAt: at, ...(operation ? { opId: operation.id } : {}),
        ...(type === "started" && operation ? { endsAt: at + operation.durationSeconds * 1000 } : {}), ...extra });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Действие не сохранено."); }
  }
  useEffect(() => {
    if (!execution || blocked) return;
    for (const operation of operations) {
      const end = execution.endsAtByOperation?.[operation.id];
      if (!operation.requiresCheckAtEnd || status[operation.id] !== "active" || !end || end > now) continue;
      const key = `${operation.id}:${end}`;
      if (expiryEvents.current.has(key)) continue;
      expiryEvents.current.add(key);
      try { client.enqueue({ id: crypto.randomUUID(), type: "needs_check", opId: operation.id, occurredAt: now }); }
      catch { expiryEvents.current.delete(key); }
    }
  }, [client, execution, status, operations, now, blocked]);
  const ready = operations.filter(operation => status[operation.id] === "pending" && operation.dependsOn.every(id => status[id] === "completed"))
    .filter(operation => !session || applyCookingEvent(session.compiled, session.execution, { id: "preview", type: "started", opId: operation.id, occurredAt: now, endsAt: now + operation.durationSeconds * 1000 }).diagnostics.length === 0)
    .sort((a, b) => (schedule?.entries.find(entry => entry.opId === a.id)?.startAt ?? Infinity) - (schedule?.entries.find(entry => entry.opId === b.id)?.startAt ?? Infinity));
  const current = active.find(operation => status[operation.id] === "needs_check") ?? active.find(operation => operation.attention === "required") ?? ready[0];
  const initialSchedule = useMemo(() => session ? scheduleCookingSession(session.compiled) : null, [session]);
  const displayedPlan = [...operations].sort((a, b) => (initialSchedule?.entries.find(entry => entry.opId === a.id)?.startAt ?? Infinity) - (initialSchedule?.entries.find(entry => entry.opId === b.id)?.startAt ?? Infinity));
  const completedCount = operations.filter(operation => status[operation.id] === "completed").length;
  const complete = operations.length > 0 && completedCount === operations.length;
  const suspended = operations.filter(operation => status[operation.id] === "blocked");
  const background = active.filter(operation => operation !== current);
  const nextIntervention = schedule?.entries.filter(entry => entry.startAt >= now && operations.find(operation => operation.id === entry.opId)?.kind === "intervention").sort((a, b) => a.startAt - b.startAt)[0];
  function details(operation: CookingOperation) {
    return <>
      {status[operation.id] === "active" && operation.kind === "prep" && !operation.rawMeat && <button className="text-button" onClick={() => dispatch("suspended", operation)}>Отложить подготовку для проверки блюда</button>}
      {operation.allocations.length > 0 && <ul>{operation.allocations.map((allocation, index) => {
        const dish = props.dishes.find(item => item.dishKey === allocation.dishKey);
        return <li key={`${allocation.dishKey}:${allocation.ingredientId}:${index}`}>{dish?.ingredientNames[allocation.ingredientId] ?? allocation.canonicalId}: {amount(allocation.amount)} {unit(allocation.unit)} · {dish?.title}</li>;
      })}</ul>}
      <details><summary>Полная инструкция и все продукты</summary><p style={{ whiteSpace: "pre-line" }}>{operation.sourceText}</p>{props.dishes.filter(dish => dish.dishKey === operation.dishKey || operation.allocations.some(allocation => allocation.dishKey === dish.dishKey)).map(dish => <div key={dish.dishKey}><b>{dish.title}</b><ul>{dish.products.map((product, index) => <li key={`${dish.dishKey}:${index}`}>{product}</li>)}</ul></div>)}</details>
    </>;
  }
  return <main className="app-shell cooking-batch-shell"><header className="cooking-batch-header glass-1"><button onClick={props.onClose}>Закрыть</button><div><b>Готовим</b>{session && <small>Выполнено {completedCount} из {operations.length} действий</small>}</div><button onClick={() => setShowAll(value => !value)}>{showAll ? "Текущее действие" : "Весь план"}</button>{session && <div className="cooking-batch-progress" role="progressbar" aria-label="Выполненные действия" aria-valuemin={0} aria-valuemax={operations.length} aria-valuenow={completedCount}><i style={{ width: `${completedCount / Math.max(1, operations.length) * 100}%` }} /></div>}</header><div className="cooking-batch-content">
    {blocked && <section className="glass-card" role="alert"><p>План или прогресс изменился. Таймеры сохранены. Проверьте активные блюда перед продолжением.</p>{props.sourceChanged ? <p>Восстановите в меню исходные блюда, порции и способ приготовления этой партии, чтобы продолжить сохранённую готовку.</p> : <><p>Можно загрузить сохранённый на сервере прогресс. Несинхронизированные действия этого устройства будут заменены.</p><button className="text-button" onClick={() => { void client.resolveFromServer().catch(() => setMessage("Не удалось связаться с сервером. Прогресс на устройстве сохранён.")); }}>Загрузить актуальный прогресс</button></>}</section>}
    {initialSchedule?.usedFallback && <p role="status">Для этой кухни выбран проверенный последовательный план. Оценка экономии времени не применяется.</p>}
    {snapshot.pending.length > 0 && <p role="status">На устройстве сохранено. Ожидают синхронизации: {snapshot.pending.length}.</p>}
    {message && <p role="alert">{message}</p>}
    {!session && <p role="status">Восстанавливаю готовку…</p>}
    {session && !complete && <section className="glass-card cooking-now-card"><p className="cooking-card-kicker">Сейчас</p><h1>{current ? current.title : execution?.pausedAt ? "Пауза между действиями" : "Пока блюда готовятся"}</h1>
      {current && <>
        <p>{props.dishes.find(dish => dish.dishKey === current.dishKey)?.title}</p>{details(current)}
        {status[current.id] === "pending" ? <button className="primary-button" disabled={blocked} onClick={() => dispatch("started", current)}>{current.kind === "heat" ? "Нагрев начался — запустить таймер" : "Начать действие"}</button> : <>
          <p role={status[current.id] === "needs_check" ? "alert" : "status"}>{status[current.id] === "needs_check" ? `Проверка нужна сейчас. Время вышло ${minutes(Math.max(0, now - (execution!.endsAtByOperation?.[current.id] ?? now)) / 1000)} мин назад.` : !current.requiresCheckAtEnd ? "Время действия оценочное. Подтвердите, когда закончите." : `До проверки ${minutes(Math.max(0, (execution!.endsAtByOperation?.[current.id] ?? now) - now) / 1000)} мин`}</p>
          <button className="primary-button" disabled={blocked || Boolean(current.requiresCheckAtEnd && status[current.id] !== "needs_check")} onClick={() => dispatch("completed", current)}>{current.kind === "heat" ? "Перейти к следующему действию" : "Действие выполнено"}</button>
          {status[current.id] === "needs_check" && <button className="text-button" disabled={blocked} onClick={() => dispatch("extended", current, { endsAt: Date.now() + 120_000 })}>Ещё 2 минуты</button>}
        </>}
      </>}
      {nextIntervention && <p>Следующее вмешательство около {clock(nextIntervention.startAt)}: {operations.find(operation => operation.id === nextIntervention.opId)?.title}</p>}
    </section>}
    {background.length > 0 && <section className="glass-card"><h2>Сейчас готовится</h2>{background.map(operation => <p key={operation.id}><b>{operation.title}</b> · {status[operation.id] === "needs_check" ? "нужна проверка" : `проверка в ${clock(execution!.endsAtByOperation?.[operation.id] ?? now)}`}{operation.kind === "prep" && !operation.rawMeat && <button className="text-button" onClick={() => dispatch("suspended", operation)}>Отложить подготовку</button>}</p>)}</section>}
    {suspended.length > 0 && <section className="glass-card"><h2>Подготовка отложена</h2>{suspended.map(operation => <p key={operation.id}>{operation.title}<button className="text-button" disabled={blocked || Boolean(execution?.pausedAt)} onClick={() => dispatch("continued", operation)}>Продолжить с места остановки</button></p>)}</section>}
    {complete && <section className="glass-card"><h1>Осталось сохранить раскладку</h1><p>Взвесьте готовые компоненты. Mise рассчитает контейнеры каждого человека.</p><button className="primary-button" onClick={props.onPortioning}>Перейти к весам и контейнерам</button></section>}
    {session && !complete && <><button className="text-button" disabled={blocked} onClick={() => dispatch(execution?.pausedAt ? "resumed" : "paused")}>{execution?.pausedAt ? "Продолжить новые действия" : "Пауза между действиями"}</button>{execution?.pausedAt && <p role="status">Нагрев и таймеры продолжаются. Проверяйте уже поставленные блюда.</p>}</>}
    {showAll && <section className="glass-card"><h2>Весь план</h2><p>Оценка до начала: {minutes(session ? scheduleCookingSession(session.compiled).optimizedMakespan : 0)} мин; те же действия по одному — {minutes(session ? scheduleCookingSession(session.compiled).baselineMakespan : 0)} мин. Фактическое время зависит от проверок готовности.</p><ol>{displayedPlan.map(operation => <li key={operation.id}><b>{operation.title}</b> · {status[operation.id] === "completed" ? "готово" : status[operation.id] === "pending" ? "впереди" : "в работе"}{details(operation)}</li>)}</ol></section>}
  </div></main>;
}
