const CACHE_NAME = "mise-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((response) => response || caches.match("/"))));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Mise", body: event.data?.text() || "Пора вернуться к плану." };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Mise", {
      body: payload.body || "Пора вернуться к плану.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.kind ? `mise-${payload.kind}` : "mise-reminder",
      renotify: false,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const openClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (openClient) {
        await openClient.focus();
        if ("navigate" in openClient) await openClient.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
