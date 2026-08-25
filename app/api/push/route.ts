import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { pushJobs, pushPreferences, pushSubscriptions } from "../../../db/schema";
import { processDueNotifications, publicVapidKey } from "../../../lib/push-server";

type PushSubscriptionInput = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

type JobInput = {
  kind?: string;
  title?: string;
  body?: string;
  url?: string;
  dueAt?: number;
};

function identifier(request: Request, header: string) {
  const value = request.headers.get(header) ?? "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}

function ids(request: Request) {
  const clientId = identifier(request, "x-mise-client");
  const deviceId = identifier(request, "x-mise-device");
  return clientId && deviceId ? { clientId, deviceId, subscriptionId: `${clientId}:${deviceId}` } : null;
}

function validSubscription(value: PushSubscriptionInput | undefined) {
  if (!value?.endpoint || !value.keys?.p256dh || !value.keys.auth) return false;
  try {
    return new URL(value.endpoint).protocol === "https:" && value.endpoint.length <= 2_000;
  } catch {
    return false;
  }
}

function validJob(job: JobInput, now: number): job is Required<JobInput> {
  return Boolean(
    job.kind && job.kind.length <= 40 &&
    job.title && job.title.length <= 100 &&
    job.body && job.body.length <= 240 &&
    job.url?.startsWith("/") && !job.url.startsWith("//") && job.url.length <= 300 &&
    Number.isFinite(job.dueAt) && (job.dueAt ?? 0) >= now - 60 * 60 * 1000 && (job.dueAt ?? 0) <= now + 45 * 24 * 60 * 60 * 1000
  );
}

export async function GET(request: Request) {
  const identity = ids(request);
  if (!identity) return Response.json({ error: "client and device ids are required" }, { status: 400 });
  const key = publicVapidKey();
  try {
    const [preference] = await getDb().select().from(pushPreferences).where(eq(pushPreferences.subscriptionId, identity.subscriptionId)).orderBy(desc(pushPreferences.updatedAt)).limit(1);
    return Response.json({
      available: Boolean(key),
      publicKey: key,
      enabled: preference?.enabled ?? false,
      planId: preference?.planId ?? null,
      preferences: preference ? JSON.parse(preference.payload) : null,
    });
  } catch {
    return Response.json({ available: Boolean(key), publicKey: key, enabled: false, preferences: null });
  }
}

export async function POST(request: Request) {
  const identity = ids(request);
  if (!identity) return Response.json({ error: "client and device ids are required" }, { status: 400 });
  const body = (await request.json()) as {
    action?: "enable" | "disable";
    planId?: string;
    subscription?: PushSubscriptionInput;
    preferences?: unknown;
    jobs?: JobInput[];
  };
  if (!body.planId || typeof body.planId !== "string" || body.planId.length > 100) {
    return Response.json({ error: "planId is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Date.now();
  if (body.action === "disable") {
    await db.update(pushPreferences).set({ enabled: false, updatedAt: now }).where(and(
      eq(pushPreferences.subscriptionId, identity.subscriptionId),
      eq(pushPreferences.planId, body.planId),
    ));
    await db.delete(pushJobs).where(and(
      eq(pushJobs.subscriptionId, identity.subscriptionId),
      eq(pushJobs.planId, body.planId),
      isNull(pushJobs.sentAt),
    ));
    return Response.json({ enabled: false });
  }

  if (body.action !== "enable" || !validSubscription(body.subscription) || !Array.isArray(body.jobs) || body.jobs.length > 150) {
    return Response.json({ error: "invalid push configuration" }, { status: 400 });
  }
  const jobs = body.jobs.filter((job) => validJob(job, now));
  const subscription = body.subscription as Required<PushSubscriptionInput> & { keys: { p256dh: string; auth: string } };
  await db.insert(pushSubscriptions).values({
    id: identity.subscriptionId,
    clientId: identity.clientId,
    deviceId: identity.deviceId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: pushSubscriptions.id,
    set: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, updatedAt: now },
  });
  await db.update(pushPreferences).set({ enabled: false, updatedAt: now }).where(eq(pushPreferences.subscriptionId, identity.subscriptionId));
  await db.delete(pushJobs).where(and(eq(pushJobs.subscriptionId, identity.subscriptionId), isNull(pushJobs.sentAt)));
  await db.insert(pushPreferences).values({
    id: `${identity.subscriptionId}:${body.planId}`,
    subscriptionId: identity.subscriptionId,
    planId: body.planId,
    payload: JSON.stringify(body.preferences ?? {}),
    enabled: true,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: pushPreferences.id,
    set: { payload: JSON.stringify(body.preferences ?? {}), enabled: true, updatedAt: now },
  });
  if (jobs.length) {
    await db.insert(pushJobs).values(jobs.map((job) => ({
      id: crypto.randomUUID(),
      subscriptionId: identity.subscriptionId,
      planId: body.planId as string,
      kind: job.kind,
      title: job.title,
      body: job.body,
      url: job.url,
      dueAt: job.dueAt,
      createdAt: now,
    })));
  }

  const testId = crypto.randomUUID();
  await db.insert(pushJobs).values({
    id: testId,
    subscriptionId: identity.subscriptionId,
    planId: body.planId,
    kind: "enabled",
    title: "Mise напомнит вовремя",
    body: "Напоминания для этого плана включены на этом устройстве.",
    url: "/",
    dueAt: now,
    createdAt: now,
  });
  const delivery = await processDueNotifications(now);
  return Response.json({ enabled: true, scheduled: jobs.length, testDelivered: delivery.sent > 0 });
}
