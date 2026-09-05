const CACHE_NAME = "mise-shell-v5";
const PLAN_CACHE_NAME = "mise-plan-v3";
const MAX_CACHED_IMAGE_BYTES = 2 * 1024 * 1024;
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon-32.png",
  "/favicon-16.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, PLAN_CACHE_NAME].includes(key)).map((key) => caches.delete(key)))),
    ]),
  );
});

function planCacheKey(clientId) {
  return new Request(`${self.location.origin}/api/plans?mise-client=${encodeURIComponent(clientId || "anonymous")}`);
}

function isSafeStaticRequest(request, url) {
  if (url.pathname.startsWith("/api/")) return false;
  if (["script", "style", "font"].includes(request.destination)) return true;
  return request.destination === "image";
}

function isCacheableResponse(response, contentType) {
  return response.ok && !response.headers.get("Cache-Control")?.includes("no-store") &&
    (contentType ? response.headers.get("Content-Type")?.includes(contentType) : true);
}

async function cacheNavigation(request, response) {
  if (!isCacheableResponse(response, "text/html")) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function cacheStaticAsset(request, response) {
  if (!isCacheableResponse(response)) return response;
  const imageLength = response.headers.get("Content-Length");
  const imageBytes = Number(imageLength);
  if (request.destination === "image" && (imageLength === null || !Number.isFinite(imageBytes) || imageBytes > MAX_CACHED_IMAGE_BYTES)) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function clearPlanCache(clientId) {
  const cache = await caches.open(PLAN_CACHE_NAME);
  await cache.delete(planCacheKey(clientId));
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== "mise:clear-plan-cache") return;
  event.waitUntil(clearPlanCache(typeof message.clientId === "string" ? message.clientId : "anonymous"));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api/plans" && ["POST", "DELETE"].includes(event.request.method)) {
    const clientId = event.request.headers.get("X-Mise-Client") || "anonymous";
    event.respondWith(
      fetch(event.request).then(async (response) => {
        if (response.ok) await clearPlanCache(clientId);
        return response;
      }),
    );
    return;
  }
  if (event.request.method !== "GET") return;
  if (url.pathname === "/api/plans") {
    const clientId = event.request.headers.get("X-Mise-Client") || "anonymous";
    const cacheKey = planCacheKey(clientId);
    const network = fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(PLAN_CACHE_NAME);
        await cache.put(cacheKey, response.clone());
      }
      return response;
    });
    event.respondWith(
      network.catch(async () => {
        const cache = await caches.open(PLAN_CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: "offline", plan: null }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheNavigation(event.request, response))
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(event.request)) || (await cache.match("/")) || Response.error();
        }),
    );
    return;
  }
  if (isSafeStaticRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheStaticAsset(event.request, response))
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(event.request)) || Response.error();
        }),
    );
    return;
  }
  event.respondWith(fetch(event.request));
});

function notificationUrl(value) {
  try {
    const target = new URL(typeof value === "string" ? value : "/", self.location.origin);
    return target.origin === self.location.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function notificationTag(payload) {
  if (typeof payload.tag === "string" && /^[a-z0-9:_-]{1,80}$/iu.test(payload.tag)) return payload.tag;
  if (typeof payload.kind === "string" && /^cooking-timer:[a-f0-9]{64}:[a-z0-9:_-]{1,512}$/iu.test(payload.kind)) return `mise-${payload.kind}`;
  return typeof payload.kind === "string" && /^[a-z0-9:_-]{1,60}$/iu.test(payload.kind)
    ? `mise-${payload.kind}`
    : "mise-reminder";
}

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
      badge: "/badge-96.png",
      tag: notificationTag(payload),
      renotify: false,
      data: { url: notificationUrl(payload.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(notificationUrl(event.notification.data?.url), self.location.origin).href;
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
