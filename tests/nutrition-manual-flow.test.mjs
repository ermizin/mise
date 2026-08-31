import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start, end) {
  const startAt = page.indexOf(start);
  assert.notEqual(startAt, -1, `не найден блок ${start}`);
  const endAt = page.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `не найден конец блока ${end}`);
  return page.slice(startAt, endAt);
}

test("автоматическая норма пересчитывается вместе с параметрами тела", () => {
  const patchBody = sourceBetween(
    "  function patchBody(patch: Partial<NutritionWizardInput>) {",
    "\n  function resumeAutoCalculation()",
  );

  assert.match(patchBody, /calculateNutritionTarget\(next\)/);
  assert.match(patchBody, /estimate:\s*next/);
  assert.match(patchBody, /daily:\s*nextTarget/);
  assert.match(patchBody, /nutritionTargetMode:\s*["']auto["']/);
  assert.match(
    patchBody,
    /if \(manual \|\| !nextTarget\)[\s\S]{0,180}onUpdate\(person\.id, \{ estimate: next \}\)/,
    "ручная норма и последнее валидное автоматическое значение не должны перезаписываться",
  );
});

test("автосчёт не требует отдельной кнопки", () => {
  assert.match(page, /calculateNutritionTarget/);
  assert.doesNotMatch(page, />\s*(?:Рассчитать|Пересчитать)\s*</);
  assert.match(page, /считаю на лету/);
  assert.match(page, /showAutoCalculationFeedback/);
});

test("ручной режим включается отдельно и возвращается к формуле явно", () => {
  assert.match(page, /Ввести своё/);
  assert.match(page, /Считать Mise/);
  assert.match(page, /function enterManualMode\(\)[\s\S]{0,180}nutritionTargetMode:\s*["']manual["']/);
  assert.match(page, /function resumeAutoCalculation\(\)[\s\S]{0,400}nutritionTargetMode:\s*["']auto["']/);
  assert.match(page, /Считаю по вашему числу, формулу не применяю/);
});

test("ручное редактирование макросов сохраняет приоритет пользователя", () => {
  const macroHandlers = sourceBetween(
    "  function updateMacro(id: string, key: MacroKey, value: number) {",
    "\n  function applyMacroPreset",
  );
  assert.match(
    macroHandlers,
    /nutritionTargetMode:\s*["']manual["']/,
    "прямое редактирование должно сохранять приоритет ручной нормы",
  );
  const peopleStep = page.slice(page.indexOf("function PeopleStep({"));
  assert.match(
    peopleStep,
    /function resumeAutoCalculation\(\)[\s\S]{0,500}nutritionTargetMode:\s*["']auto["']/,
    "«Считать Mise» должно возвращать автоматический режим",
  );
  assert.match(peopleStep, /Считать Mise/);
});

test("объяснение пересчёта, чип и live-region не сохраняются в плане", () => {
  const peopleStep = page.slice(page.indexOf("function PeopleStep({"));
  assert.match(peopleStep, /updatedTimerRef[\s\S]{0,1200}4_000/);
  assert.match(peopleStep, /changeWindowTimerRef\.current = window\.setTimeout\([\s\S]{0,120}2_000/);
  assert.match(peopleStep, /role="status"[\s\S]{0,100}aria-live="polite"/);
  assert.match(peopleStep, /className=\{`norm-updated-chip[\s\S]{0,180}aria-hidden="true"/);
  assert.match(peopleStep, /Пересчитал:/);
});

test("при доступности менее половины рецептов показывается понятное предупреждение", () => {
  assert.match(
    page,
    /50%|половин[аыу][\s\S]{0,180}(?:рецепт|калори|приём)/i,
    "нужно предупредить о покрытии каталога ниже 50%",
  );
  assert.match(
    page,
    /(?:калори[йя]|калорийност[ьи])[\s\S]{0,220}(?:приём|рецепт)/i,
    "предупреждение должно быть про калорийность выбранных приёмов",
  );
  assert.doesNotMatch(
    page,
    /точн(?:ое|ого) совпадени[ея].*(?:БЖУ|белк|жир|углевод)/i,
    "нельзя обещать точное совпадение всех БЖУ",
  );
});
