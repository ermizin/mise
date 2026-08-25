import { and, eq, isNull, lt, lte } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { pushJobs, pushPreferences, pushSubscriptions } from "../db/schema";

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
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value));
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
  const userKey = await crypto.subtle.importKey("raw", userPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
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
    configuration.VAPID_SUBJECT ?? "https://mise-meal-prep-ermizin.solar-hinny-0376.chatgpt.site",
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

export async function processDueNotifications(now = Date.now()) {
  const db = getDb();
  const jobs = await db.select().from(pushJobs).where(and(isNull(pushJobs.sentAt), lte(pushJobs.dueAt, now), lt(pushJobs.attempts, 5))).limit(50);
  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    const [subscription] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, job.subscriptionId)).limit(1);
    const [preference] = await db.select().from(pushPreferences).where(and(
      eq(pushPreferences.subscriptionId, job.subscriptionId),
      eq(pushPreferences.planId, job.planId),
      eq(pushPreferences.enabled, true),
    )).limit(1);
    if (!subscription || !preference) {
      await db.update(pushJobs).set({ sentAt: now, lastError: "disabled" }).where(eq(pushJobs.id, job.id));
      continue;
    }

    try {
      const response = await sendWebPush(subscription, { title: job.title, body: job.body, url: job.url, kind: job.kind });
      if (response.ok) {
        sent += 1;
        await db.update(pushJobs).set({ sentAt: now, attempts: job.attempts + 1, lastError: null }).where(eq(pushJobs.id, job.id));
      } else if (response.status === 404 || response.status === 410) {
        failed += 1;
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        await db.delete(pushJobs).where(eq(pushJobs.subscriptionId, subscription.id));
        await db.delete(pushPreferences).where(eq(pushPreferences.subscriptionId, subscription.id));
      } else {
        failed += 1;
        await db.update(pushJobs).set({ attempts: job.attempts + 1, lastError: `push ${response.status}` }).where(eq(pushJobs.id, job.id));
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 300) : "push failed";
      await db.update(pushJobs).set({ attempts: job.attempts + 1, lastError: message }).where(eq(pushJobs.id, job.id));
    }
  }

  return { checked: jobs.length, sent, failed };
}
