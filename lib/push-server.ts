import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { cookSessions, pushJobs, pushPreferences, pushSubscriptions } from "../db/schema";
import { parseTimerJobKind, type CookSessionState } from "./cook-session-server";

type PushEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

function pushEnv(): PushEnv {
  return env as unknown as PushEnv;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function joinBytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hmac(key: Uint8Array, value: Uint8Array) {
  const cryptoKey = await crypto.subtle.importKey("raw", key as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value as unknown as BufferSource));
}

async function hkdfExtract(salt: Uint8Array, input: Uint8Array) {
  return hmac(salt, input);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const output = await hmac(prk, joinBytes(info, new Uint8Array([1])));
  return output.slice(0, length);
}

async function vapidToken(endpoint: string, publicKey: Uint8Array, privateKey: Uint8Array, subject: string) {
  if (publicKey.length !== 65 || privateKey.length !== 32) throw new Error("Invalid VAPID key pair");
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicKey.slice(1, 33)),
    y: encodeBase64Url(publicKey.slice(33, 65)),
    d: encodeBase64Url(privateKey),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${encodeBase64Url(signature)}`;
}

async function encryptPayload(payload: string, userPublicKey: Uint8Array, authSecret: Uint8Array) {
  const applicationServerKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const applicationServerPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", applicationServerKeys.publicKey));
  const userKey = await crypto.subtle.importKey("raw", userPublicKey as unknown as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, applicationServerKeys.privateKey, 256));

  const authPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = joinBytes(
    new TextEncoder().encode("WebPush: info\0"),
    userPublicKey,
    applicationServerPublicKey,
  );
  const inputKey = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, inputKey);
  const contentEncryptionKey = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const plaintext = joinBytes(new TextEncoder().encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return joinBytes(salt, recordSize, new Uint8Array([applicationServerPublicKey.length]), applicationServerPublicKey, ciphertext);
}

async function sendWebPush(subscription: SubscriptionRow, payload: object) {
  const configuration = pushEnv();
  if (!configuration.VAPID_PUBLIC_KEY || !configuration.VAPID_PRIVATE_KEY) throw new Error("Web Push is not configured");
  const publicKey = decodeBase64Url(configuration.VAPID_PUBLIC_KEY);
  const body = await encryptPayload(JSON.stringify(payload), decodeBase64Url(subscription.p256dh), decodeBase64Url(subscription.auth));
  const token = await vapidToken(
    subscription.endpoint,
    publicKey,
    decodeBase64Url(configuration.VAPID_PRIVATE_KEY),
    configuration.VAPID_SUBJECT ?? "https://mise.ermizinm.ru",
  );
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${configuration.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body,
  });
}

export function publicVapidKey() {
  return pushEnv().VAPID_PUBLIC_KEY ?? null;
}

const JOB_LEASE_MS = 60_000;
const RETIRED_REMINDER_KINDS = new Set(["shopping", "next-plan"]);

async function timerJobIsCurrent(job: typeof pushJobs.$inferSelect, now: number) {
  const parsed = parseTimerJobKind(job.kind);
  if (!parsed) return true;
  const [session] = await getDb().select({ state: cookSessions.state }).from(cookSessions).where(eq(cookSessions.id, parsed.sessionId)).limit(1);
  if (!session) return false;
  try {
    const state = JSON.parse(session.state) as CookSessionState;
    const timer = state.timers?.[parsed.timerId];
    return state.phase !== "complete" && timer?.status === "running" && timer.endsAt === job.dueAt && job.dueAt >= now - 5 * 60 * 1000;
  } catch { return false; }
}

export async function processDueNotifications(now = Date.now(), options: { jobId?: string } = {}) {
  const db = getDb();
  const dueConditions = [isNull(pushJobs.sentAt), lte(pushJobs.dueAt, now), lt(pushJobs.attempts, 5)];
  if (options.jobId) dueConditions.push(eq(pushJobs.id, options.jobId));
  const jobs = await db.select().from(pushJobs).where(and(...dueConditions)).limit(options.jobId ? 1 : 50);
  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    // The conditional update is the claim. Other cron invocations skip a leased job;
    // a crashed worker's lease expires so the job can be retried later.
    const [claimed] = await db.update(pushJobs).set({
      leaseUntil: now + JOB_LEASE_MS,
      attempts: job.attempts + 1,
    }).where(and(
      eq(pushJobs.id, job.id),
      isNull(pushJobs.sentAt),
      lt(pushJobs.attempts, 5),
      or(isNull(pushJobs.leaseUntil), lt(pushJobs.leaseUntil, now)),
    )).returning();
    if (!claimed) continue;

    // Batch 5 replaced the shopping and next-plan reminders. Existing D1 jobs
    // may outlive the client release that created them, so retire only those
    // obsolete kinds while preserving still-valid cooking and thaw jobs.
    if (RETIRED_REMINDER_KINDS.has(claimed.kind)) {
      await db.update(pushJobs).set({
        sentAt: now,
        leaseUntil: null,
        lastError: "retired reminder kind",
      }).where(eq(pushJobs.id, claimed.id));
      continue;
    }

    // Cooking timers are derived state. A cancelled, paused or superseded
    // session must not surface a late notification from an older job.
    if (!await timerJobIsCurrent(claimed, now)) {
      await db.update(pushJobs).set({ sentAt: now, leaseUntil: null, lastError: "stale cooking session" }).where(eq(pushJobs.id, claimed.id));
      continue;
    }

    const [subscription] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, claimed.subscriptionId)).limit(1);
    const [preference] = await db.select().from(pushPreferences).where(and(
      eq(pushPreferences.subscriptionId, claimed.subscriptionId),
      eq(pushPreferences.planId, claimed.planId),
      eq(pushPreferences.enabled, true),
    )).limit(1);
    if (!subscription || !preference) {
      await db.update(pushJobs).set({ sentAt: now, leaseUntil: null, lastError: "disabled" }).where(eq(pushJobs.id, claimed.id));
      continue;
    }

    try {
      const response = await sendWebPush(subscription, { title: claimed.title, body: claimed.body, url: claimed.url, kind: claimed.kind });
      if (response.ok) {
        sent += 1;
        await db.update(pushJobs).set({ sentAt: now, leaseUntil: null, lastError: null }).where(eq(pushJobs.id, claimed.id));
      } else if (response.status === 404 || response.status === 410) {
        failed += 1;
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        await db.delete(pushJobs).where(eq(pushJobs.subscriptionId, subscription.id));
        await db.delete(pushPreferences).where(eq(pushPreferences.subscriptionId, subscription.id));
      } else {
        failed += 1;
        await db.update(pushJobs).set({ leaseUntil: null, lastError: `push ${response.status}` }).where(eq(pushJobs.id, claimed.id));
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 300) : "push failed";
      await db.update(pushJobs).set({ leaseUntil: null, lastError: message }).where(eq(pushJobs.id, claimed.id));
    }
  }

  return { checked: jobs.length, sent, failed };
}
