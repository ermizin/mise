import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the 2026-08-31 audit fixes keep the core flow compact and legible", async () => {
  const [page, css, pluralSource] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
    read("lib/plural.ts"),
  ]);

  assert.match(css, /--button-grad: var\(--accent-grad\)/);
  assert.match(css, /\.builder-chat-history \.chat-bubble\.is-user \{[\s\S]*?background: var\(--button-grad\)/);
  assert.match(css, /\.builder-shell::before \{[\s\S]*?rgba\(251, 248, 241, 0\.99\)/);
  assert.match(page, /completedChatTurns\.slice\(-1\)/);
  assert.match(page, /Показать предыдущие ответы/);
  assert.match(page, /Нужно ваше решение[\s\S]*?Выберите, что делать с остатком дней/);
  assert.match(page, /id="builder-composer-status" role="status" aria-live="polite"/);
  assert.match(css, /\.remainder-sheet\.needs-decision/);
  assert.match(page, /function formatMacro\(value: number\)/);
  assert.match(pluralSource, /function genitiveAfterNumber/);
  assert.match(page, /genitiveAfterNumber\([\s\S]{0,100}\["порции", "порций"\]/);
  assert.match(page, /className="screen app-boot-loading"/);
  assert.match(page, /className=\{loadedPhoto === photo \? "is-loaded" : "is-loading"\}/);
  assert.match(css, /\.cooking-batch-shell \{[\s\S]*?padding: 0 18px calc\(148px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(page, /система в установленном приложении/);
  assert.doesNotMatch(page, /className="install-kicker"/);
  assert.ok(page.indexOf("Открыть план") < page.indexOf("Настроить напоминания"));
});

test("cooked weights persist and finish the batch through portioning", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /cookedWeights\?: Record<string, CookedWeights>/);
  assert.match(page, /cookedWeightsKey\(batch, dish\.slot, dish\.recipe\.id\)/);
  assert.match(page, /savePortioningAndComplete/);
  assert.match(page, /cookedWeights: \{ \.\.\.plan\.cookedWeights, \.\.\.cookedWeights \}/);
  assert.match(page, /Раскладка готова — завершить/);
  assert.match(page, /plan\?\.cookedWeights\?\.\[cookedKey\]/);
  assert.match(page, /Сохранить раскладку/);
});

test("plan edits survive offline and replay without mixing client caches", async () => {
  const [page, worker] = await Promise.all([
    read("app/page.tsx"),
    read("public/sw.js"),
  ]);
  assert.match(page, /mise-local-plan-v1/);
  assert.match(page, /mise-pending-plan-v1/);
  assert.match(page, /window\.addEventListener\("online", flushPendingPlan\)/);
  assert.match(page, /Нет сети — изменения сохранены на устройстве/);
  assert.match(worker, /PLAN_CACHE_NAME = "mise-plan-v3"/);
  assert.match(worker, /planCacheKey\(clientId\)/);
  assert.match(worker, /mise:clear-plan-cache/);
  assert.match(worker, /mise-client=\$\{encodeURIComponent\(clientId \|\| "anonymous"\)\}/);
  assert.match(worker, /JSON\.stringify\(\{ error: "offline", plan: null \}\)/);
});

test("settings have a separate restorable draft and hardware back trap", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /activeBuilderDraftKey/);
  assert.match(page, /:settings:\$\{initialPlan\?\.id \?\? "new"\}:\$\{initialStep\}/);
  assert.match(page, /mise: "builder"[\s\S]*?builderStep:/);
  assert.match(page, /event\.state\?\.mise === "builder"/);
  assert.match(page, /localStorage\.getItem\(activeBuilderDraftKey\)/);
  assert.match(page, /localStorage\.setItem\(activeBuilderDraftKey/);
  assert.doesNotMatch(page, /if \(mode === "settings"\) return;\s*history\.pushState/);
});

test("audit accessibility and daily-use regressions stay fixed", async () => {
  const [page, css, icons] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
    read("app/ui/icon.tsx"),
  ]);
  assert.match(css, /\.primary-button \{[\s\S]*?background: var\(--button-grad\)/);
  assert.match(page, /eatenMacros\.kcal \/ Math\.max\(1, person\.daily\.kcal\)/);
  assert.match(page, /setUnassignedConfirmOpen\(true\)/);
  assert.match(page, /Mise не будет удалять их молча/);
  assert.match(page, /timerEndsAt - Date\.now\(\)/);
  assert.match(page, /wakeLock[\s\S]{0,40}\?\.request\("screen"\)/);
  assert.match(page, /navigator\.vibrate/);
  const exposesNextDayMove = /<Icon name="next-day"/.test(page);
  if (exposesNextDayMove) {
    assert.match(page, /className="week-move-reason"/);
    assert.match(icons, /\| "next-day"/);
  } else {
    assert.doesNotMatch(page, /className="week-move-reason"/);
  }
  assert.match(page, /Number\(left\.checked\) - Number\(right\.checked\)/);
  assert.match(page, /setUndoLabel\(previous\.checked \? "Отметка снята" : "Отмечено купленным"\)/);
  assert.match(page, /Собрать следующий заранее/);
  assert.match(page, /onAddPerson=\{addPerson\}/);
  assert.match(page, /withPlural\(rawDays, FORMS\.day\)/);
});

