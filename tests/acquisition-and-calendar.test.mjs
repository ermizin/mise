import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadModule(path) {
  const output = ts.transpileModule(await read(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    module: { exports },
    exports,
    URL,
    URLSearchParams,
    TextEncoder,
  });
  return exports;
}

const analytics = await loadModule("lib/analytics.ts");
const calendar = await loadModule("lib/plan-calendar.ts");
const now = Date.UTC(2026, 9, 5, 12);
const eventId = "11111111-1111-4111-8111-111111111111";

test("first visit records only a channel from a closed list", () => {
  const { acquisitionSource } = analytics;
  const host = "mise.ermizinm.ru";
  assert.equal(acquisitionSource("?utm_source=pikabu&utm_medium=post", "", host), "pikabu");
  assert.equal(acquisitionSource("?utm_source=Yandex_Direct", "", host), "yandex_direct");
  assert.equal(acquisitionSource("?utm_source=someone-else", "", host), "other");
  assert.equal(acquisitionSource("", "https://pikabu.ru/story/123", host), "pikabu");
  assert.equal(acquisitionSource("", "https://m.vk.com/wall1", host), "vk");
  assert.equal(acquisitionSource("", "https://t.me/s/channel", host), "telegram");
  assert.equal(acquisitionSource("", "https://yandex.ru/search/?text=милпреп", host), "yandex");
  assert.equal(acquisitionSource("", "https://www.google.com/", host), "google");
  assert.equal(acquisitionSource("", "https://example.org/", host), "other");
  assert.equal(acquisitionSource("", `https://${host}/?tab=recipes`, host), "direct");
  assert.equal(acquisitionSource("", "", host), "direct");
  assert.equal(acquisitionSource("", "not a url", host), "direct");
  // Запуск с иконки — установка уже пришедшего человека, даже если адрес несёт метку.
  assert.equal(acquisitionSource("", "", host, true), "home_screen");
  assert.equal(acquisitionSource("?utm_source=pikabu", "https://pikabu.ru/", host, true), "home_screen");
});

test("the server accepts a channel only on first_open and only from the list", () => {
  const { parseAnalyticsEvent } = analytics;
  const base = { eventId, occurredAt: now };
  const accepted = parseAnalyticsEvent({ ...base, eventName: "first_open", source: "habr" }, now);
  assert.equal(accepted.event.source, "habr");
  assert.equal(parseAnalyticsEvent({ ...base, eventName: "first_open", source: "home_screen" }, now).event.source, "home_screen");
  assert.equal("source" in parseAnalyticsEvent({ ...base, eventName: "first_open" }, now).event, false);
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "first_open", source: "https://pikabu.ru/story/1" }, now).error,
    "source is not allowed",
  );
  assert.equal(
    parseAnalyticsEvent({ ...base, eventName: "shopping_opened", source: "vk" }, now).error,
    "source is only allowed for first_open",
  );
  assert.equal("error" in parseAnalyticsEvent({ ...base, eventName: "calendar_exported" }, now), false);
});

test("the stored channel reaches its own column", async () => {
  const [schema, route, migration, journal, analyticsDoc] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/analytics/route.ts"),
    read("drizzle/0006_acquisition_source.sql"),
    read("drizzle/meta/_journal.json"),
    read("ANALYTICS.md"),
  ]);
  assert.match(schema, /source: text\("source"\)/);
  assert.match(route, /source: parsed\.event\.source \?\? null/);
  assert.match(migration, /ALTER TABLE `analytics_events` ADD `source` text;/);
  assert.ok(JSON.parse(journal).entries.some((entry) => entry.tag === "0006_acquisition_source"));
  assert.match(analyticsDoc, /calendar_exported/);
  assert.match(analyticsDoc, /`source`/);
});

const device = "6f1d2c3b-4a59-4e7f-8a1b-2c3d4e5f6a7b";

test("the calendar link carries plan dates and the device key, nothing about the plan", () => {
  const plan = {
    end: "2026-10-12",
    batches: [{ start: "2026-10-06" }, { start: "2026-10-09" }, { start: "2026-10-09" }],
    frozenUseDates: ["2026-10-11", "2026-10-11"],
  };
  const url = new URL(calendar.planCalendarPath(plan, device), "https://mise.ermizinm.ru");
  assert.equal(url.pathname, "/api/calendar");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["cook", "device", "end", "frozen"]);
  assert.equal(url.searchParams.get("cook"), "2026-10-06,2026-10-09");
  assert.equal(url.searchParams.get("frozen"), "2026-10-11");
  assert.equal(url.searchParams.get("device"), device);
  const withoutKey = new URL(calendar.planCalendarPath(plan, "not-a-uuid"), "https://mise.ermizinm.ru");
  assert.deepEqual([...withoutKey.searchParams.keys()].sort(), ["cook", "end", "frozen"]);
});

