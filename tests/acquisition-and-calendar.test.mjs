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
});

test("the server accepts a channel only on first_open and only from the list", () => {
  const { parseAnalyticsEvent } = analytics;
  const base = { eventId, occurredAt: now };
  const accepted = parseAnalyticsEvent({ ...base, eventName: "first_open", source: "habr" }, now);
  assert.equal(accepted.event.source, "habr");
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

test("the calendar link carries only plan dates", () => {
  const path = calendar.planCalendarPath({
    end: "2026-10-12",
    batches: [{ start: "2026-10-06" }, { start: "2026-10-09" }, { start: "2026-10-09" }],
    frozenUseDates: ["2026-10-11", "2026-10-11"],
  });
  const url = new URL(path, "https://mise.ermizinm.ru");
  assert.equal(url.pathname, "/api/calendar");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["cook", "end", "frozen"]);
  assert.equal(url.searchParams.get("cook"), "2026-10-06,2026-10-09");
  assert.equal(url.searchParams.get("frozen"), "2026-10-11");
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
  assert.match(successSheet.slice(0, 2_000), /<CalendarExportLink plan=\{notificationPlanFor\(plan\)\} \/>/);
  assert.match(setup, /<CalendarExportLink plan=\{plan\} \/>/);
  assert.match(setup, /target="_blank"/);
  assert.match(setup, /mise:calendar-exported/);
  assert.match(page, /trackAnalytics\("calendar_exported"\)/);
  assert.match(page, /source: acquisitionSource\(\s*location\.search,\s*document\.referrer,\s*location\.hostname,\s*\)/);
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
