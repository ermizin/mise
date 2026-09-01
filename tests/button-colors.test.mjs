import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readCss = () => readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("interactive actions use the approved design-code gradient", async () => {
  const css = await readCss();

  assert.match(css, /--accent-grad: linear-gradient\(150deg, #ff8143, #ee4c13\);/);
  assert.match(css, /--button-grad: var\(--accent-grad\);/);
  assert.doesNotMatch(css, /--accent-grad-aa/);

  for (const selector of [
    "\\.btn-primary",
    "\\.primary-button",
    "\\.quick-periods button\\.selected",
    "\\.day-scale button\\.selected",
    "\\.toggle-control\\.active",
    "\\.batch-step-list li\\.is-current > button",
  ]) {
    assert.match(
      css,
      new RegExp(`${selector} \\{[^}]*background: var\\(--button-grad\\);`, "s"),
      `${selector} uses the approved button color`,
    );
  }
});

test("large selected controls use the orange selection role", async () => {
  const css = await readCss();

  for (const selector of [
    "\\.builder-shell \\.builder-content \\.choice-card\\.selected",
    "\\.builder-shell \\.builder-content \\.style-card\\.selected",
    "\\.builder-shell \\.builder-content \\.remainder-sheet button\\.selected",
  ]) {
    assert.match(
      css,
      new RegExp(`${selector} \\{[^}]*border-color: var\\(--accent-select-border\\);[^}]*background: var\\(--accent-select-bg\\);`, "s"),
      `${selector} uses the approved selected-state colors`,
    );
  }

  assert.match(css, /\.week-eaten-check\[aria-checked="true"\]::before \{[^}]*var\(--mint\)/s);
  assert.match(css, /\.secondary-button\.btn-danger \{[^}]*background: var\(--danger-bg\)/s);
});
