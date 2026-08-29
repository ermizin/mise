import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(worker, /PLAN_CACHE_NAME = "mise-plan-v1"/);
  assert.match(worker, /mise-client=\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(worker, /JSON\.stringify\(\{ error: "offline", plan: null \}\)/);
});

test("settings have a separate restorable draft and hardware back trap", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /activeBuilderDraftKey/);
  assert.match(page, /:settings:\$\{initialPlan\?\.id \?\? "new"\}:\$\{initialStep\}/);
  assert.match(page, /history\.pushState\(\{ mise: "builder", mode \}, ""\)/);
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
  assert.match(css, /\.primary-button \{[\s\S]*?background: var\(--accent-grad-aa\)/);
  assert.match(page, /eatenMacros\.kcal \/ Math\.max\(1, plannedMacros\.kcal\)/);
  assert.match(page, /setUnassignedConfirmOpen\(true\)/);
  assert.match(page, /Mise не будет удалять их молча/);
  assert.match(page, /timerEndsAt - Date\.now\(\)/);
  assert.match(page, /wakeLock[\s\S]{0,40}\?\.request\("screen"\)/);
  assert.match(page, /navigator\.vibrate/);
  assert.match(page, /<Icon name="next-day"/);
  assert.match(page, /className="week-move-reason"/);
  assert.match(icons, /\| "next-day"/);
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
});
