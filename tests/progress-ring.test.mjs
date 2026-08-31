import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("batch progress paints only the ring and leaves its center clear", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(page, /"--batch-progress": `conic-gradient/);
  assert.match(css, /\.batch-progress-ring::before[\s\S]*?mask: radial-gradient/);
  assert.doesNotMatch(
    css,
    /\.batch-progress-ring > span[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.92\)/,
  );
});

test("batch cooking buttons use the accessible action gradient", async () => {
  const css = await read("app/globals.css");

  assert.match(
    css,
    /--button-grad: linear-gradient\(150deg, #d2440f, #b3380a\);/,
  );
  assert.match(
    css,
    /\.primary-button \{[\s\S]*?background: var\(--button-grad\);[\s\S]*?\}/,
  );
});
