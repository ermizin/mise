import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shoppingStart = page.indexOf("function ShoppingScreen");
const shoppingEnd = page.indexOf("function ProfileScreen", shoppingStart + 10);
const shopping = page.slice(shoppingStart, shoppingEnd === -1 ? undefined : shoppingEnd);

test("shopping follows the handoff header and controls", () => {
  assert.match(shopping, /Покупки/);
  assert.match(shopping, /withPlural\(plan\.people\.length, FORMS\.person\)/);
  assert.match(shopping, /share|поделиться|⇪/i);
  assert.match(shopping, /Куплено/);
  assert.match(shopping, /Осталось групп/);
  assert.match(shopping, /progress-(?:bar|track)/);
  assert.match(shopping, />\s*Все\s*</);
  assert.match(shopping, /Не куплено/);
  assert.match(shopping, /Партия 1/);
});

test("shopping groups expose checked totals", () => {
  assert.match(shopping, /checked/);
  assert.match(shopping, /filter\(\(item\) => item\.checked\)\.length/);
  assert.match(shopping, /\(allGroups\[group\] \?\? items\)\.length/);
});

test("shopping does not expose deprecated progress ring or label reminders", () => {
  assert.doesNotMatch(shopping, /progress-ring/);
  assert.doesNotMatch(shopping, /label-reminder/);
  assert.doesNotMatch(shopping, /Проверяйте этикетку/);
  assert.doesNotMatch(shopping, /Проверить состав и следы/);
  assert.doesNotMatch(shopping, /проверить этикетку\/следы/);
  assert.doesNotMatch(shopping, /sourceQuery/);
  assert.doesNotMatch(shopping, /fitScore\([^)]*\).*%/);
  assert.doesNotMatch(css, /\.progress-ring\b/);
});
