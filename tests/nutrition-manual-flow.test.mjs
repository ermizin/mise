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

test("изменение параметров тела сохраняет только estimate и не пересчитывает daily", () => {
  const patchBody = sourceBetween(
    "  function patchBody(patch: Partial<NutritionWizardInput>) {",
    "\n  return (",
  );

  assert.match(patchBody, /onUpdate\(\s*person\.id/);
  assert.match(patchBody, /estimate:\s*next/);
  assert.doesNotMatch(
    patchBody,
    /daily:\s*target/,
    "patchBody не должен менять daily до явного нажатия «Рассчитать»",
  );
});

test("калькулятор имеет явную кнопку Рассчитать и отдельный обработчик", () => {
  assert.match(page, /calculateNutritionTarget/);
  assert.match(page, /Рассчитать/);
  assert.match(
    page,
    /onClick=\{\(\)\s*=>[\s\S]{0,500}(?:calculate|onCalculate)[\s\S]{0,500}\}/,
    "у кнопки должен быть явный обработчик расчёта",
  );
});

test("старые переключатели ручного режима удалены", () => {
  assert.doesNotMatch(page, /Внести своё/);
  assert.doesNotMatch(page, /Ввести своё/);
  assert.doesNotMatch(page, /Вернуть расчёт Mise/);
});

test("ручное редактирование макросов включает manual, а расчёт — auto", () => {
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
    /function onCalculate\(\)[\s\S]{0,500}nutritionTargetMode:\s*["']auto["']/,
    "явный расчёт должен возвращать автоматический режим",
  );
  assert.match(peopleStep, />\s*Рассчитать\s*</);
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
