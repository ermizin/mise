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
  const output = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.__recipes = recipes;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(output, sandbox);
  return sandbox.__recipes;
}

const recipes = await loadRecipeCatalog();
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
