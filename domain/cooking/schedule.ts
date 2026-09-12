import type { CompiledSession, CookingOperation, CookingSchedule, ScheduleEntry, ResourceKind, ResourceUse } from "./types";
import { validateCookingGraph, validateCookingSchedule } from "./validate";

type ResourceHold = { resourceId: string; kind: ResourceKind; releaseAfterOpId: string };
type ExtendedOperation = CookingOperation & { resourceHolds?: readonly ResourceHold[]; checkDeadlineSeconds?: number };
type Interval = { start: number; end: number };
type Lease = { resourceId: string; dish: string; start: number; releaseAfterOpId: string };
type Bundle = { operations: CookingOperation[]; relative: Map<string, number>; duration: number };
const makespan = (entries: ScheduleEntry[]) => Math.max(0, ...entries.map((entry) => entry.endAt));
const dish = (op: CookingOperation) => op.dishKey ?? op.recipeId;
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

function requiredCheck(heat: CookingOperation, remaining: Map<string, CookingOperation>, completed: Set<string>) {
  return [...remaining.values()].find((candidate) => candidate.kind === "intervention" && candidate.dependsOn.includes(heat.id) && candidate.dependsOn.every((dependency) => dependency === heat.id || completed.has(dependency)));
}
/** A heat/check chain is placed together, reserving the future cook check before other work can fill it. */
function bundleFor(anchor: CookingOperation, remaining: Map<string, CookingOperation>, completed: Set<string>): Bundle | undefined {
  let heat: CookingOperation | undefined; let prefix: CookingOperation[] = [];
  if (anchor.kind === "heat" && anchor.attention === "background" && anchor.requiresCheckAtEnd) heat = anchor;
  if (anchor.kind === "start_heat") {
    heat = [...remaining.values()].find((candidate) => candidate.kind === "heat" && candidate.attention === "background" && candidate.requiresCheckAtEnd && candidate.dependsOn.includes(anchor.id) && candidate.dependsOn.every((dependency) => dependency === anchor.id || completed.has(dependency)));
    if (heat) prefix = [anchor];
  }
  const check = heat && requiredCheck(heat, remaining, completed);
  if (!heat || !check) return undefined;
  const relative = new Map<string, number>(); let at = 0;
  for (const op of [...prefix, heat, check]) { relative.set(op.id, at); at += op.durationSeconds; }
  return { operations: [...prefix, heat, check], relative, duration: at };
}

function reaches(all: readonly CookingOperation[], from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(target)) return false; seen.add(target);
  return all.find((op) => op.id === target)?.dependsOn.some((dependency) => reaches(all, from, dependency, seen)) ?? false;
}
/** Existing manifests remain conservative until compiler supplies explicit leases. */
function holdsFor(op: CookingOperation, all: readonly CookingOperation[]): readonly ResourceHold[] {
  const explicit = (op as ExtendedOperation).resourceHolds;
  if (explicit?.length) return explicit;
  const release = (kind: "unload" | "wash") => all.find((candidate) => candidate.kind === kind && reaches(all, op.id, candidate.id));
  if (op.kind === "start_heat") { const end = release("unload"); if (end) return op.resources.filter((use) => use.kind !== "cook").map((use) => ({ ...use, releaseAfterOpId: end.id })); }
  if (op.kind === "heat") {
    const unload = release("unload"), wash = release("wash");
    return op.resources.filter((use) => use.kind !== "cook").map((use) => ({ ...use, releaseAfterOpId: use.kind === "burner" ? (unload ?? wash)?.id : (wash ?? unload)?.id })).filter((hold): hold is ResourceHold => !!hold.releaseAfterOpId);
  }
  if (op.kind === "prep" && op.rawMeat) { const end = release("wash"); if (end) return op.resources.filter((use) => use.kind === "board" || use.kind === "knife").map((use) => ({ ...use, releaseAfterOpId: end.id })); }
  return [];
}
function earliest(bundle: Bundle, readyAt: number, calendars: Map<string, Interval[]>, leases: Map<string, Lease>, owner: string): number | undefined {
  let start = readyAt;
  for (let tries = 0; tries < 10000; tries++) {
    let next = start;
    for (const op of bundle.operations) {
      const offset = bundle.relative.get(op.id)!, interval = { start: start + offset, end: start + offset + op.durationSeconds };
      for (const use of op.resources as readonly ResourceUse[]) {
        if (leases.get(use.resourceId)?.dish !== undefined && leases.get(use.resourceId)!.dish !== owner) return undefined;
        for (const busy of calendars.get(use.resourceId) ?? []) if (overlaps(interval, busy)) next = Math.max(next, busy.end - offset);
      }
    }
    if (next === start) return start;
    start = next;
  }
  return undefined;
}
function reserve(calendars: Map<string, Interval[]>, resourceId: string, interval: Interval) { calendars.set(resourceId, [...(calendars.get(resourceId) ?? []), interval]); }

