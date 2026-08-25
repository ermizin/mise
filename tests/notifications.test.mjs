import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offers Home Screen installation after onboarding without requesting notification permission", async () => {
  const [page, manifest] = await Promise.all([read("app/page.tsx"), read("public/manifest.webmanifest")]);
  assert.match(page, /setOnboardingStep\("install"\)/);
  assert.match(page, /Добавьте Mise на экран Домой/);
  assert.match(page, /Разрешение спросим позже/);
  assert.doesNotMatch(page, /Notification\.requestPermission/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.equal(JSON.parse(manifest).start_url, "/");
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
  const [schema, route, sender, serviceWorker, worker, vite] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/push/route.ts"),
    read("lib/push-server.ts"),
    read("public/sw.js"),
    read("worker/index.ts"),
    read("vite.config.ts"),
  ]);
  for (const table of ["push_subscriptions", "push_preferences", "push_jobs"]) assert.match(schema, new RegExp(table));
  assert.match(route, /processDueNotifications/);
  assert.match(route, /testDelivered/);
  assert.match(sender, /Content-Encoding: aes128gcm/);
  assert.match(sender, /Authorization: `vapid/);
  assert.match(serviceWorker, /registration\.showNotification/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(worker, /async scheduled/);
  assert.match(vite, /crons: \["\* \* \* \* \*"\]/);
});
