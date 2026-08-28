import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the wizard keeps the user's work", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /const builderDraftKey = "mise-builder-draft/, "the draft has a storage key");
  assert.match(page, /localStorage\.setItem\(builderDraftKey/, "the draft is written while the wizard is open");
  assert.match(page, /localStorage\.getItem\(builderDraftKey/, "the draft is restored on the next open");
  assert.doesNotMatch(page, /setSelections\(\{\}\)/, "editing a plan never wipes every menu pick");
  assert.match(page, /const validSelections =/, "picks are pruned to what still fits");
  assert.ok(
    page.indexOf("const validSelections =") < page.indexOf("const allSelected ="),
    "selection validity is initialized before the wizard reads it",
  );
});

test("the hardware back button stays inside the app", async () => {
  const page = await read("app/page.tsx");
  const listeners = page.match(/addEventListener\("popstate"/g) ?? [];
  assert.ok(listeners.length >= 2, "the wizard and the recipe card both trap back");
  assert.match(page, /history\.pushState\(\{ mise: "builder" \}/);
  assert.match(page, /history\.pushState\(\{ mise: "recipe" \}/);
});

test("the week screen answers what to do today", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /clampDate\(today, plan\.start, plan\.end\)/, "the week opens on today");
  assert.match(page, /Повторить план/, "a finished plan offers the next cycle");
  assert.match(page, /today-dot/, "today is marked in the date strip");
  assert.match(page, /Вечером переложите в холодильник/, "frozen portions are announced a day ahead");
  assert.doesNotMatch(page, /name: index === 0 \? "Максим"/, "no personal name is hardcoded");
});

test("a failed shopping tick is visible", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /Отметка не сохранилась/, "a failed save is reported");
  assert.match(page, /Снять отметки/, "the list can be cleared");
  assert.match(page, /undo-bar/, "clearing can be undone");
});

test("goals can be estimated as well as typed", async () => {
  const [page, nutrition] = await Promise.all([read("app/page.tsx"), read("domain/nutrition.ts")]);
  assert.match(nutrition, /function calculateNutritionTarget/, "the calculator exists");
  assert.match(nutrition, /10\s*\*\s*input\.weight\s*\+\s*6\.25\s*\*\s*input\.height\s*-\s*5\s*\*\s*input\.age/, "Mifflin-St Jeor");
  assert.match(nutrition, /energyPerKgWeightChange: 7_700/, "monthly weight change uses an explicit energy conversion");
  assert.match(page, /Рассчитать мою норму/, "the second path is offered");
  assert.match(page, /Ориентир|Ориентировочный/, "the estimate is framed as an orientation");
});

test("the interface stays legible", async () => {
  const [page, css, layout] = await Promise.all([read("app/page.tsx"), read("app/globals.css"), read("app/layout.tsx")]);
  const tiny = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1])).filter((size) => size < 11);
  assert.deepEqual(tiny, [], "nothing is smaller than 11px");
  assert.match(css, /--accent-grad-a: #c2410c/, "the primary button passes contrast");
  assert.match(css, /\.primary-button \{[\s\S]*?var\(--accent-grad-a\),\s*var\(--accent-grad-b\)/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/, "a dark theme exists");
  assert.match(layout, /statusBarStyle: "default"/, "the iOS status bar stays readable");
  assert.doesNotMatch(page, /aria-pressed=\{origin === "parsed"\}/, "radio groups expose radios");
});
