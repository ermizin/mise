import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { cookingSessions, pushJobs, pushPreferences, pushSubscriptions } from "../db/schema";
import { cookingSessionStorageId } from "./cooking-session-store";
import type { CookingExecutionState, CompiledSession } from "../domain/cooking/types";

export type CookingNotificationEnvelope = {
  compiled: CompiledSession;
  execution: CookingExecutionState;
};

type CookingStepReference = {
  planId: string; batchId: string; sessionId: string; opId: string; endsAt: number; revision: number;
};

function finiteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function cookingStepUrl(reference: CookingStepReference) {
  const query = new URLSearchParams({
    planId: reference.planId, batchId: reference.batchId, sessionId: reference.sessionId,
    opId: reference.opId, endsAt: String(reference.endsAt), revision: String(reference.revision),
  });
  return `/?tab=week&${query}`;
}

export function cookingStepReference(url: string): CookingStepReference | null {
  try {
    const parsed = new URL(url, "https://mise.invalid");
    if (parsed.pathname !== "/" || parsed.searchParams.get("tab") !== "week") return null;
    const planId = parsed.searchParams.get("planId") ?? "";
    const batchId = parsed.searchParams.get("batchId") ?? "";
    const sessionId = parsed.searchParams.get("sessionId") ?? "";
    const opId = parsed.searchParams.get("opId") ?? "";
    const endsAt = Number(parsed.searchParams.get("endsAt"));
    const revision = Number(parsed.searchParams.get("revision"));
    return /^[A-Za-z0-9:_-]+$/u.test(planId) && /^[A-Za-z0-9:_-]+$/u.test(batchId) &&
      /^[A-Za-z0-9:_-]+$/u.test(sessionId) && /^[A-Za-z0-9:_-]+$/u.test(opId) &&
      finiteTime(endsAt) && Number.isInteger(revision) && revision >= 0
      ? { planId, batchId, sessionId, opId, endsAt, revision } : null;
  } catch { return null; }
}

export function cookingStepJobs(subscriptionId: string, planId: string, batchId: string, envelope: CookingNotificationEnvelope) {
  const { compiled, execution } = envelope;
  return compiled.operations.flatMap((operation) => {
    const status = execution.statusByOperation[operation.id];
    const endsAt = execution.endsAtByOperation?.[operation.id];
    if (operation.kind !== "heat" || operation.attention !== "background" ||
      (status !== "active" && status !== "needs_check") || !finiteTime(endsAt)) return [];
    const reference = { planId, batchId, sessionId: compiled.id, opId: operation.id, endsAt, revision: execution.revision };
    return [{
      id: `cooking-step:${subscriptionId}:${planId}:${batchId}:${compiled.id}:${operation.id}:${endsAt}`,
      subscriptionId, planId, kind: "cooking-step", title: "Проверьте блюдо", body: operation.title,
      url: cookingStepUrl(reference), dueAt: endsAt,
    }];
  });
}

/** Idempotently creates only owner-authorized, opted-in cooking notifications. */
export async function syncCookingStepNotifications(clientId: string, planId: string, batchId: string, envelope: CookingNotificationEnvelope, now = Date.now()) {
  const db = getDb();
  const preferences = await db.select().from(pushPreferences).where(and(eq(pushPreferences.planId, planId), eq(pushPreferences.enabled, true)));
  let scheduled = 0;
  for (const preference of preferences) {
    const [subscription] = await db.select().from(pushSubscriptions).where(and(
      eq(pushSubscriptions.id, preference.subscriptionId), eq(pushSubscriptions.clientId, clientId),
    )).limit(1);
    if (!subscription || subscription.clientId !== clientId) continue;
    const jobs = cookingStepJobs(subscription.id, planId, batchId, envelope);
    if (!jobs.length) continue;
    await db.insert(pushJobs).values(jobs.map(job => ({ ...job, attempts: 0, createdAt: now }))).onConflictDoNothing();
    scheduled += jobs.length;
  }
  return { scheduled };
}

/** Checks the persisted session immediately before sending; stale timers are cancelled, never sent. */
export async function currentCookingStepJob(clientId: string, job: { planId: string; url: string }) {
  const reference = cookingStepReference(job.url);
  if (!reference || reference.planId !== job.planId) return false;
  const [row] = await getDb().select().from(cookingSessions).where(and(
    eq(cookingSessions.id, cookingSessionStorageId(clientId, reference.planId, reference.batchId)),
    eq(cookingSessions.clientId, clientId),
  )).limit(1);
  if (!row || row.revision < reference.revision) return false;
  try {
    const payload = JSON.parse(row.payload) as CookingNotificationEnvelope & { input?: { sessionId?: string } };
    const status = payload.execution?.statusByOperation?.[reference.opId];
    const operation = payload.compiled?.operations?.find(item => item.id === reference.opId);
    return payload.input?.sessionId === reference.sessionId && payload.compiled?.id === reference.sessionId &&
      operation?.kind === "heat" && operation.attention === "background" &&
      (status === "active" || status === "needs_check") && payload.execution?.endsAtByOperation?.[reference.opId] === reference.endsAt;
  } catch { return false; }
}