test("the calendar rejects dates outside one plan", () => {
  const parse = (query) => calendar.parsePlanCalendarQuery(new URLSearchParams(query));
  assert.equal(parse("cook=2026-10-06").error, "end must be a date");
  assert.equal(parse("end=2026-10-12").error, "cook dates are required");
  assert.equal(parse("end=2026-10-12&cook=2026-02-30").error, "dates must be YYYY-MM-DD");
  assert.equal(parse("end=2026-10-12&cook=2026-10-13").error, "dates must belong to the plan period");
  assert.equal(parse("end=2026-10-12&cook=2026-09-01").error, "dates must belong to the plan period");
  const many = Array.from({ length: 15 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
  assert.equal(parse(`end=2026-10-15&cook=${many.join(",")}`).error, "too many dates");
  assert.deepEqual(JSON.parse(JSON.stringify(parse("end=2026-10-12&cook=2026-10-09,2026-10-06&frozen=2026-10-11").input)), {
    cook: ["2026-10-06", "2026-10-09"],
    frozen: ["2026-10-11"],
    end: "2026-10-12",
  });
  assert.equal(parse("end=2026-10-12&cook=2026-10-06&device=../../etc").error, "device must be a UUID");
  assert.equal(parse(`end=2026-10-12&cook=2026-10-06&device=${device.toUpperCase()}`).input.device, device);
});

test("the calendar file reminds about cooking, thawing and the next plan", () => {
  const ics = calendar.buildPlanCalendar(
    { cook: ["2026-10-06", "2026-10-09"], frozen: ["2026-10-11"], end: "2026-10-12" },
    { origin: "https://mise.ermizinm.ru", now },
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.doesNotMatch(ics.replaceAll("\r\n", ""), /\n/, "every line ends with CRLF");
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 4);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
  for (const line of ics.split("\r\n"))
    assert.ok(new TextEncoder().encode(line).length <= 75, `folded: ${line}`);
  const unfolded = ics.replaceAll("\r\n ", "");
  assert.match(unfolded, /DTSTART:20261006T180000\r\nDURATION:PT1H30M\r\nSUMMARY:Mise: готовка 1 из 2/);
  assert.match(unfolded, /DTSTART:20261010T210000\r\nDURATION:PT15M\r\nSUMMARY:Mise: переложить порции в холодильник/);
  assert.match(unfolded, /DTSTART:20261012T190000\r\nDURATION:PT15M\r\nSUMMARY:Mise: собрать следующий план/);
  assert.match(unfolded, /URL:https:\/\/mise\.ermizinm\.ru\/\?utm_source=calendar/);
  assert.match(unfolded, /UID:mise-next-plan-2026-10-12@mise\.ermizinm\.ru/);
  assert.match(unfolded, /DTSTAMP:20261005T120000Z/);
  assert.match(unfolded, /уже сохранены — новый план займёт пару минут/);
  assert.doesNotMatch(unfolded, /#plan=/, "without a key the links stay plain");
});

test("calendar links open the same plan in any browser", () => {
  const ics = calendar.buildPlanCalendar(
    { cook: ["2026-10-06"], frozen: [], end: "2026-10-12", device },
    { origin: "https://mise.ermizinm.ru", now },
  );
  const unfolded = ics.replaceAll("\r\n ", "");
  assert.match(unfolded, new RegExp(`URL:https://mise\\.ermizinm\\.ru/#plan=${device}\r\n`));
  assert.match(unfolded, new RegExp(`URL:https://mise\\.ermizinm\\.ru/\\?utm_source=calendar#plan=${device}\r\n`));
});

test("the plan offers the calendar after saving and in reminder settings", async () => {
  const [page, setup, route, css, product] = await Promise.all([
    read("app/page.tsx"),
    read("app/notification-setup.tsx"),
    read("app/api/calendar/route.ts"),
    read("app/globals.css"),
    read("PRODUCT.md"),
  ]);
  const successSheet = page.slice(page.indexOf("function SuccessSheet("));
  assert.match(
    successSheet.slice(0, 2_500),
    /<CalendarExportLink\s+plan=\{notificationPlanFor\(plan\)\}\s+device=\{clientId\(\)\}\s+primary\s+\/>/,
  );
  assert.ok(
    successSheet.indexOf("<CalendarExportLink") < successSheet.indexOf("Открыть план"),
    "the calendar comes before opening the plan",
  );
  assert.match(setup, /<CalendarExportLink plan=\{plan\} device=\{clientId\} \/>/);
  assert.match(setup, /target="_blank"/);
  assert.match(setup, /mise:calendar-exported/);
  assert.match(page, /trackAnalytics\("calendar_exported"\)/);
  assert.match(page, /source: acquisitionSource\(\s*location\.search,\s*document\.referrer,\s*location\.hostname,\s*readInstallEnvironment\(\)\.installed,\s*\)/);
  assert.match(route, /"Content-Type": "text\/calendar; charset=utf-8"/);
  assert.match(css, /\.calendar-export-link \{/);
  assert.match(product, /Добавить в календарь/);
});

test("search engines can find the public entry page", async () => {
  const [robots, sitemap] = await Promise.all([read("public/robots.txt"), read("public/sitemap.xml")]);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/pilot-analytics/);
  assert.match(robots, /Sitemap: https:\/\/mise\.ermizinm\.ru\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/mise\.ermizinm\.ru\/<\/loc>/);
});

test("a calendar link adopts its device only where there is no plan of one's own", async () => {
  const page = await read("app/page.tsx");
  const constant = (name) => page.match(new RegExp(`const ${name} =[\\s\\S]*?;\\n`))[0];
  const fn = (name) => {
    const start = page.indexOf(`function ${name}(`);
    const end = page.indexOf("\n}\n", start);
    return page.slice(start, end + 3);
  };
  const source = [
    "onboardingStorageKey",
    "onboardingProgressKey",
    "analyticsStoragePrefix",
    "localPlanStoragePrefix",
    "pendingPlanStoragePrefix",
    "clientIdStorageKey",
    "calendarDevicePattern",
  ].map(constant).join("")
    + "let calendarDeviceChecked = false;\n"
    + ["adoptCalendarDevice", "localPlanKey", "pendingPlanKey", "analyticsKey"].map(fn).join("\n")
    + "\nmodule.exports = { adoptCalendarDevice };";
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const run = (hash, stored) => {
    const store = new Map(Object.entries(stored));
    const location = { hash, pathname: "/", search: "?utm_source=calendar" };
    const replaced = [];
    const exports = {};
    const sandboxModule = { exports };
    vm.runInNewContext(output, {
      module: sandboxModule,
      exports,
      location,
      history: { state: null, replaceState: (_state, _title, url) => replaced.push(url) },
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
      },
      clientId: () => { throw new Error("must not create an id while adopting"); },
    });
    sandboxModule.exports.adoptCalendarDevice();
    sandboxModule.exports.adoptCalendarDevice();
    return { store: Object.fromEntries(store), replaced };
  };
  const other = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

  const fresh = run(`#plan=${device}`, {});
  assert.equal(fresh.store["mise-client-id"], device);
  assert.equal(fresh.store["mise-onboarding-v3"], "complete");
  assert.equal(fresh.store["mise-analytics-v1:sent:first-open"], "1");
  assert.deepEqual(fresh.replaced, ["/?utm_source=calendar"], "the key leaves the address bar once");

  const emptyBrowser = run(`#plan=${device}`, { "mise-client-id": other, "mise-onboarding-progress-v4": "batches" });
  assert.equal(emptyBrowser.store["mise-client-id"], device);
  assert.equal(emptyBrowser.store["mise-onboarding-progress-v4"], undefined);

  const ownPlan = run(`#plan=${device}`, { "mise-client-id": other, [`mise-local-plan-v1:${other}`]: "{}" });
  assert.equal(ownPlan.store["mise-client-id"], other, "a plan made in this browser is kept");
  assert.equal(ownPlan.store["mise-onboarding-v3"], undefined);

  const pending = run(`#plan=${device}`, { "mise-client-id": other, [`mise-pending-plan-v1:${other}`]: "{}" });
  assert.equal(pending.store["mise-client-id"], other);

  const noKey = run("#plan=not-a-uuid", {});
  assert.equal(noKey.store["mise-client-id"], undefined);
  assert.deepEqual(noKey.replaced, []);

  assert.match(page, /function clientId\(\) \{\s*adoptCalendarDevice\(\);/);
  assert.match(page, /adoptCalendarDevice\(\);\s*if \(dedupeKey && analyticsWasSent\(dedupeKey\)\) return true;/);
});

test("the week offers the calendar until it was added for this plan", async () => {
  const [page, setup] = await Promise.all([read("app/page.tsx"), read("app/notification-setup.tsx")]);
  assert.match(setup, /export function calendarAddedKey\(planId: string\) \{\s*return `mise-calendar-added-v1:\$\{planId\}`;/);
  assert.match(setup, /localStorage\.setItem\(calendarAddedKey\(plan\.id\), "1"\)[\s\S]{0,140}mise:calendar-exported/);
  const week = page.slice(page.indexOf("function WeekScreen("), page.indexOf("function WeekScreen(") + 40_000);
  assert.match(week, /localStorage\.getItem\(calendarAddedKey\(plan\.id\)\) === "1"/);
  assert.match(week, /addEventListener\("mise:calendar-exported", onExported\)/);
  assert.match(
    week,
    /\{!planEnded && !planEndingSoon && !calendarAdded && \([\s\S]{0,700}<CalendarExportLink\s+plan=\{notificationPlanFor\(plan\)\}\s+device=\{clientId\(\)\}\s+primary\s+\/>/,
  );
});
