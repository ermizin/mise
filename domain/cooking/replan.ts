import type { CompiledSession, CookingEvent, CookingExecutionState, CookingOperation, CookingSchedule, ReplanResult, ScheduleEntry } from "./types";
import { scheduleCookingSession } from "./schedule";

type Interval = { start: number; end: number };
type Lease = { dish: string; releaseAfterOpId: string };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const dish = (op: CookingOperation) => op.dishKey ?? op.recipeId;
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const checkFor = (session: CompiledSession, heat: CookingOperation) => session.operations.find((op) => op.kind === "intervention" && op.dependsOn.includes(heat.id));

export function initialCookingExecution(session: CompiledSession): CookingExecutionState {
  return { revision: 0, statusByOperation: Object.fromEntries(session.operations.map((op) => [op.id, "pending"])), events: [], startedAtByOperation: {}, endsAtByOperation: {} };
}
function sameEvent(a: CookingEvent, b: CookingEvent) { return a.type === b.type && a.opId === b.opId && a.occurredAt === b.occurredAt && a.endsAt === b.endsAt; }
function deadline(op: CookingOperation) { return op.checkDeadlineSeconds ?? 0; }
function ends(execution: CookingExecutionState, id: string) { return execution.endsAtByOperation?.[id]; }
function starts(execution: CookingExecutionState, id: string) { return execution.startedAtByOperation?.[id]; }
function markDue(session: CompiledSession, status: Record<string, CookingExecutionState["statusByOperation"][string]>, execution: CookingExecutionState, now: number) {
  for (const op of session.operations) if (status[op.id] === "active" && op.requiresCheckAtEnd && finite(ends(execution, op.id)) && ends(execution, op.id)! <= now) status[op.id] = "needs_check";
}
function add(calendar: Map<string, Interval[]>, resourceId: string, interval: Interval) { calendar.set(resourceId, [...(calendar.get(resourceId) ?? []), interval]); }
function earliest(op: CookingOperation, at: number, calendar: Map<string, Interval[]>, leases: Map<string, Lease>, owner: string) {
  if (op.resources.some((use) => leases.get(use.resourceId)?.dish !== undefined && leases.get(use.resourceId)!.dish !== owner)) return undefined;
  let start = at;
  for (let tries = 0; tries < 10000; tries++) {
    let next = start; const interval = { start, end: start + op.durationSeconds * 1000 };
    for (const use of op.resources) for (const busy of calendar.get(use.resourceId) ?? []) if (overlaps(interval, busy)) next = Math.max(next, busy.end);
    if (next === start) return start; start = next;
  }
  return undefined;
}
function plannedHeatCheck(session: CompiledSession, op: CookingOperation, start: number, actualEnd?: number) {
  if (!op.requiresCheckAtEnd || op.attention !== "background") return undefined;
  const check = checkFor(session, op); if (!check) return undefined;
  const end = actualEnd ?? start + op.durationSeconds * 1000;
  return { op: check, startAt: end, endAt: end + check.durationSeconds * 1000 };
}

