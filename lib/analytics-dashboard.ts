import type { AnalyticsEventRow, AnalyticsEventName } from "./analytics";

export const DAY = 86_400_000;
export const wizardSteps = ["Период", "Приёмы пищи", "Направление меню", "Люди и цели", "Ритм готовки", "Выбор меню", "Проверка"];
export const eventLabels: Record<AnalyticsEventName, string> = {
  first_open: "Первое открытие", app_open: "Открытие приложения", wizard_step_viewed: "Шаг мастера",
  onboarding_completed: "Онбординг завершён", plan_create_started: "Создание начато", plan_created: "План сохранён",
  blocking_error: "Блокирующая ошибка", shopping_opened: "Покупки открыты", shopping_item_checked: "Товар отмечен",
  recipe_opened: "Карточка открыта", recipe_tab_switched: "Раздел карточки", cooking_instructions_opened: "Инструкция открыта",
  cooking_confirmed: "Готовка подтверждена", reminders_enabled: "Напоминания включены",
  saved_plan_reopened: "Сохранённый план открыт", next_plan_created: "Следующий план создан",
};
export const errorLabels: Record<string, string> = {
  plan_load: "Загрузка плана", plan_save: "Сохранение плана", shopping_save: "Сохранение покупок", reminder_enable: "Включение напоминаний",
};
export type DashboardOptions = { start: number; end: number; actorKind: "all" | "sites" | "device"; excludeOwner: boolean };
export type FirstSeen = { actorId: string; actorKind: string; firstSeenAt: number };
const dateKey = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayStart = (time: number) => Math.floor(time / DAY) * DAY;
const uniqueActors = (rows: AnalyticsEventRow[]) => new Set(rows.map((r) => r.actorId)).size;
const percent = (n: number, d: number) => d ? Math.round(n / d * 1000) / 10 : null;

export function parseDashboardOptions(params: URLSearchParams, now = Date.now()): DashboardOptions {
  const days = Number(params.get("days") ?? "30");
  if (![7, 30, 90].includes(days)) throw new Error("Выберите период 7, 30 или 90 дней.");
  const parseDate = (value: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Укажите даты в формате ГГГГ-ММ-ДД.");
    const time = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(time) || dateKey(time) !== value) throw new Error("Некорректная дата.");
    return time;
  };
  const custom = params.has("from") || params.has("to");
  const start = custom ? parseDate(params.get("from")) : dayStart(now) - (days - 1) * DAY;
  const requestedEnd = custom ? parseDate(params.get("to")) + DAY : now;
  const end = Math.min(requestedEnd, now);
  if (start >= end || requestedEnd - start > 90 * DAY) throw new Error("Нужен прошедший период длительностью до 90 дней.");
  const actorKind = params.get("identity") ?? "all";
  if (!["all", "sites", "device"].includes(actorKind)) throw new Error("Неизвестный тип участника.");
  const owner = params.get("excludeOwner") ?? "1";
  if (!["0", "1"].includes(owner)) throw new Error("Некорректный фильтр владельца.");
  return { start, end, actorKind: actorKind as DashboardOptions["actorKind"], excludeOwner: owner === "1" };
}

