import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, css] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);
const { withPlural, FORMS } = await loadTypeScriptModule(new URL("../lib/plural.ts", import.meta.url));

const cookingStep = page.slice(
  page.indexOf("function CookingStep("),
  page.indexOf("/* Шаг «Выбор меню»"),
);

test("the cooking step shows its own question and the required decision before the kitchen list", () => {
  assert.ok(cookingStep.length > 0, "the cooking step is present");
  const intro = cookingStep.indexOf('title="На сколько дней готовим за раз?"');
  const rhythm = cookingStep.indexOf('className="day-scale"');
  const decision = cookingStep.indexOf("remainder-sheet glass-card");
  const kitchenWarning = cookingStep.indexOf("kitchenGaps.length > 0 &&");
  const kitchen = cookingStep.indexOf('className="kitchen-equipment glass-card"');
  assert.ok(intro >= 0 && rhythm > intro, "the rhythm control answers the question right under it");
  assert.ok(decision > rhythm, "the decision about the leftover days follows the rhythm");
  assert.ok(kitchenWarning > decision && kitchen > kitchenWarning, "the preselected kitchen list comes last, under its own warning");
  assert.match(cookingStep, /Добавьте доступную технику ниже/, "the warning points at where the list now is");
  assert.doesNotMatch(cookingStep, /технику выше/);
});

test("leftover days are counted in correct Russian", () => {
  assert.match(cookingStep, /\{withPlural\(periodDays, FORMS\.day\)\} не делятся на/);
  assert.match(cookingStep, /Последний блок — \{withPlural\(remainder, FORMS\.day\)\}/);
  assert.doesNotMatch(cookingStep, /\{periodDays\} дней не делятся/, "«3 дней» is not Russian");
  assert.doesNotMatch(cookingStep, /remainder === 1 \? "день" : "дня"/, "«5 дня» is not Russian");
  assert.deepEqual(
    [1, 3, 5, 6, 11, 13].map((days) => withPlural(days, FORMS.day)),
    ["1 день", "3 дня", "5 дней", "6 дней", "11 дней", "13 дней"],
  );
});

test("a disabled answer button says why, on a phone as well", () => {
  const composer = page.slice(
    page.indexOf("const composerBlocker ="),
    page.indexOf("if (previewRecipe) return <RecipeView"),
  );
  assert.ok(composer.length > 0, "the wizard derives a blocker");
  assert.match(composer, /stepIsValid\(\)\s*\?\s*null/, "a valid step has no blocker");
  for (const reason of [
    "Выберите, что делать с остатком дней",
    "План можно составить на срок от 1 до 14 дней",
    "Нужна хотя бы одна позиция меню",
    "Каждому нужны имя, норма",
    "Добавьте технику или измените цели",
    "Выберите блюдо для каждой позиции",
  ]) assert.ok(composer.includes(reason), `reason is worded: ${reason}`);
  assert.match(composer, /composerBlocker \?\? \{\s*title: "Ваш ответ готов"/, "«ответ готов» is only said when it is");
  assert.match(
    page,
    /id="builder-composer-status" role="status" aria-live="polite" className=\{composerBlocker \? "is-blocking" : undefined\}/,
  );
  assert.match(page, /composerBlocker && !showManualMenuChoice \? " has-composer-blocker" : ""/);

  const compact = css.slice(css.indexOf("/* Keep the composer compact before its status column becomes too narrow. */"));
  const compactBlock = compact.slice(0, compact.indexOf("@media (max-width: 380px)"));
  assert.match(compactBlock, /\.builder-chat-composer > div \{\s*display: none;/, "the idle status stays hidden on a phone");
  assert.match(compactBlock, /\.builder-chat-composer > div\.is-blocking \{\s*display: grid;/, "the blocker does not");
  assert.ok(
    compactBlock.indexOf("div.is-blocking") > compactBlock.indexOf("> div {"),
    "the exception follows the rule it overrides",
  );
  assert.match(
    compactBlock,
    /\.builder-shell\.has-composer-blocker \.builder-content \{\s*padding-bottom: calc\(190px \+ env\(safe-area-inset-bottom\)\);/,
    "the taller composer does not cover the end of the step",
  );
});
