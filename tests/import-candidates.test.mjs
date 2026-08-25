import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(await readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8"));
const candidates = data.candidates;

test("Meal Prep Manual import contains 50 auditable candidates", () => {
  assert.equal(candidates.length, 50);
  assert.ok(candidates.every((item) => item.sourceUrl.startsWith("https://mealprepmanual.com/")));
  assert.ok(candidates.every((item) => item.imageUrl?.startsWith("https://mealprepmanual.com/wp-content/")));
  assert.ok(candidates.every((item) => item.imageUse === "source-preview-only"));
});

test("imported candidates have macros, time and ingredient facts without copied instructions", () => {
  for (const item of candidates) {
    assert.ok(Object.values(item.macros).every(Number.isFinite), `${item.title} has macros`);
    assert.ok(Number.isFinite(item.time.totalMinutes) && item.time.totalMinutes > 0, `${item.title} has total time`);
    assert.ok(item.ingredients.length > 0, `${item.title} has ingredients`);
    assert.equal("instructions" in item, false);
  }
});

test("localization flags culturally weak first-pool formats instead of banning approved ingredients", () => {
  const suggestedExclusions = candidates.filter((item) => item.localization.excludeSuggested).map((item) => item.title);
  assert.ok(suggestedExclusions.includes("Mediterranean Chicken Pasta Salad"));
  assert.ok(suggestedExclusions.includes("Sausage Egg and Cheese Savory Baked Oatmeal"));
  assert.ok(candidates.some((item) => item.ingredients.some((ingredient) => /sweet potato/i.test(ingredient.name)) && !item.localization.excludeSuggested));
});