export function buildAnalyticsDashboard(
  inputRows: AnalyticsEventRow[], firstSeen: FirstSeen[], options: DashboardOptions,
  now = Date.now(), ownerActorId = "",
) {
  const seenEvents = new Set<string>();
  const rows = inputRows.filter((r) => {
    if (seenEvents.has(r.eventId)) return false;
    seenEvents.add(r.eventId);
    return (!options.excludeOwner || r.actorId !== ownerActorId) &&
      (options.actorKind === "all" || r.actorKind === options.actorKind) && r.recordedAt < now;
  }).sort((a, b) => a.recordedAt - b.recordedAt || a.eventId.localeCompare(b.eventId));
  const firsts = firstSeen.filter((r) => (!options.excludeOwner || r.actorId !== ownerActorId) &&
    (options.actorKind === "all" || r.actorKind === options.actorKind));
  const firstByActor = new Map(firsts.map((r) => [r.actorId, r.firstSeenAt]));
  const previousStart = options.start - (options.end - options.start);
  const inWindow = (start: number, end: number) => rows.filter((r) => r.recordedAt >= start && r.recordedAt < end);
  const current = inWindow(options.start, options.end);
  const previous = inWindow(previousStart, options.start);
  const byEvent = (rs: AnalyticsEventRow[], name: AnalyticsEventName) => rs.filter((r) => r.eventName === name);
  const flowKey = (r: AnalyticsEventRow) => `${r.actorId}:${r.flowId}`;
  const planRows = (rs: AnalyticsEventRow[]) => [...new Map(byEvent(rs, "plan_created").map((r) => [r.flowId ? flowKey(r) : r.eventId, r])).values()];
  const metrics = (rs: AnalyticsEventRow[], start: number, end: number) => {
    const active = new Set(rs.map((r) => r.actorId));
    const plans = planRows(rs);
    const durations = plans.flatMap((r) => r.durationMs === undefined ? [] : [r.durationMs]).sort((a, b) => a - b);
    const median = durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2 : null;
    const errors = byEvent(rs, "blocking_error");
    return {
      active: active.size, newActors: [...active].filter((id) => { const first = firstByActor.get(id); return first !== undefined && first >= start && first < end; }).length,
      plans: plans.length, creators: uniqueActors(plans), cooks: uniqueActors(byEvent(rs, "cooking_confirmed")),
      repeatPlanners: uniqueActors(byEvent(rs, "next_plan_created")), errors: errors.length,
      errorActors: uniqueActors(errors), errorRate: percent(uniqueActors(errors), active.size),
      opens: byEvent(rs, "app_open").length, medianPlanMs: median,
      p90PlanMs: durations.length ? durations[Math.ceil(durations.length * .9) - 1] : null,
    };
  };
  const daily = [];
  for (let day = dayStart(options.start); day < options.end; day += DAY) {
    const events = current.filter((r) => r.recordedAt >= day && r.recordedAt < day + DAY);
    daily.push({ date: dateKey(day), active: uniqueActors(events), plans: planRows(events).length, cooks: uniqueActors(byEvent(events, "cooking_confirmed")), errors: byEvent(events, "blocking_error").length });
  }
  const funnelEvents: AnalyticsEventName[] = ["plan_create_started", "plan_created", "shopping_item_checked", "cooking_confirmed", "next_plan_created"];
  const funnelLabels = ["Начали план", "Сохранили план", "Отметили покупку", "Подтвердили готовку", "Создали следующий план"];
  const progresses = new Map<string, number>();
  for (const row of current) {
    const stage = progresses.get(row.actorId) ?? 0;
    if (row.eventName === funnelEvents[stage]) progresses.set(row.actorId, stage + 1);
  }
  const funnel = funnelEvents.map((eventName, i) => {
    const count = [...progresses.values()].filter((stage) => stage > i).length;
    const previousCount = i ? [...progresses.values()].filter((stage) => stage >= i).length : count;
    return { eventName, label: funnelLabels[i], count, conversion: percent(count, previousCount), lost: previousCount - count };
  });
  const instrumentedFlows = new Map<string, { steps: Set<number>; started: number; saved: boolean }>();
  for (const row of current) {
    if (row.eventName !== "wizard_step_viewed" || !row.flowId || row.step === undefined) continue;
    const key = flowKey(row);
    const flow = instrumentedFlows.get(key) ?? { steps: new Set<number>(), started: row.recordedAt, saved: false };
    flow.steps.add(row.step); instrumentedFlows.set(key, flow);
  }
  for (const row of current) if (row.eventName === "plan_created" && row.flowId) {
    const flow = instrumentedFlows.get(flowKey(row)); if (flow) flow.saved = true;
  }
  const savedByNow = new Set(rows.filter((r) => r.eventName === "plan_created" && r.flowId).map(flowKey));
  const flows = [...instrumentedFlows.entries()].map(([key, flow]) => ({ ...flow, completedByNow: savedByNow.has(key) }));
  const wizard = wizardSteps.map((label, step) => ({ label, count: flows.filter((f) => f.steps.has(step)).length,
    stalled: flows.filter((f) => !f.completedByNow && Math.max(...f.steps) === step && f.started <= now - DAY).length }));
  const activeDays = new Map<string, Set<number>>();
  for (const row of rows) {
    const days = activeDays.get(row.actorId) ?? new Set<number>();
    days.add(dayStart(row.recordedAt)); activeDays.set(row.actorId, days);
  }
  const newCohort = firsts.filter((r) => r.firstSeenAt >= options.start && r.firstSeenAt < options.end);
  const retentionFor = (cohort: FirstSeen[], day: number) => {
    const eligible = cohort.filter((r) => dayStart(r.firstSeenAt) + (day + 1) * DAY <= now);
    const returned = eligible.filter((r) => activeDays.get(r.actorId)?.has(dayStart(r.firstSeenAt) + day * DAY)).length;
    return { day, eligible: eligible.length, returned, rate: percent(returned, eligible.length) };
  };
  const cohortWeeks = new Map<string, FirstSeen[]>();
  for (const row of newCohort) {
    const monday = dayStart(row.firstSeenAt) - ((new Date(row.firstSeenAt).getUTCDay() + 6) % 7) * DAY;
    const key = dateKey(monday); const cohort = cohortWeeks.get(key) ?? []; cohort.push(row); cohortWeeks.set(key, cohort);
  }
  const cohorts = [...cohortWeeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, cohort]) => ({ week, size: cohort.length, retention: [1, 7, 30].map((d) => retentionFor(cohort, d)) }));
  const events = Object.entries(eventLabels).map(([eventName, label]) => {
    const matches = current.filter((r) => r.eventName === eventName);
    return { eventName, label, count: matches.length, actors: uniqueActors(matches) };
  });
  const errors = Object.entries(errorLabels).map(([code, label]) => {
    const matches = current.filter((r) => r.eventName === "blocking_error" && r.errorCode === code);
    return { code, label, count: matches.length, actors: uniqueActors(matches), lastAt: matches.at(-1)?.recordedAt ?? null };
  });
  const recipeEvents = byEvent(current, "recipe_opened");
  const recipes = [...new Set(recipeEvents.flatMap((r) => r.recipeId ? [r.recipeId] : []))].map((id) => {
    const matches = recipeEvents.filter((r) => r.recipeId === id);
    return { id, opens: matches.length, actors: uniqueActors(matches) };
  }).sort((a, b) => b.actors - a.actors || b.opens - a.opens || a.id.localeCompare(b.id)).slice(0, 20);
  const coverageStart = rows.find((r) => r.eventName === "app_open" || r.eventName === "wizard_step_viewed" || r.recipeId)?.recordedAt ?? null;
  return {
    generatedAt: now, options, previousStart, metrics: metrics(current, options.start, options.end),
    previous: metrics(previous, previousStart, options.start), daily, funnel, wizard,
    wizardFlows: flows.length, wizardSaved: flows.filter((f) => f.saved).length,
    retention: [1, 7, 30].map((d) => retentionFor(newCohort, d)), cohorts, events, errors, recipes,
    recipeOpensWithoutId: recipeEvents.filter((r) => !r.recipeId).length,
    coverageStart, lastEventAt: current.at(-1)?.recordedAt ?? null,
    recent: current.slice(-40).reverse().map((r) => ({ eventId: r.eventId, label: eventLabels[r.eventName] ?? r.eventName,
      participant: `Участник ${r.actorId.slice(0, 12)}`, kind: r.actorKind, at: r.recordedAt,
      detail: r.errorCode ? errorLabels[r.errorCode] : r.step !== undefined ? wizardSteps[r.step] : null })),
  };
}
export type AnalyticsDashboard = ReturnType<typeof buildAnalyticsDashboard>;

