import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("batch progress stays in the header and is not repeated in the summary", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(page, /className="cooking-batch-progress"/);
  assert.match(page, /style=\{\{ width: `\$\{progressPercent\}%` \}\}/);
  assert.doesNotMatch(page, /className="batch-progress-ring"|className="batch-summary-tiles"/);
  assert.doesNotMatch(css, /\.batch-progress-ring|\.batch-summary-tiles/);
});

test("batch cooking buttons use the lighter design gradient", async () => {
  const css = await read("app/globals.css");

  assert.match(
    css,
    /--button-grad: var\(--accent-grad\);/,
  );
  assert.match(
    css,
    /\.primary-button \{[\s\S]*?background: var\(--button-grad\);[\s\S]*?\}/,
  );
});
