import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function formatModule() {
  const source = await read("app/format.ts");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("Russian counters handle 1, 2, 5 and the 11-14 exception", async () => {
  const { countRu } = await formatModule();
  const values = [1, 2, 4, 5, 11, 14, 21, 22, 25];
  assert.deepEqual(values.map((value) => countRu(value, "день", "дня", "дней")), ["1 день", "2 дня", "4 дня", "5 дней", "11 дней", "14 дней", "21 день", "22 дня", "25 дней"]);
  assert.deepEqual(values.map((value) => countRu(value, "порция", "порции", "порций")), ["1 порция", "2 порции", "4 порции", "5 порций", "11 порций", "14 порций", "21 порция", "22 порции", "25 порций"]);
  assert.deepEqual([1, 2, 4].map((value) => countRu(value, "человек", "человека", "человек")), ["1 человек", "2 человека", "4 человека"]);
  for (const forms of [["готовка", "готовки", "готовок"], ["блюдо", "блюда", "блюд"], ["контейнер", "контейнера", "контейнеров"], ["рецепт", "рецепта", "рецептов"], ["продукт", "продукта", "продуктов"], ["вариант", "варианта", "вариантов"], ["позиция", "позиции", "позиций"], ["блок", "блока", "блоков"], ["вечер", "вечера", "вечеров"], ["нарезка", "нарезки", "нарезок"], ["действие", "действия", "действий"], ["источник", "источника", "источников"]]) {
    assert.deepEqual([1, 2, 5].map((value) => countRu(value, ...forms)), [`1 ${forms[0]}`, `2 ${forms[1]}`, `5 ${forms[2]}`]);
  }
});

test("the ten design priorities stay represented in source", async () => {
  const [page, css, layout, notifications] = await Promise.all([read("app/page.tsx"), read("app/globals.css"), read("app/layout.tsx"), read("app/notification-setup.tsx")]);
  const tiny = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1])).filter((size) => size < 12);
  assert.deepEqual(tiny, [], "interface text is at least 12px");
  assert.match(layout, /@fontsource-variable\/inter/, "Inter is bundled locally");
  assert.match(css, /\.glass-card \{[^}]*background: var\(--surface\)/, "content cards are opaque");
  assert.match(css, /scroll-snap-type: x proximity/, "horizontal strips advertise and snap scrolling");
  assert.match(page, /function Modal\(/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /querySelectorAll<HTMLElement>\('[^']*button:not\(\[disabled\]\)/, "focus is trapped inside dialogs");
  assert.match(page, /role="checkbox" aria-checked=/);
  assert.match(page, /role="radio" aria-checked=/);
  assert.match(notifications, /role="switch" aria-checked=/);
  assert.doesNotMatch(page, /className="step-count"|className="progress-track"/, "the wizard has one progress indicator");
  assert.match(page, /\[step, choiceIndex\]/, "wizard steps reset scroll position");
  assert.match(page, /function RecipeArtwork/);
  assert.match(page, /sourcePhoto/, "source photos are limited to the detail artwork path");
  assert.doesNotMatch(page, /[▦⌑♨◷✦◎▤⌕⌘∑◒❄🔔]/u, "service glyphs use the shared SVG system");
});

test("valid menu picks are declared before wizard completion reads them", async () => {
  const page = await read("app/page.tsx");
  assert.ok(page.indexOf("const validSelections =") < page.indexOf("const allSelected ="));
});
