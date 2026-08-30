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

test("week execution animates the remaining optimistic eating action", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /kind: "tick-in" \| "tick-out"/);
  assert.match(page, /className="week-loading-macro glass-card"/);
  assert.match(page, /function AnimatedNumber/);
  assert.match(css, /mise-week-tick-in-a 300ms/);
  assert.match(css, /stroke-dashoffset 520ms/);
  assert.doesNotMatch(page, /week-move-button/);
});

test("catalog and tab navigation replay their supplied transitions", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /bump=\{tabMotion\.bump\}/);
  assert.match(page, /key=\{tab\}[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby/);
  assert.match(page, /role="tablist"[\s\S]*?aria-label="Разделы"/);
  assert.match(page, /role="tab"[\s\S]*?aria-selected=\{selected\}[\s\S]*?aria-controls/);
  assert.match(page, /event\.key === "ArrowRight"/);
  assert.match(page, /event\.key === "ArrowLeft"/);
  assert.match(page, /event\.key === "Home"/);
  assert.match(page, /event\.key === "End"/);
  assert.match(page, /useLayoutEffect\([\s\S]*?restoreTabScroll/);
  assert.match(page, /behavior: "auto"/);
  assert.match(page, /history\.pushState\([\s\S]*?miseTab: next/);
  assert.match(page, /window\.addEventListener\("popstate"/);
  assert.match(
    page,
    /showCompose=\{tab === "week" && !activePlan && !loadingPlan\}/,
  );
  assert.match(page, /className="bottom-nav-indicator"/);
  assert.match(page, /const \[gridMotionEpoch, setGridMotionEpoch\] = useState\(0\)/);
  assert.match(page, /animationDelay: `\$\{index \* 40\}ms`/);
  assert.match(css, /bottom-nav-indicator[\s\S]*?280ms var\(--motion-segment\)/);
  assert.match(css, /transform: translateX\(calc\(var\(--tab\) \* 100%\)\)/);
  assert.match(css, /transition: color 200ms linear/);
  assert.match(css, /mise-tab-forward 320ms/);
  assert.match(css, /mise-fab-in 380ms var\(--motion-spring\) 120ms backwards/);
  assert.match(css, /compose-fab:active[\s\S]*?scale\(0\.965\)/);
  assert.match(css, /mise-catalog-grid-a 320ms/);
});

test("reduced motion keeps change visible without spatial movement", async () => {
  const css = await read("app/globals.css");
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /mise-motion-fade 160ms ease both !important/);
  assert.match(reduced, /bottom-nav-indicator[\s\S]*?transition: none !important/);
  assert.match(reduced, /bottom-nav button\.has-nav-effect-a[\s\S]*?animation: none !important/);
  assert.match(reduced, /week-loading-ring[\s\S]*?animation: none !important/);
  assert.match(reduced, /background-image: none/);
  assert.doesNotMatch(reduced, /mise-skeleton-breathe/);
  assert.match(reduced, /transition-duration: 520ms !important/);
});