test("dead and misleading UI patterns from the audit do not return", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.doesNotMatch(css, /min-width:\s*100000px/);
  assert.doesNotMatch(css, /blur\(13px\)/);
  assert.match(css, /\.week-person-select \{[\s\S]*?font-size: var\(--text-input\)/);
  assert.doesNotMatch(page, /scrollIntoView\(/);
  assert.match(page, /strip\.scrollLeft = Math\.max/);
  assert.doesNotMatch(page, /Собрать заново<\/button>[\s\S]{0,120}role="checkbox"/);
  assert.match(page, /recipeFamilyFor\(recipe\) \? \(/);
  assert.match(page, /Точная подстройка пока недоступна/);
  assert.doesNotMatch(page, /averagePieceWeightGrams|pieceEstimate/);
});

test("visual release blockers and high-impact P1 regressions stay fixed", async () => {
  const [page, css, layout, icons] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
    read("app/layout.tsx"),
    read("app/ui/icon.tsx"),
  ]);

  assert.match(
    css,
    /\.style-card \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 30px;/,
    "menu-style copy owns the flexible column instead of the old 48px icon column",
  );
  assert.match(
    css,
    /@media \(max-width: 430px\) \{[\s\S]*?\.date-fields \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);[\s\S]*?\.date-fields > \.icon \{[\s\S]*?display: none;/,
    "both period fields remain visible through the widest phone breakpoint",
  );
  assert.match(
    css,
    /@media \(max-width: 360px\) \{[\s\S]*?\.date-fields \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    "the narrowest supported screen gives each full date its own row",
  );
  assert.match(css, /\.person-dot \{[\s\S]*?display: grid;[\s\S]*?place-items: center;/);
  assert.match(layout, /viewportFit: "cover"/, "safe-area CSS receives real iOS insets");
  assert.match(layout, /content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(css, /\.week-meal-thumb \{[\s\S]*?position: relative;[\s\S]*?place-items: stretch;/);
  assert.match(css, /\.week-meal-thumb img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  assert.match(css, /\.manual-menu-art \{[\s\S]*?position: relative;/);
  assert.match(css, /\.manual-menu-art img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  assert.match(css, /\.btn-primary \{[\s\S]*?background: var\(--button-grad\)/);
  assert.match(css, /\.primary-button \{[\s\S]*?min-height: var\(--hit-primary\)[\s\S]*?background: var\(--button-grad\)/);
  assert.match(css, /--accent-text: #b3380a/);
  assert.match(css, /--mint-text: #1c7359/);
  assert.match(css, /\.secondary-button\.btn-danger \{[\s\S]*?color: var\(--danger-text\)/);
  assert.match(page, /showCompose=\{tab === "week" && !activePlan && !loadingPlan\}/, "compose action is limited to an empty loaded week");
  assert.match(
    page,
    /className=\{`manual-menu-art[\s\S]{0,160}<RecipeMedia recipe=\{recipe\} \/>/,
    "the wizard reuses the recipe photo with the same fallback as the catalog",
  );
  const profile = page.slice(page.indexOf("function ProfileScreen("), page.indexOf("function PlanBuilder("));
  assert.ok(
    profile.indexOf("Оставить план") < profile.indexOf("secondary-button btn-danger delete-plan-confirm"),
    "the safe action precedes the destructive action",
  );
  assert.match(page, /className="screen app-boot-loading"/);
  assert.match(page, /Готовим приложение…/);
  assert.match(icons, /snowflake: \[[\s\S]*?M22 12h-6\.5L14 15/);
});