export function dashboardCsv(report: AnalyticsDashboard) {
  const rows: (string | number)[][] = [["section", "metric", "value", "participants_or_denominator"]];
  for (const [metric, value] of Object.entries(report.metrics)) rows.push(["current", metric, value ?? "", ""]);
  for (const [metric, value] of Object.entries(report.previous)) rows.push(["previous", metric, value ?? "", ""]);
  for (const day of report.daily) for (const metric of ["active", "plans", "cooks", "errors"] as const) rows.push(["daily", `${day.date}:${metric}`, day[metric], ""]);
  for (const row of report.funnel) rows.push(["funnel", row.label, row.count, report.funnel[0].count]);
  for (const row of report.events) rows.push(["event", row.label, row.count, row.actors]);
  for (const row of report.retention) rows.push(["retention", `D${row.day}`, row.returned, row.eligible]);
  for (const row of report.cohorts) for (const point of row.retention) rows.push(["cohort", `${row.week}:D${point.day}`, point.returned, point.eligible]);
  for (const row of report.recipes) rows.push(["recipe", row.id, row.opens, row.actors]);
  for (const row of report.wizard) rows.push(["wizard", row.label, row.count, report.wizardFlows], ["wizard_stalled", row.label, row.stalled, report.wizardFlows]);
  rows.push(["period", "from_utc", new Date(report.options.start).toISOString(), ""], ["period", "to_exclusive_utc", new Date(report.options.end).toISOString(), ""],
    ["filter", "identity", report.options.actorKind, ""], ["filter", "exclude_owner", Number(report.options.excludeOwner), ""]);
  return rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
}
