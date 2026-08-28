import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Russian counters use the correct plural form", async () => {
  const source = await read("app/format.ts");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const format = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  assert.equal(format.countRu(1, "день", "дня", "дней"), "1 день");
  assert.equal(format.countRu(2, "день", "дня", "дней"), "2 дня");
  assert.equal(format.countRu(5, "день", "дня", "дней"), "5 дней");
  assert.equal(format.countRu(11, "день", "дня", "дней"), "11 дней");
  assert.equal(format.countRu(21, "день", "дня", "дней"), "21 день");
});

test("keeps the established visual system while retaining behavior fixes", async () => {
  const [page, css, layout, packageText, notifications] = await Promise.all([
    read("app/page.tsx"), read("app/globals.css"), read("app/layout.tsx"), read("package.json"), read("app/notification-setup.tsx"),
  ]);
  assert.doesNotMatch(layout, /fontsource|Inter Variable/);
  assert.doesNotMatch(packageText, /fontsource/);
  assert.doesNotMatch(page, /RecipeArtwork|builder-step-labels|success-check/);
  assert.doesNotMatch(css, /mask-image: linear-gradient|--surface: #fffdf9/);

  assert.ok(page.indexOf("const validSelections") < page.indexOf("const allSelected"));
  assert.match(page, /role="checkbox" aria-checked=\{item\.checked\}/);
  assert.match(page, /role="checkbox" aria-checked=\{active\}/);
  assert.match(notifications, /role="switch" aria-checked=\{active\}/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /previousFocus\?\.focus\(\)/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /\[step, choiceIndex\]/);
  assert.match(page, /if \(previous\) setActivePlan\(previous\)/);
});
