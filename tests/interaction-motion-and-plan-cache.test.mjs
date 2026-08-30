import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the plan worker prefers fresh shopping state and invalidates mutations", async () => {
  const workerSource = await read("public/sw.js");
  const origin = "https://mise.test";
  const clientId = "device-1";
  const cacheUrl = `${origin}/api/plans?mise-client=${clientId}`;
  const stored = new Map([
    [
      cacheUrl,
      new Response(JSON.stringify({ plan: { shopping: [{ checked: false }] } }), {
        headers: { "Content-Type": "application/json" },
      }),
    ],
  ]);
  const handlers = new Map();
  let online = true;
  let networkCalls = 0;
  const cache = {
    async match(key) {
      return stored.get(key.url ?? String(key))?.clone();
    },
    async put(key, response) {
      stored.set(key.url ?? String(key), response.clone());
    },
    async delete(key) {
      return stored.delete(key.url ?? String(key));
    },
    async addAll() {},
  };
  const self = {
    location: { origin },
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    skipWaiting() {},
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async () => undefined,
    },
    registration: { showNotification: async () => undefined },
  };
  vm.runInNewContext(workerSource, {
    self,
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (key) => cache.match(key),
    },
    fetch: async (request) => {
      networkCalls += 1;
      if (!online) throw new TypeError("offline");
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({ plan: { shopping: [{ checked: true }] } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
    Request,
    Response,
    URL,
    JSON,
    Promise,
    encodeURIComponent,
  });

  const dispatch = async (request) => {
    let responsePromise;
    handlers.get("fetch")({
      request,
      respondWith(promise) {
        responsePromise = Promise.resolve(promise);
      },
      waitUntil() {},
    });
    return responsePromise;
  };

  const fresh = await dispatch(
    new Request(`${origin}/api/plans`, {
      headers: { "X-Mise-Client": clientId },
    }),
  );
  assert.equal((await fresh.json()).plan.shopping[0].checked, true);
  assert.equal(networkCalls, 1, "cached data must not win before the network");
  assert.equal(
    (await stored.get(cacheUrl).clone().json()).plan.shopping[0].checked,
    true,
    "the successful network response replaces the stale cache",
  );

  await dispatch(
    new Request(`${origin}/api/plans`, {
      method: "POST",
      headers: { "X-Mise-Client": clientId },
      body: "{}",
    }),
  );
  assert.equal(stored.has(cacheUrl), false, "a successful save invalidates plan GET cache");

  stored.set(
    cacheUrl,
    new Response(JSON.stringify({ plan: { shopping: [{ checked: true }] } }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  online = false;
  const offline = await dispatch(
    new Request(`${origin}/api/plans`, {
      headers: { "X-Mise-Client": clientId },
    }),
  );
  assert.equal((await offline.json()).plan.shopping[0].checked, true);
});

test("plan bootstrap cannot overwrite an optimistic local shopping edit", async () => {
  const [page, worker] = await Promise.all([
    read("app/page.tsx"),
    read("public/sw.js"),
  ]);
  assert.match(worker, /PLAN_CACHE_NAME = "mise-plan-v3"/);
  assert.match(worker, /\["POST", "DELETE"\]\.includes\(event\.request\.method\)/);
  assert.match(page, /const planMutationRevision = useRef\(0\)/);
  assert.match(page, /const bootstrapRevision = planMutationRevision\.current/);
  assert.match(
    page,
    /!cachedPlan[\s\S]{0,180}planMutationRevision\.current === bootstrapRevision/,
  );
  assert.match(page, /previousLocalPlan = storedLocalPlan\(id\);[\s\S]{0,100}planMutationRevision\.current \+= 1/);
  assert.match(
    page,
    /const daily = nutritionRepairLegacyDailyMacros\([\s\S]{0,120}person\.macroPreset \?\? "balanced"/,
  );
});

test("recipe entry, detail tabs and catalog controls use the supplied interaction motion", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  const recipeView = page.slice(page.indexOf("function RecipeView("));
  assert.match(recipeView, /const fromWeek = Boolean\(batch && slot && plan\)/);
  assert.match(recipeView, /recipe-detail\$\{fromWeek \? " is-entering-from-week"/);
  assert.match(recipeView, /function selectSection\(next: "steps" \| "portion"\)/);
  assert.match(recipeView, /recipe-section-motion/);
  assert.match(css, /mise-recipe-detail-week-in 420ms var\(--motion-settled\)/);
  assert.match(css, /mise-recipe-section-right 320ms var\(--motion-settled\)/);
  assert.match(css, /mise-recipe-section-left 320ms var\(--motion-settled\)/);
  assert.match(css, /catalog-filter-button:active:not\(:disabled\)[\s\S]{0,180}scale\(0\.94\)/);
  assert.match(css, /catalog-filters-sheet \.chip:active:not\(:disabled\)/);
  assert.match(css, /mise-catalog-filter-count 300ms var\(--motion-spring\)/);
});

test("goal calculator follows motion_wizard_1 card 9d", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  const peopleStep = page.slice(
    page.indexOf("function PeopleStep("),
    page.indexOf("function CookingStep("),
  );
  assert.match(peopleStep, /className="seg seg-2"/);
  assert.match(peopleStep, /className="seg seg-accent seg-3"/);
  assert.equal((peopleStep.match(/className="seg-indicator"/g) ?? []).length, 2);
  assert.match(peopleStep, /AnimatedNumber value=\{person\.daily\.kcal\} step=\{5\} duration=\{420\}/);
  assert.match(peopleStep, /AnimatedNumber value=\{fromMacros\} step=\{5\} duration=\{420\}/);
  assert.match(css, /\.seg-indicator \{[\s\S]*?transform 290ms cubic-bezier\(0\.34, 1\.28, 0\.5, 1\)/);
  assert.match(css, /\.seg button \{[\s\S]*?color 200ms linear 100ms/);
  assert.match(css, /\.macro-bar i \{[\s\S]*?width 420ms/);
  assert.match(css, /\.norm-check \{[\s\S]*?color 320ms linear[\s\S]*?background-color 320ms linear/);
  assert.match(css, /\.nutrition-calculate-button:active:not\(:disabled\)[\s\S]*?scale\(0\.97\)/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /recipe-detail\.is-entering-from-week/);
  assert.match(reduced, /recipe-section-motion\.motion-enter-right/);
  assert.match(reduced, /seg-indicator[\s\S]*?transition: background-color 160ms linear !important/);
});
