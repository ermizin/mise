import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Russian Mise shell and navigation", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/i);
  assert.match(html, /<title>Mise — милпреп без суеты<\/title>/i);
  assert.match(html, /План на неделю/);
  assert.match(html, /Ищем сохранённый план/);

  const labels = ["Составить план", "План на неделю", "Рецепты", "Покупки", "Профиль"];
  const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("includes the complete plan-builder and private persistence model", async () => {
  const [page, route, schema, layout, css, manifestText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plans/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  for (const step of ["Период", "Приёмы пищи", "Вид меню", "Люди и цели", "Готовка", "Выбор меню", "Проверка"]) assert.match(page, new RegExp(step));
  for (const style of ["Высокобелковое", "Бюджетное", "Палео", "Кето"]) assert.match(page, new RegExp(style));
  assert.match(page, /Приготовить остаток отдельно/);
  assert.match(page, /Выберите один из пяти вариантов/);
  assert.match(page, /Сначала взвесьте готовую еду/);
  assert.match(page, /Фактический вес готового блюда/);
  assert.match(page, /buildShopping/);
  assert.match(page, /X-Mise-Client/);
  assert.match(page, /mise-onboarding-v2/);
  assert.match(page, /mise-builder-draft-v\d/);
  assert.match(page, /mise-prep-guide-offer-v1/);
  assert.match(page, /Питаться легко,/);
  assert.match(page, /Один план · три результата/);
  for (const result of ["План недели", "Общие покупки", "Готовка и контейнеры"]) assert.match(page, new RegExp(result));
  assert.match(page, /Нужна инструкция/);
  for (const topic of ["Подготовьте контейнеры", "Готовьте партиями", "Охладите и разложите", "Подпишите и уберите"]) assert.match(page, new RegExp(topic));
  assert.match(page, /Инструкция по милпрепу/);
  assert.match(page, /Добавить Mise на экран Домой/);
  assert.match(page, /Настроить напоминания/);
  assert.match(page, /КБЖУ и сроки хранения — полезные ориентиры/);
  assert.match(page, /Как работает Mise/);
  assert.match(page, /function editDayMenu\(batchId: string\)/);
  assert.match(page, /setBuilderEntry\(\{[\s\S]*?step: 5,[\s\S]*?batchId,[\s\S]*?returnTab: "week"/);
  assert.match(page, /onClick=\{\(\) => onEditMenu\(batch\.id\)\}/);
  assert.match(page, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(page, /function editPeople\(\)/);
  assert.match(page, /setBuilderEntry\(\{[\s\S]*?step: 3,[\s\S]*?returnTab: "profile"/);
  assert.match(page, /aria-label="Настроить людей и цели"\s+onClick=\{onConfigure\}/);
  assert.match(page, /navigate\(builderEntry\.returnTab \?\? "week"\)/);
  for (const preset of ["Сбалансировано", "Больше белка", "Больше углеводов", "Больше жиров"]) assert.match(page, new RegExp(preset));
  assert.match(page, /Автоматическое распределение/);
  assert.match(page, /recalculateDailyMacros/);
  assert.match(page, /macroPreset: "custom"/);
  assert.doesNotMatch(page, /mealsPerDay|Приёмов пищи в день/);
  for (const allergyCopy of [
    "Аллергия / мне нельзя",
    "Показать варианты из «не люблю»",
    "Риск перекрёстного контакта",
    "Проверяйте этикетку",
    "Mise не заявляет медицинскую безопасность блюда",
  ]) assert.match(page, new RegExp(allergyCopy));
  assert.match(page, /role="checkbox"/);
  assert.match(page, /aria-checked=\{active\}/);
  assert.match(page, /Ещё можно съесть/);
  assert.match(page, /никто не выбрал/);
  assert.match(page, /current\.filter\(\(slot\) => !unassignedSlots\.includes\(slot\)\)/);
  for (const event of [
    "first_open",
    "plan_create_started",
    "plan_created",
    "shopping_item_checked",
    "cooking_instructions_opened",
    "cooking_confirmed",
    "saved_plan_reopened",
    "next_plan_created",
  ]) assert.match(page, new RegExp(event));
  assert.match(page, /Отметить, что партия приготовлена/);

  assert.match(route, /where\(eq\(mealPlans\.clientId, clientId\)\)/);
  assert.match(route, /id: `\$\{clientId\}:\$\{body\.plan\.id\}`/);
  assert.match(schema, /clientId: text\("client_id"\)\.notNull\(\)/);
  assert.match(schema, /analyticsEvents = sqliteTable\("analytics_events"/);
  assert.match(layout, /images: \[\{ url: "\/og\.png"/);
  assert.match(layout, /applicationName: "Mise"/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /https:\/\/mise\.ermizinm\.ru/);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Mise");
  assert.equal(manifest.short_name, "Mise");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.onboarding-shell/);
  assert.match(css, /\.prep-offer/);
  assert.match(css, /\.prep-checklist/);

  // Стекло описано токенами, а не литералами: блюр приходит из --glass-*-blur.
  assert.match(css, /--glass-2-blur: blur\(28px\) saturate\(180%\)/);
  assert.match(css, /backdrop-filter: var\(--glass-2-blur\)/);

  // Шкалы. Ни одного литерального кегля и веса ниже слоя токенов;
  // радиус-литерал допустим ровно один — квадрат отметки в списке покупок.
  assert.equal(css.match(/font-size: *[0-9]/g), null, "кегль задаётся только токеном");
  assert.equal(
    (css.match(/font-weight: *[0-9]/g) ?? []).length,
    2,
    "числовой вес остаётся только в @font-face",
  );
  assert.equal(
    (css.match(/border-radius: *[0-9]+(\.[0-9]+)?px/g) ?? []).length,
    1,
    "радиус задаётся только токеном",
  );
  for (const [, size] of css.matchAll(/--(?:text|glyph)-[a-z0-9]+: *([0-9.]+)px/g)) {
    assert.ok(Number(size) >= 12, `кегль ${size}px ниже пола системы в 12px`);
  }

  // Поверхность одна: .glass / .glass-card — тот же L2, что и .glass-2.
  assert.match(css, /\.glass-2,\n\.glass,\n\.glass-card \{/);
  assert.doesNotMatch(css, /backdrop-filter: blur\(18px\) saturate\(150%\)/);

  // Note — один компонент вместо четырнадцати частных классов.
  assert.match(css, /\n\.note \{/);
  for (const dead of [
    "estimate-note", "inline-note", "inline-warning", "warning-line",
    "result-line", "calculation-note", "detail-note", "storage-card",
    "daily-balance", "schedule-summary", "notification-success",
    "notification-error", "tuner-error", "save-error",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} должен уйти в Note`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} должен уйти в Note`);
  }

  // Число теней не растёт: стекло описано уровнями, а не по месту.
  assert.ok(
    (css.match(/box-shadow:/g) ?? []).length <= 44,
    "тени задаются уровнями стекла, а не по месту",
  );
});
