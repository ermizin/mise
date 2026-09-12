"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compileCookingSession, cookingOperationManifest, cookingRequirements, cookingSourceDescriptor } from "../domain/cooking/compile";
import { applyCookingEvent, initialCookingExecution, replanCookingSession } from "../domain/cooking/replan";
import { scheduleCookingSession } from "../domain/cooking/schedule";
import { cookingSourceSignature } from "../domain/cooking/source";
import type { CookingEvent, CookingOperation, CookingSessionInput, GuidedActionConfig, ResourceKind } from "../domain/cooking/types";
import { createCookingSessionClient, type CookingClientSnapshot, type CookingEnvelope } from "../lib/cooking-session-client";
import { cookingPlanSnapshotMatches, cookingPlanSnapshotSignature } from "../lib/cooking-session-context";

export type ParallelCookingDish = CookingSessionInput["recipes"][number] & {
  title: string;
  ingredientNames: Record<string, string>;
  products: string[];
  portionCount?: number;
};
type Props = {
  plan: unknown; planId: string; batchId: string; clientId: string;
  dishes: ParallelCookingDish[]; equipment?: string[];
  onClose: () => void; fallback: ReactNode; portioning: ReactNode;
};
type Setup = { input: CookingSessionInput; signature: string; planSnapshotSignature: string };
type CandidateChoice = { resourceIds: string[]; allBatchFits: boolean };
const labels: Record<ResourceKind, string> = { cook: "Человек у плиты", burner: "Конфорки", pot: "Кастрюли", pan: "Сковороды", oven: "Духовка", tray: "Противни и формы", baking_dish: "Формы для запекания", board: "Доски", knife: "Ножи", sink: "Мойка", blender: "Блендер", microwave: "Микроволновка", multicooker: "Мультиварки", air_fryer: "Аэрогрили", waffle_iron: "Вафельницы", pressure_cooker: "Скороварки", fridge: "Холодильник", bowl: "Миски" };
const equipmentFor: Partial<Record<ResourceKind, string>> = { burner: "stove", pot: "pot", pan: "pan", oven: "oven", tray: "baking_dish", baking_dish: "baking_dish", blender: "blender", microwave: "microwave", multicooker: "multicooker", air_fryer: "air_fryer", waffle_iron: "waffle_iron", pressure_cooker: "pressure_cooker" };
const kindForEquipment: Record<string, ResourceKind> = Object.fromEntries(Object.entries(equipmentFor).map(([kind, equipment]) => [equipment, kind])) as Record<string, ResourceKind>;
const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
const clock = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const amount = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const unit = (value: string) => value === "g" ? "г" : value === "ml" ? "мл" : value === "piece" ? "шт." : value;

function portions(count: number) {
  const last = Math.abs(count) % 10, teens = Math.abs(count) % 100;
  return teens >= 11 && teens <= 14 ? "порций" : last === 1 ? "порцию" : last >= 2 && last <= 4 ? "порции" : "порций";
}

function visibleActionTitle(text: string, portionCount?: number) {
  if (!Number.isInteger(portionCount) || portionCount! < 1) return text;
  const count = portionCount as number;
  return text.replace(/на\s+\d+\s+порци[июй]/giu, `на ${count} ${portions(count)}`);
}

function candidateRequiredResourceKinds(category: string, requiredEquipment: readonly string[]) {
  const methodKinds = new Set(requiredEquipment.map(item => kindForEquipment[item]).filter((kind): kind is ResourceKind => Boolean(kind)));
  if (category === "cold_wait") return ["fridge"] as ResourceKind[];
  if (category === "oven") return ["oven", "baking_dish"] as ResourceKind[];
  const containedAppliance = ["multicooker", "pressure_cooker"].find((kind): kind is ResourceKind => methodKinds.has(kind as ResourceKind));
  if (containedAppliance) return [containedAppliance];
  return ["burner", ...(["pot", "pan"] as ResourceKind[]).filter(kind => methodKinds.has(kind))];
}

