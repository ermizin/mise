import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://mise.test";

function workerHarness() {
  const handlers = new Map();
  const stores = new Map();
  const notifications = [];
  let online = true;
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async match(key) { return store.get(key.url ?? String(key))?.clone(); },
      async put(key, response) { store.set(key.url ?? String(key), response.clone()); },
      async delete(key) { return store.delete(key.url ?? String(key)); },
      async addAll(paths) {
        for (const path of paths) store.set(new URL(path, origin).href, new Response("shell"));
      },
    };
  };
  const self = {
    location: { origin },
    addEventListener(type, handler) { handlers.set(type, handler); },
    skipWaiting() {},
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => undefined },
    registration: { showNotification: async (title, options) => notifications.push({ title, options }) },
  };
  vm.runInNewContext(workerSource, {
    self,
    caches: {
      open: async (name) => cacheFor(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (key) => {
        for (const store of stores.values()) {
          const response = await { match: (candidate) => store.get(candidate.url ?? String(candidate))?.clone() }.match(key);
          if (response) return response;
        }
        return undefined;
      },
    },
    fetch: async (request) => {
      if (!online) throw new TypeError("offline");
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ plan: true }), { headers: { "Content-Type": "application/json" } });
      if (request.mode === "navigate") return new Response("<html>cooking app</html>", { headers: { "Content-Type": "text/html" } });
      if (url.pathname.endsWith(".js")) return new Response("app bundle", { headers: { "Content-Type": "text/javascript" } });
      if (url.pathname.endsWith(".png")) return new Response("image", { headers: { "Content-Type": "image/png", "Content-Length": "12" } });
      return new Response("missing", { status: 404 });
    },
    Request,
    Response,
    URL,
    Promise,
    Number,
    encodeURIComponent,
  });
  const dispatch = async (request) => {
    let result;
    handlers.get("fetch")({ request, respondWith: (value) => { result = Promise.resolve(value); }, waitUntil() {} });
    return result;
  };
  const dispatchPush = async (payload) => {
    let waited;
    handlers.get("push")({
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: (value) => { waited = Promise.resolve(value); },
    });
    await waited;
  };
  return { dispatch, dispatchPush, notifications, setOnline: (value) => { online = value; }, stores };
}

function staticRequest(path, destination) {
  return { url: `${origin}${path}`, method: "GET", mode: "cors", destination, headers: new Headers() };
}

test("offline cooking reload restores only visited navigation HTML and app assets", async () => {
  const harness = workerHarness();
  const cooking = { url: `${origin}/?cookSession=session-1`, method: "GET", mode: "navigate", destination: "", headers: new Headers() };
  const bundle = staticRequest("/_next/static/cooking.js", "script");
  assert.equal(await (await harness.dispatch(cooking)).text(), "<html>cooking app</html>");
  assert.equal(await (await harness.dispatch(bundle)).text(), "app bundle");
  harness.setOnline(false);
  assert.equal(await (await harness.dispatch(cooking)).text(), "<html>cooking app</html>");
  assert.equal(await (await harness.dispatch(bundle)).text(), "app bundle");
  const missingImage = await harness.dispatch(staticRequest("/recipe-images/not-visited.png", "image"));
  assert.equal(missingImage.type, "error", "offline misses never receive HTML shell");
});

test("service worker never stores authenticated cook-session APIs or returns shell for them", async () => {
  const harness = workerHarness();
  const api = new Request(`${origin}/api/cook-sessions/session-1`, { headers: { "X-Mise-Client": "client-a" } });
  const online = await harness.dispatch(api);
  assert.equal(online.headers.get("Content-Type"), "application/json");
  harness.setOnline(false);
  await assert.rejects(() => harness.dispatch(api), /offline/);
  const shellEntries = [...(harness.stores.get("mise-shell-v5") ?? new Map()).keys()];
  assert.equal(shellEntries.some((key) => key.includes("/api/cook-sessions")), false);
});

test("push keeps timer tags distinct without widening ordinary reminder tags", async () => {
  const harness = workerHarness();
  const session = "a".repeat(64);
  const first = `cooking-timer:${session}:step-1`;
  const second = `cooking-timer:${session}:step-2`;
  await harness.dispatchPush({ kind: first, url: "/?cookSession=one" });
  await harness.dispatchPush({ kind: second, url: "https://other.example/steal" });
  await harness.dispatchPush({ kind: first, url: "/?cookSession=one" });
  assert.deepEqual(
    harness.notifications.map(({ options }) => options.tag),
    [`mise-${first}`, `mise-${second}`, `mise-${first}`],
    "different timer steps do not coalesce, while retries retain their tag",
  );
  assert.deepEqual(
    harness.notifications.map(({ options }) => options.data.url),
    ["/?cookSession=one", "/", "/?cookSession=one"],
    "unsafe notification deep links remain local",
  );
  assert.match(workerSource, /\^cooking-timer:\[a-f0-9\]\{64\}/);
  assert.match(workerSource, /\^\[a-z0-9:_-\]\{1,60\}/);
});