function sequential(session: CompiledSession): ScheduleEntry[] | undefined {
  const remaining = new Map(session.operations.map((op) => [op.id, op])), completed = new Set<string>(), entries: ScheduleEntry[] = []; let at = 0;
  while (remaining.size) {
    const ready = [...remaining.values()].filter((op) => op.dependsOn.every((id) => completed.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) return undefined;
    const bundle = ready.map((op) => bundleFor(op, remaining, completed)).find((candidate): candidate is Bundle => !!candidate) ?? { operations: [ready[0]], relative: new Map([[ready[0].id, 0]]), duration: ready[0].durationSeconds };
    for (const op of bundle.operations) { entries.push({ opId: op.id, startAt: at, endAt: at + op.durationSeconds }); at += op.durationSeconds; completed.add(op.id); remaining.delete(op.id); }
  }
  return entries;
}

function parallel(session: CompiledSession, variant: number): ScheduleEntry[] | undefined {
  const remaining = new Map(session.operations.map((op) => [op.id, op])), completed = new Set<string>(), entries = new Map<string, ScheduleEntry>(), calendars = new Map<string, Interval[]>(), leases = new Map<string, Lease>();
  while (remaining.size) {
    const ready = [...remaining.values()].filter((op) => op.dependsOn.every((id) => completed.has(id)));
    if (!ready.length) return undefined;
    const candidates = ready.map((anchor) => {
      const bundle = bundleFor(anchor, remaining, completed) ?? { operations: [anchor], relative: new Map([[anchor.id, 0]]), duration: anchor.durationSeconds };
      const depends = bundle.operations.flatMap((op) => op.dependsOn.filter((id) => !bundle.relative.has(id)).map((id) => entries.get(id)?.endAt ?? Infinity));
      const start = Number.isFinite(Math.max(0, ...depends)) ? earliest(bundle, Math.max(0, ...depends), calendars, leases, dish(anchor)) : undefined;
      return { anchor, bundle, start };
    }).filter((candidate): candidate is { anchor: CookingOperation; bundle: Bundle; start: number } => candidate.start !== undefined);
    if (!candidates.length) return undefined;
    candidates.sort((a, b) => {
      const aBackground = a.bundle.operations.some((op) => op.attention === "background"), bBackground = b.bundle.operations.some((op) => op.attention === "background");
      const aRelease = a.bundle.operations.some((op) => op.kind === "unload" || op.kind === "wash"), bRelease = b.bundle.operations.some((op) => op.kind === "unload" || op.kind === "wash");
      const tie = a.start - b.start || a.anchor.id.localeCompare(b.anchor.id);
      if (variant === 0) return Number(bBackground) - Number(aBackground) || Number(bRelease) - Number(aRelease) || tie;
      if (variant === 1) return Number(bRelease) - Number(aRelease) || b.bundle.duration - a.bundle.duration || tie;
      return tie;
    });
    const chosen = candidates[0];
    for (const op of chosen.bundle.operations) {
      const startAt = chosen.start + chosen.bundle.relative.get(op.id)!, entry = { opId: op.id, startAt, endAt: startAt + op.durationSeconds };
      entries.set(op.id, entry); completed.add(op.id); remaining.delete(op.id);
      for (const use of op.resources) reserve(calendars, use.resourceId, { start: entry.startAt, end: entry.endAt });
      for (const hold of holdsFor(op, session.operations)) if (!leases.has(hold.resourceId)) leases.set(hold.resourceId, { resourceId: hold.resourceId, dish: dish(op), start: entry.startAt, releaseAfterOpId: hold.releaseAfterOpId });
      for (const [resourceId, lease] of [...leases]) if (lease.releaseAfterOpId === op.id) { reserve(calendars, resourceId, { start: lease.start, end: entry.endAt }); leases.delete(resourceId); }
    }
  }
  return leases.size ? undefined : [...entries.values()].sort((a, b) => a.startAt - b.startAt || a.opId.localeCompare(b.opId));
}

function isValid(session: CompiledSession, entries: ScheduleEntry[], mode: "optimized" | "sequential", baselineMakespan: number, optimizedMakespan: number, usedFallback: boolean) {
  return validateCookingSchedule(session, { mode, entries, baselineMakespan, optimizedMakespan, usedFallback, diagnostics: [] }).length === 0;
}

/** Schedules all operations relative to session start without changing source durations. */
export function scheduleCookingSession(session: CompiledSession): CookingSchedule {
  const diagnostics = [...(session.diagnostics ?? []), ...validateCookingGraph(session)], baseline = sequential(session);
  if (diagnostics.length || session.fallbackReason) return { mode: "sequential", entries: [], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: true, diagnostics: diagnostics.length ? diagnostics : [...(session.diagnostics ?? []), { code: "verified_manifest_required", message: "Без полной проверенной карты операций расписание не строится." }] };
  if (!baseline) return { mode: "sequential", entries: [], baselineMakespan: 0, optimizedMakespan: 0, usedFallback: true, diagnostics: [{ code: "incomplete_schedule", message: "Расписание не содержит всех операций." }] };
  const baselineMakespan = makespan(baseline);
  if (!isValid(session, baseline, "sequential", baselineMakespan, baselineMakespan, true)) return { mode: "sequential", entries: baseline, baselineMakespan, optimizedMakespan: baselineMakespan, usedFallback: true, diagnostics: [{ code: "baseline_schedule_invalid", message: "Последовательный план не прошёл проверку безопасности." }] };
  const options = [0, 1, 2].map((variant) => parallel(session, variant)).filter((entries): entries is ScheduleEntry[] => !!entries).filter((entries) => isValid(session, entries, "optimized", baselineMakespan, makespan(entries), false)).sort((a, b) => makespan(a) - makespan(b) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const best = options[0];
  if (!best || makespan(best) > baselineMakespan) return { mode: "sequential", entries: baseline, baselineMakespan, optimizedMakespan: baselineMakespan, usedFallback: true, diagnostics: [{ code: "optimized_schedule_unavailable", message: "Безопасный параллельный план не построен; показан последовательный план." }] };
  return { mode: "optimized", entries: best, baselineMakespan, optimizedMakespan: makespan(best), usedFallback: false, diagnostics: [] };
}
