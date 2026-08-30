import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offers Home Screen installation after the first plan without requesting notification permission", async () => {
  const [page, manifestText, layout, serviceWorker] = await Promise.all([read("app/page.tsx"), read("public/manifest.webmanifest"), read("app/layout.tsx"), read("public/sw.js")]);
  const manifest = JSON.parse(manifestText);
  // the offer follows the finished plan and stays reachable from the profile, so onboarding no longer holds an install step
  assert.doesNotMatch(page, /setOnboardingStep\("install"\)/);
  assert.match(page, /function InstallInline\(/);
  assert.match(page, /Добавить Mise на экран Домой/);
  const successSheet = page.indexOf("function SuccessSheet(");
  assert.ok(successSheet > 0 && page.indexOf("<InstallInline />", successSheet) > successSheet, "the finished plan offers installation");
  const profile = page.indexOf("function ProfileScreen(");
  assert.ok(profile > 0 && page.indexOf("<InstallInline />", profile) > profile, "the profile keeps the offer available");
  assert.doesNotMatch(page, /Notification\.requestPermission/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.name, "Mise");
  assert.equal(manifest.short_name, "Mise");
  assert.deepEqual(manifest.icons.map(({ sizes, type }) => [sizes, type]), [["192x192", "image/png"], ["512x512", "image/png"]]);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(serviceWorker, /icon: "\/icon-192\.png"/);
});

test("ships real PNG icons at the declared sizes", async () => {
  const files = await Promise.all([
    ["public/icon-192.png", 192],
    ["public/icon-512.png", 512],
    ["public/apple-touch-icon.png", 180],
  ].map(async ([path, expected]) => [await readFile(new URL(`../${path}`, import.meta.url)), expected, path]));
  for (const [buffer, expected, path] of files) {
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} is PNG`);
    assert.equal(buffer.readUInt32BE(16), expected, `${path} width`);
    assert.equal(buffer.readUInt32BE(20), expected, `${path} height`);
  }
});

test("requests permission only from the explicit reminder action", async () => {
  const setup = await read("app/notification-setup.tsx");
  const enableStart = setup.indexOf("async function enable()");
  const permission = setup.indexOf("Notification.requestPermission()", enableStart);
  const enableButton = setup.indexOf("Включить напоминания");
  assert.ok(enableStart >= 0 && permission > enableStart && enableButton > permission);
  for (const kind of ["shopping", "cooking", "thaw", "next-plan"]) assert.match(setup, new RegExp(`kind: "${kind}"`));
  assert.match(setup, /userVisibleOnly: true/);
  assert.match(setup, /applicationServerKey/);
});

test("stores device subscriptions and scheduled jobs, then sends visible Web Push", async () => {
  const [schema, route, sender, serviceWorker, worker, vite, setup] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/push/route.ts"),
    read("lib/push-server.ts"),
    read("public/sw.js"),
    read("worker/index.ts"),
    read("vite.config.ts"),
    read("app/notification-setup.tsx"),
  ]);
  for (const table of ["push_subscriptions", "push_preferences", "push_jobs"]) assert.match(schema, new RegExp(table));
  assert.match(route, /processDueNotifications/);
  assert.match(route, /testDelivered/);
  assert.match(route, /body\.action === "test"/);
  assert.match(route, /kind: "diagnostic"/);
  assert.match(setup, /Отправить тестовое уведомление/);
  assert.match(setup, /action: "test"/);
  assert.match(sender, /Content-Encoding: aes128gcm/);
  assert.match(sender, /Authorization: `vapid/);
  assert.match(serviceWorker, /registration\.showNotification/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /mise:clear-plan-cache/);
  assert.match(serviceWorker, /cache\.delete\(planCacheKey\(clientId\)\)/,
    "a deleted plan can remove its offline GET cache entry",
  );
  assert.match(schema, /leaseUntil: integer\("lease_until"\)/,
    "push jobs retain a recoverable lease for atomic claims",
  );
  assert.match(sender, /leaseUntil: now \+ JOB_LEASE_MS/);
  assert.match(sender, /or\(isNull\(pushJobs\.leaseUntil\), lt\(pushJobs\.leaseUntil, now\)\)/,
    "only one processor can claim a due job until its lease expires",
  );
  assert.match(route, /processDueNotifications\(now, \{ jobId: testId \}\)/,
    "test delivery processes the exact diagnostic job",
  );
  assert.match(route, /error: "invalid JSON".*status: 400/s,
    "malformed push requests fail as client errors",
  );
  assert.match(route, /body\.jobs\.every\(\(job\) => validJob\(job, now\)\)/,
    "enabling reminders rejects the whole invalid schedule instead of silently dropping jobs",
  );
  assert.match(route, /Boolean\(testJob\?\.sentAt\)/,
    "test delivery result comes from the newly-created job, not aggregate sends",
  );
  assert.match(worker, /async scheduled/);
  assert.match(vite, /crons: \["\* \* \* \* \*"\]/);
});
