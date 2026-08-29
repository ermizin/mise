import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("onboarding follows the supplied directional and staggered motion", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /Math\.abs\(dx\) < 40/);
  assert.match(page, /motion-enter-left/);
  assert.match(page, /motion-enter-right/);
  assert.match(page, /className="onboarding-motion-bg"/);
  assert.match(css, /--motion-screen: 588ms/);
  assert.match(css, /--motion-stagger: 45ms/);
  assert.match(css, /mise-onb-deck-main 504ms/);
  assert.match(css, /mise-onb-panel 483ms/);
  assert.match(css, /mise-onb-breathe-a 13s/);
});

test("week execution animates the real optimistic actions", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /kind: "tick-in" \| "tick-out" \| "moving" \| "restoring"/);
  assert.match(page, /await waitForMotion\(260\)/);
  assert.match(page, /className="week-loading-macro glass-card"/);
  assert.match(page, /function AnimatedNumber/);
  assert.match(css, /mise-week-tick-in-a 300ms/);
  assert.match(css, /mise-week-row-out-a 260ms/);
  assert.match(css, /mise-toast-in-a 320ms/);
  assert.match(css, /stroke-dashoffset 520ms/);
});

test("catalog and tab navigation replay their supplied transitions", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /motionEpoch=\{tabMotion\.epoch\}/);
  assert.match(page, /className="bottom-nav-indicator"/);
  assert.match(page, /const \[gridMotionEpoch, setGridMotionEpoch\] = useState\(0\)/);
  assert.match(page, /animationDelay: `\$\{index \* 40\}ms`/);
  assert.match(css, /bottom-nav-indicator[\s\S]*?280ms var\(--motion-segment\)/);
  assert.match(css, /mise-tab-forward 320ms/);
  assert.match(css, /mise-catalog-grid-a 320ms/);
});

test("reduced motion keeps change visible without spatial movement", async () => {
  const css = await read("app/globals.css");
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /mise-motion-fade 160ms ease both !important/);
  assert.match(reduced, /bottom-nav-indicator[\s\S]*?transition: none !important/);
  assert.match(reduced, /mise-skeleton-breathe 1\.4s ease-in-out infinite !important/);
  assert.match(reduced, /transition-duration: 520ms !important/);
});
