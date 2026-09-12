import type { CompiledSession, CookingOperation, CookingSchedule, CompileDiagnostic, ResourceKind } from "./types";

type ResourceHold = { resourceId: string; kind: ResourceKind; releaseAfterOpId: string };
type ExtendedOperation = CookingOperation & { resourceHolds?: readonly ResourceHold[]; checkDeadlineSeconds?: number };
const kinds = new Set<ResourceKind>(["cook", "burner", "pot", "pan", "oven", "tray", "baking_dish", "board", "knife", "sink", "blender", "microwave", "multicooker", "air_fryer", "waffle_iron", "pressure_cooker", "fridge", "bowl"]);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
function add(result: CompileDiagnostic[], code: string, message: string, op?: CookingOperation) { result.push({ code, message, recipeId: op?.recipeId }); }
function holds(op: CookingOperation): readonly ResourceHold[] { return (op as ExtendedOperation).resourceHolds ?? []; }
function downstream(byId: Map<string, CookingOperation>, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(target)) return false;
  seen.add(target);
  return (byId.get(target)?.dependsOn ?? []).some((dependency) => downstream(byId, from, dependency, seen));
}

/** Verifies the complete static operation graph before scheduling it. */
export function validateCookingGraph(session: CompiledSession): CompileDiagnostic[] {
  const result: CompileDiagnostic[] = [], byId = new Map<string, CookingOperation>();
  for (const op of session.operations) {
    if (!op.id || byId.has(op.id)) add(result, "duplicate_operation_id", "У операций должен быть уникальный идентификатор.", op); else byId.set(op.id, op);
    if (!finite(op.durationSeconds) || op.durationSeconds < 0) add(result, "invalid_operation_duration", "Длительность операции должна быть конечным неотрицательным числом.", op);
    if (!Array.isArray(op.dependsOn) || !Array.isArray(op.resources)) add(result, "invalid_operation_shape", "Карта операции имеет неполные зависимости или ресурсы.", op);
    if (!op.resources.length) add(result, "resources_missing", "Каждая операция должна указывать требуемые ресурсы.", op);
    const local = new Set<string>();
    for (const use of op.resources) { if (!use.resourceId || !kinds.has(use.kind) || local.has(use.resourceId)) add(result, "invalid_resource_use", "Ресурс операции указан некорректно или повторён.", op); local.add(use.resourceId); }
    if (op.attention === "required" && !op.resources.some((resource) => resource.kind === "cook")) add(result, "cook_resource_missing", "Активное действие должно занимать одного повара.", op);
    if (op.attention === "background" && op.resources.some((resource) => resource.kind === "cook")) add(result, "background_uses_cook", "Фоновое ожидание не может занимать повара.", op);
  }
  for (const op of session.operations) {
    const dependencies = new Set<string>();
    for (const dependency of op.dependsOn) { if (!byId.has(dependency)) add(result, "missing_dependency", `Не найдена зависимость ${dependency}.`, op); if (dependencies.has(dependency)) add(result, "duplicate_dependency", "Зависимость операции повторена.", op); dependencies.add(dependency); }
  }
  const kitchen = session.input?.kitchen?.resources;
  if (Array.isArray(kitchen)) {
    const supplied = new Map<string, ResourceKind>();
    for (const resource of kitchen) { if (!resource.id || !kinds.has(resource.kind) || supplied.has(resource.id)) add(result, "invalid_kitchen_resource", "Ресурсы кухни должны иметь уникальные корректные идентификаторы."); else supplied.set(resource.id, resource.kind); }
    for (const op of session.operations) for (const use of op.resources) if (supplied.get(use.resourceId) !== use.kind) add(result, "resource_unavailable", `Нет подтверждённого ресурса ${use.resourceId}.`, op);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => { if (visiting.has(id)) { add(result, "dependency_cycle", "В карте операций есть цикл.", byId.get(id)); return; } if (done.has(id) || !byId.has(id)) return; visiting.add(id); for (const dependency of byId.get(id)!.dependsOn) visit(dependency); visiting.delete(id); done.add(id); };
  for (const op of session.operations) visit(op.id);
  for (const op of session.operations) {
    for (const hold of holds(op)) { const release = byId.get(hold.releaseAfterOpId); if (!hold.resourceId || !kinds.has(hold.kind) || !release || !op.resources.some((use) => use.resourceId === hold.resourceId && use.kind === hold.kind) || !downstream(byId, op.id, hold.releaseAfterOpId)) add(result, "invalid_resource_hold", "Аренда ресурса должна ссылаться на последующую операцию освобождения.", op); }
    if (op.requiresCheckAtEnd && op.attention === "background") { const check = session.operations.find((candidate) => candidate.kind === "intervention" && candidate.dependsOn.includes(op.id)); if (!check) add(result, "mandatory_check_missing", "Фоновый нагрев с обязательной проверкой должен иметь зависимую проверку.", op); }
    const deadline = (op as ExtendedOperation).checkDeadlineSeconds;
    if (deadline !== undefined && (!finite(deadline) || deadline < 0)) add(result, "invalid_check_deadline", "Срок обязательной проверки должен быть конечным неотрицательным числом.", op);
  }
  return result;
}

/** Validates a returned timeline independently of the scheduling strategy. */
export function validateCookingSchedule(session: CompiledSession, schedule: CookingSchedule): CompileDiagnostic[] {
  const result = validateCookingGraph(session), byId = new Map(session.operations.map((op) => [op.id, op]),), entries = new Map<string, { startAt: number; endAt: number }>();
  for (const entry of schedule.entries) {
    if (!byId.has(entry.opId)) add(result, "unknown_scheduled_operation", "Расписание содержит неизвестную операцию."); else if (entries.has(entry.opId)) add(result, "duplicate_scheduled_operation", "Расписание содержит операцию дважды.", byId.get(entry.opId)); else entries.set(entry.opId, entry);
    if (!finite(entry.startAt) || !finite(entry.endAt) || entry.startAt < 0 || entry.endAt < entry.startAt) add(result, "invalid_schedule_time", "Время в расписании должно быть конечным и неотрицательным.", byId.get(entry.opId));
  }
  for (const op of session.operations) {
    const entry = entries.get(op.id); if (!entry) { add(result, "missing_operation", "Расписание потеряло обязательную операцию.", op); continue; }
    if (finite(entry.startAt) && finite(entry.endAt) && Math.abs(entry.endAt - entry.startAt - op.durationSeconds) > 0.000001) add(result, "duration_changed", "Расписание не может менять длительность операции.", op);
    for (const dependency of op.dependsOn) if ((entries.get(dependency)?.endAt ?? Infinity) > entry.startAt) add(result, "dependency_order", "Операция назначена раньше зависимости.", op);
  }
  const uses = new Map<string, Array<{ op: CookingOperation; start: number; end: number }>>();
  for (const op of session.operations) { const entry = entries.get(op.id); if (!entry || !finite(entry.startAt) || !finite(entry.endAt)) continue; for (const use of op.resources) uses.set(use.resourceId, [...(uses.get(use.resourceId) ?? []), { op, start: entry.startAt, end: entry.endAt }]); }
  for (const [resourceId, intervals] of uses) for (let index = 0; index < intervals.length; index++) for (let other = index + 1; other < intervals.length; other++) if (overlaps(intervals[index], intervals[other])) add(result, "resource_overlap", `Ресурс ${resourceId} занят одновременно.`, intervals[index].op);
  const leases: Array<{ resourceId: string; op: CookingOperation; start: number; end: number }> = [];
  for (const op of session.operations) { const holder = entries.get(op.id); if (!holder) continue; for (const hold of holds(op)) { const release = entries.get(hold.releaseAfterOpId); if (release) leases.push({ resourceId: hold.resourceId, op, start: holder.startAt, end: release.endAt }); } }
  for (const lease of leases) {
    for (const actual of uses.get(lease.resourceId) ?? []) if (actual.op.id !== lease.op.id && (actual.op.dishKey ?? actual.op.recipeId) !== (lease.op.dishKey ?? lease.op.recipeId) && overlaps(lease, actual)) add(result, "resource_lease_overlap", `Ресурс ${lease.resourceId} остаётся занят до освобождения.`, lease.op);
    for (const other of leases) if (lease !== other && lease.resourceId === other.resourceId && (lease.op.dishKey ?? lease.op.recipeId) !== (other.op.dishKey ?? other.op.recipeId) && overlaps(lease, other)) add(result, "resource_lease_overlap", `Ресурс ${lease.resourceId} остаётся занят до освобождения.`, lease.op);
  }
  for (const heat of session.operations.filter((op) => op.requiresCheckAtEnd && op.attention === "background")) { const heatEntry = entries.get(heat.id), check = session.operations.find((candidate) => candidate.kind === "intervention" && candidate.dependsOn.includes(heat.id)), checkEntry = check && entries.get(check.id), deadline = (heat as ExtendedOperation).checkDeadlineSeconds ?? 0; if (heatEntry && (!checkEntry || checkEntry.startAt < heatEntry.endAt || checkEntry.startAt > heatEntry.endAt + deadline)) add(result, "mandatory_check_deadline", "Обязательная проверка назначена вне допустимого срока.", heat); }
  return result;
}
