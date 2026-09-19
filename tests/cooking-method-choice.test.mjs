import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("recipe card shows equipment and a sequential original recipe flow", () => {
  assert.match(page, /<p className="kicker">Утварь<\/p>/u);
  assert.match(page, /Исходный способ недоступен/u);
  assert.match(page, /Добавьте нужную утварь в плане или замените блюдо/u);
  assert.match(page, /<ol className="cooking-steps">/u);
  assert.doesNotMatch(page, /<CookingMethodSelect/u);
  assert.doesNotMatch(page, /recipe-timeline/u);
  assert.match(styles, /\.recipe-detail \.detail-header > span \{[\s\S]*?overflow-wrap: normal;[\s\S]*?white-space: normal;/u);
});