/** Rebuilds only pending work. Recorded starts/ends are fixed physical facts, never offsets. */
export function replanCookingSession(session: CompiledSession, execution: CookingExecutionState, now: number): CookingSchedule {
  const base = scheduleCookingSession(session);
  if (!finite(now)) return { ...base, entries: [], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: true, diagnostics: [...base.diagnostics, { code: "invalid_replan_anchor", message: "Время перепланирования некорректно." }] };
  const status = { ...execution.statusByOperation }; markDue(session, status, execution, now);
  const completed = new Set(session.operations.filter((op) => status[op.id] === "completed").map((op) => op.id));
  const pending = new Map(session.operations.filter((op) => status[op.id] === "pending").map((op) => [op.id, op]));
  const entries = new Map<string, ScheduleEntry>(), calendar = new Map<string, Interval[]>(), leases = new Map<string, Lease>();
  for (const op of session.operations) if (status[op.id] === "active" || status[op.id] === "needs_check") {
    const startAt = starts(execution, op.id), endAt = ends(execution, op.id);
    if (!finite(startAt) || !finite(endAt) || startAt < 0 || endAt < startAt) return { ...base, entries: [], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: true, diagnostics: [...base.diagnostics, { code: "invalid_active_anchor", message: "Для начатой операции нет корректного времени." }] };
    const entry = { opId: op.id, startAt, endAt }; entries.set(op.id, entry);
    for (const use of op.resources) add(calendar, use.resourceId, { start: entry.startAt, end: entry.endAt <= now ? Infinity : entry.endAt });
    const check = status[op.id] === "active" ? plannedHeatCheck(session, op, startAt, endAt) : undefined;
    if (check) for (const use of check.op.resources) add(calendar, use.resourceId, { start: check.startAt, end: check.endAt });
  }
  for (const holder of session.operations) for (const hold of holder.resourceHolds ?? []) if (status[holder.id] !== "pending" && !completed.has(hold.releaseAfterOpId)) leases.set(hold.resourceId, { dish: dish(holder), releaseAfterOpId: hold.releaseAfterOpId });
  while (pending.size) {
    const ready = [...pending.values()].filter((op) => op.dependsOn.every((id) => completed.has(id) || entries.has(id))).map((op) => {
      const dependencies = op.dependsOn.map((id) => entries.get(id)?.endAt ?? now);
      return { op, start: earliest(op, Math.max(now, ...dependencies), calendar, leases, dish(op)) };
    }).filter((candidate): candidate is { op: CookingOperation; start: number } => candidate.start !== undefined);
    if (!ready.length) break;
    ready.sort((a, b) => Number(b.op.attention === "background") - Number(a.op.attention === "background") || a.start - b.start || a.op.id.localeCompare(b.op.id));
    const chosen = ready[0], entry = { opId: chosen.op.id, startAt: chosen.start, endAt: chosen.start + chosen.op.durationSeconds * 1000 };
    entries.set(chosen.op.id, entry); pending.delete(chosen.op.id); completed.add(chosen.op.id);
    for (const use of chosen.op.resources) add(calendar, use.resourceId, { start: entry.startAt, end: entry.endAt });
    for (const hold of chosen.op.resourceHolds ?? []) leases.set(hold.resourceId, { dish: dish(chosen.op), releaseAfterOpId: hold.releaseAfterOpId });
    for (const [resourceId, lease] of [...leases]) if (lease.releaseAfterOpId === chosen.op.id) leases.delete(resourceId);
    const check = plannedHeatCheck(session, chosen.op, chosen.start);
    if (check && pending.has(check.op.id) && check.op.dependsOn.every((id) => id === chosen.op.id || completed.has(id))) {
      entries.set(check.op.id, { opId: check.op.id, startAt: check.startAt, endAt: check.endAt }); pending.delete(check.op.id); completed.add(check.op.id);
      for (const use of check.op.resources) add(calendar, use.resourceId, { start: check.startAt, end: check.endAt });
      for (const [resourceId, lease] of [...leases]) if (lease.releaseAfterOpId === check.op.id) leases.delete(resourceId);
    }
  }
  const result = [...entries.values()].sort((a, b) => a.startAt - b.startAt || a.opId.localeCompare(b.opId));
  const incomplete = pending.size > 0;
  const diagnostics = incomplete ? [...base.diagnostics, { code: "replan_incomplete", message: "Оставшиеся действия нельзя безопасно разместить без освобождения ресурса." }] : base.diagnostics;
  const span = Math.max(0, ...result.map((entry) => entry.endAt));
  return { mode: incomplete ? "sequential" : "optimized", entries: result, baselineMakespan: span, optimizedMakespan: span, usedFallback: incomplete, diagnostics };
}

function startEnd(op: CookingOperation, event: CookingEvent) {
  const end = event.endsAt ?? event.occurredAt + op.durationSeconds * 1000;
  return finite(event.occurredAt) && finite(end) && event.occurredAt >= 0 && end >= event.occurredAt + op.durationSeconds * 1000 && end - event.occurredAt <= 24 * 3600_000 ? end : undefined;
}
function startConflicts(session: CompiledSession, execution: CookingExecutionState, op: CookingOperation, startAt: number, endAt: number) {
  const interval = { start: startAt, end: endAt }, status = execution.statusByOperation;
  for (const active of session.operations) if ((status[active.id] === "active" || status[active.id] === "needs_check") && active.id !== op.id) {
    const activeStart = starts(execution, active.id), activeEnd = ends(execution, active.id);
    if (finite(activeStart) && finite(activeEnd) && active.resources.some((use) => op.resources.some((candidate) => candidate.resourceId === use.resourceId)) && overlaps(interval, { start: activeStart, end: activeEnd <= startAt ? Infinity : activeEnd })) return true;
    const check = status[active.id] === "active" && finite(activeStart) ? plannedHeatCheck(session, active, activeStart, activeEnd) : undefined;
    if (check && check.op.resources.some((use) => op.resources.some((candidate) => candidate.resourceId === use.resourceId)) && overlaps(interval, { start: check.startAt, end: check.endAt })) return true;
  }
  for (const holder of session.operations) for (const hold of holder.resourceHolds ?? []) if (hold.resourceId && op.resources.some((use) => use.resourceId === hold.resourceId) && status[holder.id] !== "pending" && status[hold.releaseAfterOpId] !== "completed" && dish(holder) !== dish(op)) return true;
  return false;
}

