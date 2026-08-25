import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadRecipeCatalog() {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "recipe data section is present");
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__catalog = { recipes, portionFor, ingredientScaleFor, shareFor, candidateRecipes };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(output, sandbox);
  return sandbox.__catalog;
}

const { recipes, portionFor, ingredientScaleFor, shareFor, candidateRecipes } = await loadRecipeCatalog();
const recipe = (title) => {
  const found = recipes.find((item) => item.title === title);
  assert.ok(found, `recipe exists: ${title}`);
  return found;
};
const ingredientIds = (title) => recipe(title).ingredients.map((ingredient) => ingredient.id);

test("generated ingredients match the recipe title", () => {
  assert.equal(ingredientIds("Тунец с зелёной фасолью").filter((id) => id.includes("beans")).join(","), "green-beans");
  assert.ok(ingredientIds("Тунец с зелёной фасолью").includes("tuna"));
  assert.ok(ingredientIds("Кето-сырники").includes("cottage"));
  assert.ok(!ingredientIds("Кето-сырники").includes("cheese"));
  assert.ok(ingredientIds("Кето-брауни мини").includes("cocoa"));
  assert.ok(!ingredientIds("Кето-брауни мини").includes("turkey"));
  assert.ok(!ingredientIds("Кето-брауни мини").includes("spinach"));
  assert.ok(ingredientIds("Говяжьи котлеты с цветной капустой").includes("beef"));
  assert.ok(!ingredientIds("Говяжьи котлеты с цветной капустой").includes("chicken-thigh"));
  assert.ok(ingredientIds("Индейка в сливочном соусе").includes("cream"));
  assert.ok(ingredientIds("Домашний хумус с лепёшкой").includes("flatbread"));
});

test("generated paleo and keto recipes keep their strict ingredient rules", () => {
  const generated = recipes.filter((item) => item.id.startsWith("gen-"));
  const paleoForbidden = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "bulgur", "pasta", "flatbread", "cottage", "cheese", "cream-cheese", "cream"]);
  const ketoForbidden = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "potato", "sweet-potato", "bulgur", "pasta", "flatbread"]);
  for (const item of generated) {
    assert.ok(item.ingredients.length >= 2, `${item.title} has at least two ingredients`);
    const forbidden = item.tags.includes("paleo") ? paleoForbidden : item.tags.includes("keto") ? ketoForbidden : null;
    if (forbidden) assert.ok(item.ingredients.every((ingredient) => !forbidden.has(ingredient.id)), `${item.title} follows ${item.tags[0]} rules`);
  }
});

test("parsed recipes keep auditable source and adaptation metadata", () => {
  const parsed = recipes.filter((item) => item.provenance.kind === "parsed");
  assert.equal(parsed.length, 14);
  for (const item of parsed) {
    assert.match(item.provenance.sourceUrl, /^https:\/\//);
    assert.ok(item.provenance.sourceTitle.length > 0);
    assert.ok(item.provenance.sourceQuery.length > 0);
  }
});

test("source photos and localization notes are attached to imported recipes", () => {
  const withPhotos = recipes.filter((item) => item.provenance.kind === "parsed" && item.provenance.imageUrl);
  assert.equal(withPhotos.length, 4);
  assert.ok(withPhotos.every((item) => item.provenance.imageAlt && item.provenance.sourceUrl));
  for (const id of ["src-taco-mac", "src-teriyaki-tray", "src-halal-chicken"]) {
    const item = recipes.find((candidate) => candidate.id === id);
    assert.ok(item);
    assert.equal(item.localization.fit, "adapted");
    assert.ok(item.localization.note.length > 0);
  }
});

test("every recipe has bounded flexibility, effort and storage guidance", () => {
  for (const item of recipes) {
    for (const range of Object.values(item.flex)) {
      assert.ok(range[0] > 0 && range[0] <= 1);
      assert.ok(range[1] >= 1 && range[1] <= 1.5);
    }
    assert.ok(["low", "high"].includes(item.effort.level));
    assert.ok(item.effort.knifeActions >= 0);
    assert.ok(item.effort.cookware >= 1);
    assert.ok(item.effort.activeActions >= 1);
    assert.ok(item.effort.activeMinutes > 0 && item.effort.activeMinutes <= item.time);
    assert.ok(item.storage.refrigerator.length > 0);
    if (item.freezable) {
      assert.ok(item.storage.freezerDays > 0);
      assert.ok(item.storage.freezer.length > 0);
      assert.ok(item.storage.thaw.length > 0);
    }
  }
});

test("flex controls clamp values and scale ingredient groups independently", () => {
  const item = recipes.find((candidate) => candidate.id === "src-chicken-buckwheat");
  assert.ok(item);
  const person = { id: "test", name: "Тест", daily: { kcal: 2100, protein: 150, fat: 70, carbs: 210 }, mealsPerDay: 3, includedSlots: ["breakfast", "lunch", "dinner"] };
  const portion = portionFor(person, "lunch", item, { protein: 9, fat: 0.01, carbs: 9 });
  assert.equal(portion.ratios.protein, item.flex.protein[1]);
  assert.equal(portion.ratios.fat, item.flex.fat[0]);
  assert.equal(portion.ratios.carbs, item.flex.carbs[1]);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "chicken"), portion), portion.factor * portion.ratios.protein);
  assert.equal(ingredientScaleFor(item.ingredients.find((ingredient) => ingredient.id === "buckwheat"), portion), portion.factor * portion.ratios.carbs);
});

test("one planned meal keeps a bounded share of the daily target", () => {
  const daily = { kcal: 2100, protein: 150, fat: 70, carbs: 210 };
  for (const [slot, expected] of [["breakfast", 0.25], ["lunch", 0.35], ["dinner", 0.4], ["snack1", 0.1]]) {
    const person = { id: "single", name: "Тест", daily, mealsPerDay: 1, includedSlots: [slot] };
    assert.equal(shareFor(person, slot), expected);
  }
  const breakfastOnly = { id: "partial", name: "Тест", daily, mealsPerDay: 2, includedSlots: ["breakfast"] };
  assert.equal(shareFor(breakfastOnly, "breakfast"), 0.25);
});

test("keeps the approved ingredients and excludes pasta salads from the first pool", () => {
  const allIds = new Set(recipes.flatMap((item) => item.ingredients.map((ingredient) => ingredient.id)));
  for (const id of ["quinoa", "chia", "coconut-milk", "tofu", "sweet-potato"]) assert.ok(allIds.has(id), `${id} remains available`);
  assert.ok(recipes.every((item) => !/салат.*(?:паст|макарон)|(?:паст|макарон).*салат/i.test(item.title)));
});

test("catalog shows every matching recipe while the plan builder keeps five choices", () => {
  const catalog = candidateRecipes("lunch", "protein", [], 1, { origin: "generated", limit: "all" });
  const builder = candidateRecipes("lunch", "protein", [], 1, { origin: "generated" });
  assert.ok(catalog.length > 5);
  assert.equal(builder.length, 5);
});