function candidateSelectableResourceKinds(category: string, requiredEquipment: readonly string[]) {
  const required = candidateRequiredResourceKinds(category, requiredEquipment);
  return category === "cold_wait" ? [...required, "bowl" as ResourceKind] : required;
}

function candidateRisk(category: string) {
  if (category === "cold_wait") return "Холодильник остаётся занят до ручной проверки результата.";
  if (category === "oven") return "Духовка и выбранная форма остаются заняты до ручной проверки результата.";
  return "Выбранная посуда и нагрев остаются заняты до ручной проверки результата.";
}

export function ParallelCookingView(props: Props) {
  const key = `mise-cooking-v2:${props.planId}:${props.batchId}`;
  const setupKey = `${key}:setup`;
  const planSnapshotSignature = cookingPlanSnapshotSignature(props.plan, props.batchId, props.dishes);
  const manifests = props.dishes.map(dish => cookingOperationManifest(dish.recipeId, dish.methodId));
  const descriptors = props.dishes.map(dish => ({ dish, descriptor: cookingSourceDescriptor(dish.recipeId, dish.methodId) }));
  const guided = descriptors.flatMap(item => item.descriptor?.kind === "guided" && item.descriptor.method ? [{ ...item, method: item.descriptor.method }] : []);
  const manualKinds = manifests.flatMap(manifest => manifest?.operations.flatMap(operation => operation.resources.map(resource => resource.kind)) ?? []);
  const guidedKinds = guided.flatMap(({ method }) => [
    ...(method.requiredEquipment ?? []).map(item => kindForEquipment[item]).filter((kind): kind is ResourceKind => Boolean(kind)),
    ...method.actions.flatMap(action => action.backgroundCandidate ? candidateSelectableResourceKinds(action.backgroundCandidate.category, method.requiredEquipment ?? []) : []),
  ]);
  const kinds: ResourceKind[] = [...new Set([...manualKinds, ...guidedKinds])].filter((kind): kind is ResourceKind => kind !== "cook");
  const [counts, setCounts] = useState<Partial<Record<ResourceKind, number>>>({});
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [activeStepMinutes, setActiveStepMinutes] = useState("");
  const [candidateChoices, setCandidateChoices] = useState<Record<string, CandidateChoice>>({});
  const [pace, setPace] = useState<CookingSessionInput["pace"]>("comfortable");
  const [setup, setSetup] = useState<Setup | null>(null);
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
          // A persisted execution owns its already compiled graph. Recompiling
          // it here could reinterpret a recipe after a catalog update.
          if (!cookingPlanSnapshotMatches(saved.planSnapshotSignature, props.plan, props.batchId, props.dishes)) {
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
  }, [setupKey, props.planId, props.batchId, props.clientId, props.plan, props.dishes, planSnapshotSignature]);

  async function start() {
    setBusy(true); setMessage("");
    try {
      const activeStepSeconds = Number(activeStepMinutes) * 60;
      if (guided.length && (!Number.isInteger(activeStepSeconds) || activeStepSeconds < 60 || activeStepSeconds > 3600)) {
        setMessage("Укажите реальную оценку одного активного шага: от 1 до 60 минут."); return;
      }
      const guidedActions: Record<string, GuidedActionConfig> = {};
      for (const { dish, method } of guided) for (const action of method.actions) {
        const key = `${dish.dishKey}:${action.id}`;
        const choice = candidateChoices[key];
        if (!choice) continue;
        const required = candidateRequiredResourceKinds(action.backgroundCandidate?.category ?? "", method.requiredEquipment ?? []);
        const selected = choice.resourceIds.filter(id => resources.some(resource => resource.id === id));
        if (!choice.allBatchFits || !required.every(kind => selected.some(id => resources.find(resource => resource.id === id)?.kind === kind))) {
          setMessage("Для фонового действия подтвердите подходящую посуду, прибор и что в них помещается вся партия."); return;
        }
        if (!action.backgroundCandidate || selected.length === 0) { setMessage("Фоновым может быть только явно отмеченное действие из исходной инструкции."); return; }
        guidedActions[key] = { durationSeconds: action.backgroundCandidate.durationSeconds, resourceIds: selected, allBatchFits: true };
      }
      const input: CookingSessionInput = { sessionId: crypto.randomUUID(), planId: props.planId, recipes: descriptors.map(({ dish, descriptor }) => ({ dishKey: dish.dishKey, recipeId: dish.recipeId, methodId: dish.methodId, personIds: dish.personIds, cookingAmounts: dish.cookingAmounts, sourceStepsChecksum: descriptor?.fingerprint ?? dish.sourceStepsChecksum })), kitchen: { resources }, durationOverrides: Object.fromEntries(Object.entries(durations).map(([key, value]) => [key, Number(value) * 60])), ...(guided.length ? { guidedConfig: { schemaVersion: 1, activeStepSeconds, actions: guidedActions } } : {}), pace };
      const compiled = compileCookingSession(input);
      const schedule = scheduleCookingSession(compiled);
      if (compiled.operations.length > 1000) { setMessage("В этой партии слишком много отдельных действий. Разделите готовку на две партии перед стартом."); return; }
      if (compiled.diagnostics.length || schedule.diagnostics.some(item => item.code !== "optimized_schedule_unavailable")) {
        setMessage([...compiled.diagnostics, ...schedule.diagnostics].map(item => item.message).join(" ")); return;
      }
      const next = { input, signature: await cookingSourceSignature(input), planSnapshotSignature };
      localStorage.setItem(setupKey, JSON.stringify(next));
      setSetup(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить готовку."); }
    finally { setBusy(false); }
  }
  if (portioning) return <>{props.portioning}</>;
  if (setup) return <CookingRun key={setup.signature} {...props} setup={setup} storageKey={key}
    sourceChanged={!cookingPlanSnapshotMatches(setup.planSnapshotSignature, props.plan, props.batchId, props.dishes)} onPortioning={() => setPortioning(true)} />;
  return <main className="app-shell cooking-batch-shell"><header className="cooking-batch-header glass-1"><button onClick={props.onClose}>Закрыть</button><b>План готовки</b></header>
    <div className="cooking-batch-content">
      <section className="glass-card"><h1>Подтвердите кухню</h1><p>Один человек готовит, пока только подтверждённые действия могут идти фоном. Укажите доступную сейчас утварь.</p>
        {kinds.map(kind => <label key={kind} className="field"><span>{labels[kind]}</span><select value={count(kind)} onChange={event => setCounts(value => ({ ...value, [kind]: Number(event.target.value) }))}>
          {[0, 1, 2, 3, 4].filter(n => !["oven", "sink", "blender", "microwave"].includes(kind) || n <= 1).map(n => <option key={n} value={n}>{n}</option>)}
        </select></label>)}
      </section>
      {requirements.length > 0 && <section className="glass-card"><h2>Сколько помещается за один заход</h2><p>Если партия не помещается, здесь можно рассчитать несколько заходов.</p>
        {requirements.map((item, index) => <p key={`${item.dishKey}:${index}`}>{props.dishes.find(dish => dish.dishKey === item.dishKey)?.title}: {item.ingredientIds.map(id => props.dishes.find(dish => dish.dishKey === item.dishKey)?.ingredientNames[id] ?? id).join(", ")} — всего {amount(item.intendedLoad)} {unit(item.capacityUnit)}.</p>)}
        {resources.filter(resource => capacityKinds.has(resource.kind)).flatMap(resource => [...new Set(requirements.filter(item => item.resourceId.split("-")[0] === resource.kind).map(item => item.capacityUnit))].map(loadUnit => <label className="field" key={`${resource.id}:${loadUnit}`}><span>{labels[resource.kind]} · {resource.id.split("-").at(-1)}: допустимая загрузка этих продуктов, {unit(loadUnit)}</span><input type="number" inputMode="decimal" min="1" value={capacities[`${resource.id}:${loadUnit}`] ?? ""} onChange={event => setCapacities(value => ({ ...value, [`${resource.id}:${loadUnit}`]: event.target.value }))} /></label>))}
      </section>}
      {manifests.flatMap((manifest, index) => manifest?.operations.filter(operation => operation.unknownDuration).map(operation => <label className="field glass-card" key={`${props.dishes[index].dishKey}:${operation.key}`}><span>{props.dishes[index].title} · {operation.title}: время по упаковке или вашему опыту, мин</span><input type="number" min="1" max="1440" inputMode="numeric" value={durations[`${props.dishes[index].dishKey}:${operation.key}`] ?? ""} onChange={event => setDurations(value => ({ ...value, [`${props.dishes[index].dishKey}:${operation.key}`]: event.target.value }))} /></label>) ?? [])}
      <section className="glass-card"><h2>Темп</h2><label className="field"><span>Как вам удобнее готовить</span><select value={pace} onChange={event => setPace(event.target.value as CookingSessionInput["pace"])}><option value="comfortable">Спокойно</option><option value="speed">Быстрее</option></select></label><p>Время активных действий приблизительное. Проверка готовности всегда остаётся за вами.</p></section>
      {guided.length > 0 && <><section className="glass-card"><h2>Оценка активного шага</h2><p>Для подробных исходных действий время не добавлено в рецепт. Укажите вашу обычную оценку; это не меняет время нагрева из инструкции.</p><label className="field"><span>Один активный шаг, минут</span><input type="number" min="1" max="60" inputMode="numeric" value={activeStepMinutes} onChange={event => setActiveStepMinutes(event.target.value)} /></label></section>
        {guided.map(({ dish, method, descriptor }) => <section className="glass-card" key={dish.dishKey}><h2>{dish.title}</h2><p>{method.actions.some(action => action.backgroundCandidate) ? "Все действия останутся последовательными, пока вы явно не подтвердите одно из отмеченных ниже." : "В этом способе нет подтверждённых фоновых этапов; действия выполняются вручную."}</p>
          {method.actions.filter(action => action.backgroundCandidate).length > 0 && <details><summary>Можно ли оставить отдельное действие без рук</summary>{method.actions.filter(action => action.backgroundCandidate).map(action => {
            const key = `${dish.dishKey}:${action.id}`, choice = candidateChoices[key], candidate = action.backgroundCandidate!, expectedKinds = candidateSelectableResourceKinds(candidate.category, method.requiredEquipment ?? []), candidates = resources.filter(resource => expectedKinds.includes(resource.kind));
            return <fieldset key={key}><legend>{visibleActionTitle(action.text.trim(), dish.portionCount)}</legend><p>В исходной инструкции: {candidate.durationText}. {candidateRisk(candidate.category)}</p><label><input type="checkbox" checked={Boolean(choice)} onChange={event => setCandidateChoices(value => event.target.checked ? { ...value, [key]: value[key] ?? { resourceIds: [], allBatchFits: false } } : Object.fromEntries(Object.entries(value).filter(([id]) => id !== key)))} /> Можно отойти до проверки</label>
              {choice && <><p>Выберите конкретную посуду и прибор, которые будут заняты:</p>{candidates.length ? candidates.map(resource => <label key={resource.id}><input type="checkbox" checked={choice.resourceIds.includes(resource.id)} onChange={event => setCandidateChoices(value => ({ ...value, [key]: { ...choice, resourceIds: event.target.checked ? [...choice.resourceIds, resource.id] : choice.resourceIds.filter(id => id !== resource.id) } }))} /> {labels[resource.kind]} · {resource.id.split("-").at(-1)}</label>) : <p role="alert">Сначала укажите эту посуду или прибор выше.</p>}<label><input type="checkbox" checked={choice.allBatchFits} onChange={event => setCandidateChoices(value => ({ ...value, [key]: { ...choice, allBatchFits: event.target.checked } }))} /> В выбранную посуду помещается вся эта партия</label></>}
            </fieldset>;
          })}</details>}
          <details><summary>Полный исходный этап</summary><ol>{descriptor!.sourceSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>
        </section>)}</>}

      {message && <p role="alert">{message}</p>}
      <button className="primary-button" disabled={!loaded || busy} onClick={() => void start()}>{busy ? "Собираю план…" : "Составить план готовки"}</button>
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
        // Always accept the stored graph first.  A fresh compiler must never
        // replace an old active timer merely because its source catalog moved.
        const restored = await client.refreshFromServer();
        if (restored.received && !client.snapshot().session && !client.snapshot().requiresUserAction) {
          const compiled = compileCookingSession(setup.input), schedule = scheduleCookingSession(compiled);
          if (schedule.diagnostics.some(item => item.code !== "optimized_schedule_unavailable")) throw new Error(schedule.diagnostics[0].message);
          await client.create({ input: setup.input, compiled, schedule, execution: initialCookingExecution(compiled) });
        }
        if (!restored.received && !client.snapshot().session && !client.snapshot().requiresUserAction && !cancelled)
          setMessage("Не удалось подтвердить новую готовку на сервере. Подключитесь к сети и откройте этот экран ещё раз.");
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
  const isGuidedHeatStart = (operation: CookingOperation) => Boolean(
    setup.input.guidedConfig && operation.kind === "start_heat" && operation.sourceOperationIds?.length &&
    operations.some(candidate => candidate.kind === "heat" && candidate.attention === "background" && candidate.dependsOn.includes(operation.id)),
  );
  function dispatch(type: CookingEvent["type"], operation?: CookingOperation, extra?: Partial<CookingEvent>) {
    if (blocked) return;
    try {
      const at = Date.now();
      client.enqueue({ id: crypto.randomUUID(), type, occurredAt: at, ...(operation ? { opId: operation.id } : {}),
        ...(type === "started" && operation ? { endsAt: at + operation.durationSeconds * 1000 } : {}), ...extra });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Действие не сохранено."); }
  }
  function beginGuidedHeat(operation: CookingOperation) {
    if (blocked) return;
    const heat = operations.find(candidate => candidate.kind === "heat" && candidate.attention === "background" && candidate.dependsOn.includes(operation.id));
    if (!heat) { dispatch("completed", operation); return; }
    const at = Date.now();
    try {
      client.enqueueBatch([
        { id: crypto.randomUUID(), type: "completed", opId: operation.id, occurredAt: at },
        { id: crypto.randomUUID(), type: "started", opId: heat.id, occurredAt: at, endsAt: at + heat.durationSeconds * 1000 },
      ]);
      setMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось запустить таймер.";
      setMessage(/провер|зарезервирован/u.test(message)
        ? "Сначала проверьте блюдо с истёкшим таймером. Этот нагрев ещё не подтверждён."
        : message);
    }
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
        {status[current.id] === "pending" ? <><>{isGuidedHeatStart(current) && <p role="status">Выполните подготовку, поставьте блюдо готовиться и подтвердите начало. Таймер начнётся только после этой постановки, по времени из исходной инструкции.</p>}</><button className="primary-button" disabled={blocked} onClick={() => dispatch("started", current)}>{current.kind === "heat" ? "Нагрев начался — запустить таймер" : isGuidedHeatStart(current) ? "Начать подготовку и постановку" : "Начать действие"}</button></> : <>
          <p role={status[current.id] === "needs_check" ? "alert" : "status"}>{status[current.id] === "needs_check" ? `Проверка нужна сейчас. Время вышло ${minutes(Math.max(0, now - (execution!.endsAtByOperation?.[current.id] ?? now)) / 1000)} мин назад.` : !current.requiresCheckAtEnd ? "Время действия оценочное. Подтвердите, когда закончите." : `До проверки ${minutes(Math.max(0, (execution!.endsAtByOperation?.[current.id] ?? now) - now) / 1000)} мин`}</p>
          {isGuidedHeatStart(current) ? <><p role="status">Поставьте блюдо готовиться и подтвердите начало. Таймер начнётся сейчас по времени из исходной инструкции, а не после ещё одного ожидания.</p><button className="primary-button" disabled={blocked} onClick={() => beginGuidedHeat(current)}>Нагрев начат — запустить таймер</button></> : <button className="primary-button" disabled={blocked || Boolean(current.requiresCheckAtEnd && status[current.id] !== "needs_check")} onClick={() => dispatch("completed", current)}>{current.kind === "heat" ? "Перейти к следующему действию" : "Действие выполнено"}</button>}
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
