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
  assert.doesNotMatch(css, /--motion-stagger:/);
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
  assert.match(page, /className="screen app-boot-loading"/);
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
  assert.match(page, /gridMotionEpoch && index < 6/);
  assert.match(page, /animationDelay: `\$\{index \* 40\}ms`/);
  assert.match(css, /bottom-nav-indicator[\s\S]*?280ms var\(--motion-segment\)/);
  assert.match(css, /transform: translateX\(calc\(var\(--tab\) \* 100%\)\)/);
  assert.match(css, /transition: color 200ms linear/);
  assert.match(css, /mise-tab-forward 320ms/);
  assert.match(css, /mise-fab-in 380ms var\(--motion-spring\) 120ms backwards/);
  assert.match(css, /compose-fab:active[\s\S]*?scale\(0\.965\)/);
  assert.match(css, /mise-catalog-grid-a 320ms/);
});

test("guide and manual menu finish the remaining supplied motion", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /<PrepRulesScreen[\s\S]*?motionDirection=\{motionDirection\}/);
  assert.match(page, /<PrepKitchenScreen[\s\S]*?motionDirection=\{motionDirection\}/);
  assert.match(page, /className=\{`builder-step-content/);
  assert.match(page, /className=\{`manual-slot-panel/);
  assert.match(page, /--manual-delay/);
  assert.match(page, /manual-effect-a/);
  assert.match(page, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(css, /onboarding-shell\.is-guide \.rule-card:nth-child\(5\)/);
  assert.match(css, /mise-builder-answer 380ms/);
  assert.match(css, /mise-manual-slot-right/);
  assert.match(css, /mise-manual-card-in 320ms/);
  assert.match(css, /mise-manual-tick-in-a 300ms/);
  assert.match(css, /macro-bar i[\s\S]*?transition: width 420ms/);
});

test("manual menu choice stays available as a separate bottom action", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  const builder = page.slice(
    page.indexOf("function PlanBuilder("),
    page.indexOf("function StepIntro("),
  );

  assert.match(builder, /kind: "step" \| "menu"[\s\S]*?assemblyStage: number/);
  assert.match(
    builder,
    /if \(step === 4\) \{[\s\S]*?setMenuMode\("auto"\);[\s\S]*?assembleMenu\("fill"\);/,
    "the menu is assembled while the staged working state covers the form",
  );
  assert.match(
    builder,
    /step === 4 \? "menu" : "step"/,
  );
  assert.match(builder, /const menuRevealDelay = reducedMotion \? 60 : 220/);
  assert.match(
    builder,
    /const menuStageStartDelay =\s*menuRevealDelay \+ \(reducedMotion \? 80 : 320\)/,
  );
  assert.doesNotMatch(builder, /scrollIntoView\(/);
  assert.match(
    builder,
    /menuStageStartDelay \+ assemblyStage \* stageDuration/,
  );
  assert.match(builder, /builder-chat-current\$\{chatTransition\?\.kind === "menu"/);
  assert.match(builder, /const stageDuration = reducedMotion \? 140 : 420/);
  assert.match(builder, /const questionDelay = reducedMotion \? 140 : 560/);
  assert.match(builder, /className="builder-menu-assembly glass-3"/);
  assert.match(builder, /Считаю нормы/);
  assert.match(builder, /Подбираю блюда/);
  assert.match(builder, /Делю на партии/);
  assert.match(builder, /Собираю закупку/);
  assert.match(builder, /className="builder-chat-menu-ready tint-mint"/);
  assert.match(builder, /Mise собирает меню/);
  assert.match(builder, /Меню на/);
  assert.match(
    css,
    /\.builder-menu-assembly-progress span \{[\s\S]*?width 400ms var\(--motion-settled\)/,
  );
  assert.match(css, /mise-builder-stage-spin 900ms linear infinite/);
  assert.match(css, /mise-builder-stage-tick 300ms var\(--motion-spring\)/);
  assert.match(
    css,
    /\.builder-chat-current\.is-assembling-menu \{[\s\S]*?padding-bottom: clamp\(140px, 22vh, 200px\)/,
  );
  assert.match(
    css,
    /\.builder-chat-menu-ready \{[\s\S]*?mise-builder-menu-ready 460ms var\(--motion-settled\) 160ms/,
  );
  assert.match(builder, /const showManualMenuChoice =/);
  assert.match(builder, /className="builder-chat-alternative"/);
});

test("week days and batch cooking use directional keyed panels", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /function selectWeekDate\(nextDate: string\)/);
  assert.match(page, /className=\{`week-day-panel/);
  assert.match(page, /selectWeekDate\(nextCook\.start\)/);
  assert.match(page, /function replayCookingMotion\(direction: -1 \| 1\)/);
  assert.match(page, /className=\{`cooking-now-card glass-2 cooking-motion-panel/);
  assert.match(page, /className=\{`batch-portioning cooking-motion-panel/);
  assert.match(css, /mise-week-day-right 320ms/);
  assert.match(css, /mise-week-day-left 320ms/);
  assert.match(css, /mise-cooking-step-right 320ms/);
  assert.match(css, /mise-cooking-step-left 320ms/);
  assert.match(css, /mise-cooking-products 280ms/);
});

test("buttons keep the shared press response and accessible action color token", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /--button-grad: linear-gradient\(150deg, #d2440f, #b3380a\)/);
  assert.match(css, /button:active:not\(:disabled\)[\s\S]*?scale\(0\.985\)/);
  assert.match(css, /\.primary-button:not\(:disabled\):active[\s\S]*?scale\(0\.985\)/);
  assert.match(css, /\.compose-fab[\s\S]*?background: var\(--button-grad\)/);
  assert.match(css, /\.secondary-button[\s\S]*?var\(--motion-press\)/);
  assert.match(css, /\.text-button[\s\S]*?var\(--motion-press\)/);
});

test("reduced motion keeps change visible without spatial movement", async () => {
  const css = await read("app/globals.css");
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /mise-motion-fade 160ms ease both !important/);
  assert.match(reduced, /bottom-nav-indicator[\s\S]*?transition: none !important/);
  assert.match(reduced, /bottom-nav button\.has-nav-effect-a[\s\S]*?animation: none !important/);
  assert.match(reduced, /app-boot-progress i[\s\S]*?animation: none !important/);
  assert.match(reduced, /background-image: none/);
  assert.doesNotMatch(reduced, /mise-skeleton-breathe/);
  assert.match(reduced, /manual-slot-panel\.motion-enter-right/);
  assert.match(reduced, /builder-step-content\.motion-enter-right/);
  assert.match(reduced, /kit-row \.check-box svg[\s\S]*?transform: none !important/);
  assert.match(reduced, /week-day-panel\.motion-enter-right/);
  assert.match(reduced, /cooking-motion-panel\.motion-enter-right/);
  assert.match(reduced, /shopping-results\.has-filter-effect-a/);
  assert.match(reduced, /button:active:not\(:disabled\)[\s\S]*?transform: none !important/);
  assert.match(reduced, /transition-duration: 520ms !important/);
});
