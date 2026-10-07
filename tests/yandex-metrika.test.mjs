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
  vm.runInNewContext(output, { module: { exports }, exports, URL, URLSearchParams });
  return exports;
}

const metrika = await loadModule("lib/yandex-metrika.ts");

test("Metrika gets only the ad labels from the landing address", () => {
  const { metrikaLandingUrl } = metrika;
  assert.equal(
    metrikaLandingUrl(
      "https://mise.ermizinm.ru/?utm_source=yandex_direct&utm_medium=cpc&yclid=123&tab=week#plan=11111111-1111-4111-8111-111111111111",
    ),
    "https://mise.ermizinm.ru/?utm_source=yandex_direct&utm_medium=cpc&yclid=123",
  );
  assert.equal(metrikaLandingUrl("https://mise.ermizinm.ru/?tab=recipes"), "https://mise.ermizinm.ru/");
  assert.equal(metrikaLandingUrl("https://mise.ermizinm.ru/"), "https://mise.ermizinm.ru/");
});

test("Metrika goals are plan milestones, not every analytics event", () => {
  const { metrikaGoal } = metrika;
  assert.equal(metrikaGoal("plan_create_started"), "mise_plan_started");
  assert.equal(metrikaGoal("plan_created"), "mise_plan_saved");
  assert.equal(metrikaGoal("next_plan_created"), "mise_next_plan");
  for (const event of ["first_open", "shopping_item_checked", "wizard_step_viewed", "blocking_error", "toString"])
    assert.equal(metrikaGoal(event), null);
});

test("no Metrika goal id contains another, so «contains» goals do not double count", () => {
  const { metrikaGoal } = metrika;
  const ids = [
    "onboarding_completed",
    "plan_create_started",
    "plan_created",
    "next_plan_created",
    "calendar_exported",
    "cooking_confirmed",
    "app_installed",
  ].map(metrikaGoal);
  for (const id of ids) {
    assert.ok(id);
    for (const other of ids) if (other !== id) assert.equal(other.includes(id), false, `${other} contains ${id}`);
  }
});

test("Metrika runs without session recording and starts before the app strips the labels", async () => {
  const source = await read("lib/yandex-metrika.ts");
  assert.match(source, /webvisor: false/);
  assert.match(source, /clickmap: false/);
  assert.match(source, /defer: true/);
  const page = await read("app/page.tsx");
  const start = page.indexOf("startYandexMetrika();");
  const strip = page.indexOf('(key) => key.startsWith("utm_") || key === "yclid"');
  assert.ok(start > 0 && strip > start);
});
