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
      assert.ok(Number.isFinite(step.minutes) && step.minutes >= 0, `${recipe.id}: non-negative minutes`);
      assert.equal(typeof step.hands, "boolean", `${recipe.id}: hands is explicit`);
      assert.ok(Number.isFinite(step.at) && step.at >= previousAt, `${recipe.id}: at is monotonic`);
      previousAt = step.at;
    }
  }
});

test("14A calculates the approved three-level difficulty in the engine", async () => {
  const { engine, runtime } = await recipeSources();

  assert.match(engine, /RecipeEffortLevel\s*=\s*"low"\s*\|\s*"medium"\s*\|\s*"high"/, "the engine owns all three levels");
  assert.match(engine, /activeMinutes\s*<=\s*15\s*&&\s*cookware\s*<=\s*1/, "simple is at most 15 active minutes and one vessel");
  assert.match(engine, /activeMinutes\s*<=\s*30\s*\|\|\s*cookware\s*>=\s*2/, "medium follows the approved OR rule");
  assert.ok(runtime.recipes.every((recipe) => ["low", "medium", "high"].includes(recipe.effort.level)), "runtime keeps the engine difficulty level");
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

test("14A keeps safety and dish information visible in the right places without pantry UI", async () => {
  const { page } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));
  const productsStart = recipeView.indexOf('section === "products"');
  const products = recipeView.slice(
    productsStart,
    recipeView.indexOf('section === "dish"', productsStart),
  );
  const warning = recipeView.slice(recipeView.indexOf("contactWarnings.length > 0"), recipeView.indexOf("contactWarnings.length > 0") + 650);

  assert.match(warning, /<section className="allergy-warning glass-card" role="alert">/);
  assert.doesNotMatch(recipeView, /section\s*===\s*"dish"\s*&&\s*contactWarnings\.length\s*>\s*0/, "cross-contact warning stays outside tabs");
  assert.match(recipeView, /section\s*===\s*"dish"[\s\S]{0,12000}recipe\.packing/, "packing guidance belongs to Dish");
  assert.match(products, /Количество на готовку или одну базовую порцию/, "Products remains neutral when pantry is out of scope");
  assert.doesNotMatch(products, /(?:\bесть\b|докупить|кладов)/iu, "Products has no pantry statuses or actions");
  assert.match(page, /function ingredientSortableAmount\([\s\S]{0,700}gramsPerUnit/, "piece quantities are normalized before sorting");
  assert.match(recipeView, /sortedIngredients[\s\S]{0,500}ingredientSortableAmount\(/, "product quantities are shown in descending normalized order");
});

test("14A renders a real timeline with a permanent legacy fallback and reduced-motion coverage", async () => {
  const { page, css } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(recipeView, /className="recipe-timeline/);
  assert.match(recipeView, /recipe\.instructions\s*(?:\?\.|&&|\?)/, "missing instructions fall back instead of breaking old recipes");
  assert.match(recipeView, /className="cooking-steps/, "numbered legacy steps remain available");
  assert.match(css, /\.recipe-timeline\s*\{/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,4000}recipe-timeline/, "timeline motion is covered by reduced-motion rules");
});

test("14A opens with a larger cover and supports an accessible swipe expansion", async () => {
  const { page, css } = await recipeSources();
  const recipeView = page.slice(page.indexOf("function RecipeView("));

  assert.match(css, /\.recipe-hero-photo\s*\{[\s\S]{0,500}height:\s*320px/);
  assert.match(css, /\.recipe-detail\.photo-expanded\s+\.recipe-hero-photo/);
  assert.match(recipeView, /onTouchStart=/);
  assert.match(recipeView, /onTouchEnd=/);
  assert.match(recipeView, /end\s*-\s*start\s*>=\s*48[\s\S]{0,100}setPhotoExpanded\(true\)/);
  assert.match(recipeView, /aria-label=\{photoExpanded\s*\?\s*"Уменьшить фото"\s*:\s*"Увеличить фото"\}/);
});
