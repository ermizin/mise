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

  const labels = ["План на неделю", "Рецепты", "Составить план", "Покупки", "Профиль"];
  const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("includes the complete plan-builder and private persistence model", async () => {
  const [page, route, schema, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plans/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const step of ["Период", "Приёмы пищи", "Вид меню", "Люди и цели", "Готовка", "Выбор меню", "Проверка"]) assert.match(page, new RegExp(step));
  for (const style of ["Высокобелковое", "Бюджетное", "Палео", "Кето"]) assert.match(page, new RegExp(style));
  assert.match(page, /Приготовить остаток отдельно/);
  assert.match(page, /Выберите один из пяти вариантов/);
  assert.match(page, /Подпишите имя, приём пищи и даты/);
  assert.match(page, /buildShopping/);
  assert.match(page, /X-Mise-Client/);

  assert.match(route, /where\(eq\(mealPlans\.clientId, clientId\)\)/);
  assert.match(route, /id: `\$\{clientId\}:\$\{body\.plan\.id\}`/);
  assert.match(schema, /clientId: text\("client_id"\)\.notNull\(\)/);
  assert.match(layout, /images: \[\{ url: "\/og\.png"/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /backdrop-filter: blur\(26px\)/);
});
