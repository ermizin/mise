import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("completed batch steps keep the same reserved marker geometry", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  const markerRule = css.match(/\.batch-step-list li > button \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(page, /data-step-digits=\{String\(absoluteIndex \+ 1\)\.length\}/);
  assert.match(markerRule, /width:\s*28px/);
  assert.match(markerRule, /min-width:\s*28px/);
  assert.match(markerRule, /height:\s*28px/);
  assert.match(markerRule, /min-height:\s*28px/);
  assert.match(markerRule, /padding:\s*0/);
  assert.match(markerRule, /line-height:\s*1/);
  assert.match(css, /button\[data-step-digits="3"\][\s\S]*?font-size:\s*var\(--text-min\)/);
});

test("number, check and text always occupy the same three-column row", async () => {
  const css = await read("app/globals.css");
  const rowRule = css.match(/\.batch-step-list li \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(rowRule, /grid-template-columns:\s*28px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.batch-step-list li\.is-complete > button \{/);
});
