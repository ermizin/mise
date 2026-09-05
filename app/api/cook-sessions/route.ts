import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { cookSessions, mealPlans, pushJobs, pushPreferences, pushSubscriptions } from "../../../db/schema";
import { cookSessionId, timerJobId, timerJobKind, validateCookState, validMutationId, validOpaqueId, type CookSessionState } from "../../../lib/cook-session-server";

type Identity = { clientId: string; deviceId: string; subscriptionId: string };
type SessionBody = { planId?: unknown; batchId?: unknown; sessionKey?: unknown; revision?: unknown; mutationId?: unknown; state?: unknown };

function identifier(request: Request, header: string) {
  const value = request.headers.get(header) ?? "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}

function identity(request: Request): Identity | null {
  const clientId = identifier(request, "x-mise-client");
  const deviceId = identifier(request, "x-mise-device");
  return clientId && deviceId ? { clientId, deviceId, subscriptionId: `${clientId}:${deviceId}` } : null;
}

function requestIds(planId: unknown, sessionKey: unknown) {
  return validOpaqueId(planId, 200) && validOpaqueId(sessionKey, 512) ? { planId, sessionKey } : null;
}

async function ownedBatch(clientId: string, planId: string, batchId: unknown) {
  if (!validOpaqueId(batchId, 100)) return false;
  const [plan] = await getDb().select({ payload: mealPlans.payload }).from(mealPlans).where(and(eq(mealPlans.id, `${clientId}:${planId}`), eq(mealPlans.clientId, clientId))).limit(1);
  if (!plan) return false;
  try {
    const payload = JSON.parse(plan.payload) as { batches?: Array<{ id?: unknown }> };
    return Array.isArray(payload.batches) && payload.batches.some((batch) => batch?.id === batchId);
  } catch { return false; }
}

function rowResponse(row: { state: string; revision: number; mutationId: string }, pushScheduled = false) {
  return { state: JSON.parse(row.state), revision: row.revision, mutationId: row.mutationId, pushScheduled };
}

async function reconcileTimerJobs(identity: Identity, planId: string, batchId: string, sessionId: string, state: CookSessionState) {
  const db = getDb();
  const [subscription] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(and(eq(pushSubscriptions.id, identity.subscriptionId), eq(pushSubscriptions.clientId, identity.clientId), eq(pushSubscriptions.deviceId, identity.deviceId))).limit(1);
  const [preference] = subscription ? await db.select({ id: pushPreferences.id }).from(pushPreferences).where(and(eq(pushPreferences.subscriptionId, subscription.id), eq(pushPreferences.planId, planId), eq(pushPreferences.enabled, true))).limit(1) : [];
  const kindPrefix = `cooking-timer:${sessionId}:`;
  const now = Date.now();
  const jobs = preference && state.phase !== "complete" ? Object.entries(state.timers)
    .filter(([, timer]) => timer.status === "running" && timer.endsAt !== null && timer.endsAt >= now - 5 * 60 * 1000)
    .map(([timerId, timer]) => ({
      id: timerJobId(sessionId, timerId, timer.endsAt as number),
      subscriptionId: identity.subscriptionId,
      planId,
      kind: timerJobKind(sessionId, timerId),
      title: timer.title,
      body: `${timer.title} — время вышло.`.slice(0, 240),
      url: `/?cookPlan=${encodeURIComponent(planId)}&cookBatch=${encodeURIComponent(batchId)}`,
      dueAt: timer.endsAt as number,
      createdAt: now,
    })) : [];
  // D1 rejects LIKE patterns that include our 64-character session hash. The
  // subscription+plan index bounds this query, then an exact JS prefix keeps
  // cleanup scoped to this session without wildcard parsing.
  const existing = (await db.select({ id: pushJobs.id, kind: pushJobs.kind, sentAt: pushJobs.sentAt }).from(pushJobs).where(and(eq(pushJobs.subscriptionId, identity.subscriptionId), eq(pushJobs.planId, planId)))).filter((job) => job.kind.startsWith(kindPrefix));
  const existingIds = new Set(existing.map((job) => job.id));
  const desiredIds = new Set(jobs.map((job) => job.id));
  const obsoleteIds = existing.filter((job) => job.sentAt === null && !desiredIds.has(job.id)).map((job) => job.id);
  // Preserve an exact existing job and its lease. A changed end time receives a
  // distinct id, while paused/completed timers remove only obsolete jobs.
  if (obsoleteIds.length) await db.delete(pushJobs).where(and(eq(pushJobs.subscriptionId, identity.subscriptionId), eq(pushJobs.planId, planId), isNull(pushJobs.sentAt), inArray(pushJobs.id, obsoleteIds)));
  // Sent jobs also count as existing: retrying a save must not resend a timer.
  // The unique id handles concurrent retries without disturbing leases.
  const newJobs = jobs.filter((job) => !existingIds.has(job.id));
  if (newJobs.length) await db.insert(pushJobs).values(newJobs).onConflictDoNothing();
  return jobs.some((job) => !existing.some((saved) => saved.id === job.id && saved.sentAt !== null));
}

async function currentPushScheduled(identity: Identity, planId: string, sessionId: string) {
  const db = getDb();
  const [preference] = await db.select({ id: pushPreferences.id }).from(pushPreferences).where(and(eq(pushPreferences.subscriptionId, identity.subscriptionId), eq(pushPreferences.planId, planId), eq(pushPreferences.enabled, true))).limit(1);
  if (!preference) return false;
  const prefix = `cooking-timer:${sessionId}:`;
  const jobs = await db.select({ kind: pushJobs.kind }).from(pushJobs).where(and(eq(pushJobs.subscriptionId, identity.subscriptionId), eq(pushJobs.planId, planId), isNull(pushJobs.sentAt)));
  return jobs.some((job) => job.kind.startsWith(prefix));
}

export async function GET(request: Request) {
  const requester = identity(request);
  if (!requester) return Response.json({ error: "client and device ids are required" }, { status: 400 });
  const url = new URL(request.url);
  const ids = requestIds(url.searchParams.get("planId"), url.searchParams.get("sessionKey"));
  if (!ids) return Response.json({ error: "planId and sessionKey are required" }, { status: 400 });
  const sessionId = await cookSessionId(requester.clientId, ids.planId, ids.sessionKey);
  try {
    const [row] = await getDb().select().from(cookSessions).where(and(eq(cookSessions.id, sessionId), eq(cookSessions.clientId, requester.clientId), eq(cookSessions.planId, ids.planId))).limit(1);
    if (!row) return Response.json({ error: "cook session not found" }, { status: 404 });
    return Response.json(rowResponse(row, await currentPushScheduled(requester, ids.planId, sessionId)));
  } catch { return Response.json({ error: "cook session storage is unavailable" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const requester = identity(request);
  if (!requester) return Response.json({ error: "client and device ids are required" }, { status: 400 });
  let body: SessionBody;
  try { body = await request.json() as SessionBody; } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const ids = requestIds(body.planId, body.sessionKey);
  const batchId = body.batchId;
  const mutationId = body.mutationId;
  const revision = body.revision;
  if (!ids || !validOpaqueId(batchId, 100) || !validMutationId(mutationId) || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || !validateCookState(body.state)) return Response.json({ error: "invalid cook session" }, { status: 400 });
  try {
    if (!await ownedBatch(requester.clientId, ids.planId, batchId)) return Response.json({ error: "plan or batch is not available to this client" }, { status: 404 });
    const sessionId = await cookSessionId(requester.clientId, ids.planId, ids.sessionKey);
    const db = getDb();
    let [current] = await db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).limit(1);
    if (current?.mutationId === mutationId) {
      const pushScheduled = await reconcileTimerJobs(requester, ids.planId, current.batchId, sessionId, JSON.parse(current.state) as CookSessionState);
      return Response.json(rowResponse(current, pushScheduled));
    }
    if (!current && revision === 0) {
      const now = Date.now();
      await db.insert(cookSessions).values({ id: sessionId, clientId: requester.clientId, planId: ids.planId, batchId, state: JSON.stringify(body.state), revision: 1, mutationId, updatedAt: now }).onConflictDoNothing();
      [current] = await db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).limit(1);
      if (current?.mutationId !== mutationId) return Response.json({ ...(current ? rowResponse(current) : {}), error: "cook session conflict" }, { status: 409 });
    } else {
      if (!current || current.revision !== revision || current.batchId !== batchId) return Response.json({ ...(current ? rowResponse(current) : {}), error: "cook session conflict" }, { status: 409 });
      const now = Date.now();
      const [updated] = await db.update(cookSessions).set({ state: JSON.stringify(body.state), revision: current.revision + 1, mutationId, updatedAt: now }).where(and(eq(cookSessions.id, sessionId), eq(cookSessions.revision, revision))).returning();
      if (!updated) {
        const [server] = await db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).limit(1);
        return Response.json({ ...(server ? rowResponse(server) : {}), error: "cook session conflict" }, { status: 409 });
      }
      current = updated;
    }
    const pushScheduled = await reconcileTimerJobs(requester, ids.planId, current.batchId, sessionId, JSON.parse(current.state) as CookSessionState);
    return Response.json(rowResponse(current, pushScheduled));
  } catch { return Response.json({ error: "cook session storage is unavailable" }, { status: 500 }); }
}