export function applyCookingEvent(session: CompiledSession, execution: CookingExecutionState, event: CookingEvent, now = event.occurredAt): ReplanResult {
  const duplicate = execution.events.find((old) => old.id === event.id);
  if (duplicate) return sameEvent(duplicate, event) ? { execution, schedule: replanCookingSession(session, execution, now), diagnostics: [] } : { execution, schedule: replanCookingSession(session, execution, now), diagnostics: [{ code: "event_id_conflict", message: "Идентификатор события уже использован для другого действия." }] };
  const status = { ...execution.statusByOperation }, diagnostics: ReplanResult["diagnostics"] = [], op = event.opId ? session.operations.find((item) => item.id === event.opId) : undefined;
  if (!finite(now) || !finite(event.occurredAt)) diagnostics.push({ code: "invalid_event_time", message: "Время события некорректно." });
  markDue(session, status, execution, now);
  if (event.opId && !op) diagnostics.push({ code: "unknown_operation", message: "Операция не входит в сессию." });
  else if (op && !op.dependsOn.every((id) => status[id] === "completed")) diagnostics.push({ code: "dependency_incomplete", message: "Сначала завершите обязательные предыдущие действия." });
  else if (event.type === "started" && op && status[op.id] === "pending") {
    const end = startEnd(op, event);
    if (!end) diagnostics.push({ code: "invalid_start_duration", message: "Укажите конечное время в допустимых границах длительности." });
    else if (execution.pausedAt && op.kind !== "intervention") diagnostics.push({ code: "session_paused", message: "Пауза не разрешает начинать новое действие." });
    else if (startConflicts(session, { ...execution, statusByOperation: status }, op, event.occurredAt, end)) diagnostics.push({ code: "resource_conflict", message: "Этот ресурс уже занят или зарезервирован для обязательной проверки." });
    else { status[op.id] = "active"; const next: CookingExecutionState = { revision: execution.revision + 1, statusByOperation: status, events: [...execution.events, event], startedAtByOperation: { ...execution.startedAtByOperation, [op.id]: event.occurredAt }, endsAtByOperation: { ...execution.endsAtByOperation, [op.id]: end }, ...(execution.pausedAt ? { pausedAt: execution.pausedAt } : {}) }; return { execution: next, schedule: replanCookingSession(session, next, now), diagnostics: [] }; }
  } else if (event.type === "completed" && op && (status[op.id] === "active" || status[op.id] === "needs_check") && (!op.requiresCheckAtEnd || status[op.id] === "needs_check")) status[op.id] = "completed";
  else if (event.type === "needs_check" && op && (status[op.id] === "active" || status[op.id] === "needs_check")) status[op.id] = "needs_check";
  else if (event.type === "extended" && op && status[op.id] === "needs_check" && finite(event.endsAt) && event.endsAt > now && event.endsAt - now <= 24 * 3600_000) status[op.id] = "active";
  else if (event.type === "paused" || event.type === "resumed") { /* handled below */ }
  else diagnostics.push({ code: "invalid_transition", message: "Этот переход состояния сейчас недопустим." });
  if (diagnostics.length) return { execution, schedule: replanCookingSession(session, execution, now), diagnostics };
  const next: CookingExecutionState = { revision: execution.revision + 1, statusByOperation: status, events: [...execution.events, event], startedAtByOperation: execution.startedAtByOperation, endsAtByOperation: event.type === "extended" && op ? { ...execution.endsAtByOperation, [op.id]: event.endsAt! } : execution.endsAtByOperation, ...(event.type === "paused" ? { pausedAt: event.occurredAt } : event.type === "resumed" ? {} : execution.pausedAt ? { pausedAt: execution.pausedAt } : {}) };
  return { execution: next, schedule: replanCookingSession(session, next, now), diagnostics: [] };
}
