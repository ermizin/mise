import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function recipeSources() {
  const [page, engine, css, runtime] = await Promise.all([
    read("app/page.tsx"),
    read("domain/recipe-engine.ts"),
    read("app/globals.css"),
    read("data/recipe-runtime-catalog.json"),
  ]);
  return { page, engine, css, runtime: JSON.parse(runtime) };
}

test("14A projects timed recipe instructions and preserves their timeline order", async () => {
  const { page, engine, runtime } = await recipeSources();
  const source = `${page}\n${engine}`;

  assert.match(source, /type RecipeStep\s*=\s*\{[\s\S]*?text:\s*string;[\s\S]*?minutes:\s*number;[\s\S]*?hands:\s*boolean;[\s\S]*?at:\s*number;[\s\S]*?ingredientIds:\s*string\[\];/);
  assert.match(source, /instructions\??:\s*RecipeStep\[\]/, "runtime recipes retain structured instructions alongside legacy steps");

  const recipesWithInstructions = runtime.recipes.filter((recipe) => recipe.instructions?.length);
  assert.ok(recipesWithInstructions.length > 0, "the runtime projection contains timed instructions");
  for (const recipe of recipesWithInstructions) {
    let previousAt = -1;
    for (const step of recipe.instructions) {
      assert.equal(typeof step.text, "string", `${recipe.id}: step text`);
      assert.ok(Number.isFinite(step.minutes) && step.minutes > 0, `${recipe.id}: positive minutes`);
      assert.equal(typeof step.hands, "boolean", `${recipe.id}: hands is explicit`);
      assert.ok(Number.isFinite(step.at) && step.at >= previousAt, `${recipe.id}: at is monotonic`);
      previousAt = step.at;
    }
    const explicitTimes = recipe.recipeFamily.miseInstructions.filter(
      (step) => /\d+(?:[.,]\d+)?(?:\s*(?:–|-|до)\s*\d+(?:[.,]\d+)?)?\s*(?:сек|мин|ч(?:ас)?)/iu.test(step.text),
    );
    if (explicitTimes.length > 0) {
      assert.ok(
        recipe.instructions.some((step) => step.minutes > 0),
        `${recipe.id}: visible times are not projected as zero-minute steps`,
      );
    }
  }
  assert.match(
    engine,
    /recipeInstructionMinutes\([\s\S]{0,120}instruction\.duration,[\s\S]{0,80}instruction\.text/,
    "timeline falls back from structured duration to the visible instruction text",
  );
});

test("14A calculates the approved three-level difficulty in the engine", async () => {
  const { page, engine, runtime } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(engine, /RecipeEffortLevel\s*=\s*"low"\s*\|\s*"medium"\s*\|\s*"high"/, "the engine owns all three levels");
  assert.match(engine, /activeMinutes\s*<=\s*15\s*&&\s*cookware\s*<=\s*1/, "simple is at most 15 active minutes and one vessel");
  assert.match(engine, /activeMinutes\s*<=\s*30\s*\|\|\s*cookware\s*>=\s*2/, "medium follows the approved OR rule");
  assert.ok(runtime.recipes.every((recipe) => ["low", "medium", "high"].includes(recipe.effort.level)), "runtime keeps the engine difficulty level");
  assert.match(page, /level:\s*recipeEffortLevel\(activeMinutes, cookware\)/, "legacy estimation uses the engine helper");
  assert.match(page, /level:\s*recipeEffortLevel\([\s\S]{0,180}effortInputs\.cookware/, "legacy overrides are normalized through the engine");
  assert.match(recipeView, /const difficulty = cookingMethod\?\.difficulty \?\? recipe\.effort\.difficulty;/, "the card reads the selected method or original projected level");
  assert.doesNotMatch(recipeView, /recipeEffortDifficulty\(/, "difficulty is projected by the engine, never recalculated in the card");
  assert.doesNotMatch(recipeView, /recipe\.effort\.level\s*===/, "the UI never maps levels itself");
});

test("14A analytics distinguish opening, tab switching, and reaching cooking steps", async () => {
  const { page } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(page, /"recipe_opened"/);
  assert.match(page, /"recipe_tab_switched"/);
  assert.match(recipeView, /trackAnalytics\("recipe_opened"/);
  assert.match(recipeView, /trackAnalytics\("recipe_tab_switched"\s*,\s*\{\s*from:\s*section\s*,\s*to:\s*next\s*\}/);
  assert.match(recipeView, /new IntersectionObserver\(/, "reaching steps is observed rather than inferred from the default tab");
  assert.match(recipeView, /IntersectionObserver[\s\S]{0,1000}trackAnalytics\("cooking_instructions_opened"/);
});

test("14A keeps products in Cooking and removes duplicate Dish controls", async () => {
  const { page } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));
  const warning = recipeView.slice(recipeView.indexOf("contactWarnings.length > 0"), recipeView.indexOf("contactWarnings.length > 0") + 650);

  assert.match(warning, /<section className="allergy-warning glass-card" role="alert">/);
  assert.doesNotMatch(recipeView, /section\s*===\s*"dish"\s*&&\s*contactWarnings\.length\s*>\s*0/, "cross-contact warning stays outside tabs");
  assert.doesNotMatch(recipeView, /section\s*===\s*"products"|\["products",\s*"Продукты"\]/, "the separate Products tab is gone");
  assert.match(recipeView, /aria-expanded=\{ingredientsExpanded\}/);
  assert.match(recipeView, /ingredientsExpanded \? "Свернуть" : "Развернуть"/);
  assert.doesNotMatch(recipeView, /Как разложить блюдо|className="macro-tuner glass-card"/, "Dish has neither duplicate packing copy nor macro tuning");
  assert.doesNotMatch(recipeView, /(?:\bесть\b|докупить|кладов)/iu, "the inline product list has no pantry statuses or actions");
  assert.match(page, /function ingredientSortableAmount\([\s\S]{0,700}gramsPerUnit/, "piece quantities are normalized before sorting");
  assert.match(recipeView, /sortedIngredients[\s\S]{0,500}ingredientSortableAmount\(/, "product quantities are shown in descending normalized order");
});

test("RecipeView renders detailed numbered source actions instead of bypassing them with coarse timelines", async () => {
  const { page } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(page, /import \{ formatCookingActionText, splitCookingActions \} from "@\/domain\/cooking-actions"/);
  assert.match(page, /function recipeCookingInstructions[\s\S]{0,1200}splitCookingActions\(source\.text\)/);
  assert.match(recipeView, /const displaySteps = recipeDisplaySteps\(/);
  assert.match(recipeView, /className="cooking-steps/, "all recipes show numbered detailed actions");
  assert.doesNotMatch(recipeView, /timelineSteps|recipe-timeline/, "coarse recipe.instructions never bypass the detailed action list");
});

test("batch migration retains an old running timer until the cook acknowledges the overdue check", async () => {
  const { page } = await recipeSources();
  const batchView = page.slice(page.indexOf("function BatchCookingSessionView("), page.indexOf("function CookingMethodSelect("));

  assert.match(page, /function readRecoveredCookingTimer/);
  assert.match(batchView, /timer-recovery/);
  assert.match(batchView, /Шаг \$\{stepIndex \+ 1\} из \$\{model\.steps\.length\}/, "the batch header exposes granular progress without opening the full list");
  assert.match(batchView, /Срок сохранённого таймера истёк\. Проверьте блюдо/);
  assert.match(batchView, /Блюдо проверено — продолжить/);
  assert.match(batchView, /if \(!currentStep \|\| unmappedTimer\) return;/, "the new draft cannot overwrite a legacy timer while recovery is pending");
  assert.match(batchView, /disabled=\{Boolean\(unmappedTimer\) \|\| \(!timerRunning && remainingSeconds <= 0\)\}/, "a migrated timer blocks a new timer rather than cancelling physical cooking");
});

test("14A opens with a larger cover, swipe expansion, and no top photo button", async () => {
  const { page, css } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(css, /\.recipe-hero-photo\s*\{[\s\S]{0,500}height:\s*320px/);
  assert.match(css, /\.recipe-detail\.photo-expanded\s+\.recipe-hero-photo/);
  assert.match(recipeView, /onTouchStart=/);
  assert.match(recipeView, /onTouchEnd=/);
  assert.match(recipeView, /end\s*-\s*start\s*>=\s*48[\s\S]{0,100}setPhotoExpanded\(true\)/);
  assert.doesNotMatch(recipeView, /recipe-photo-expand/);
  assert.doesNotMatch(css, /\.recipe-photo-expand/);
});

test("14A explains difficulty with equipment and parallel-process evidence", async () => {
  const { page, css } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(page, /effortDescription:\s*recipeEffortDescription/);
  assert.match(page, /"весы"/);
  assert.match(page, /Два процесса/);
  assert.match(page, /идут параллельно, ничего не остывает критично/);
  assert.match(recipeView, /cookingMethod\?\.steps \? cookingMethod\.requiredEquipment\.map\(equipmentLabel\)\.join\(" · "\) : recipe\.effortDescription/);
  assert.match(css, /\.recipe-difficulty\s*>\s*\.recipe-difficulty-evidence/);
});

test("14A follows the supplied visual reference without adding pantry states", async () => {
  const { page, css } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(
    css,
    /\.recipe-detail\s*>\s*\.detail-tabs button\.selected\s*\{[^}]*color:\s*#fff;[^}]*background:\s*var\(--accent-grad\)/s,
  );
  assert.match(
    css,
    /\.recipe-timeline-node\s*\{[^}]*background:\s*var\(--accent\)/s,
    "hands-on steps use the action colour",
  );
  assert.doesNotMatch(recipeView, /Без вашего участия/, "the timeline does not repeat the passive label in every card");
});
