import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mealPrepManual = JSON.parse(await readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8"));
const goodFood = JSON.parse(await readFile(new URL("../data/goodfood-candidates.json", import.meta.url), "utf8"));
const candidates = mealPrepManual.candidates;
const allCandidates = [...mealPrepManual.candidates, ...goodFood.candidates];

test("Meal Prep Manual import contains every complete auditable candidate", () => {
  assert.equal(candidates.length, 126);
  assert.ok(candidates.every((item) => item.sourceUrl.startsWith("https://mealprepmanual.com/")));
  assert.ok(candidates.every((item) => item.imageUrl?.startsWith("https://mealprepmanual.com/wp-content/")));
  assert.ok(candidates.every((item) => item.imageUse === "source-preview-only"));
});

test("candidate pool contains at least 200 unique recipes across two sources", () => {
  assert.ok(allCandidates.length >= 200);
  assert.equal(new Set(allCandidates.map((item) => item.sourceUrl)).size, allCandidates.length);
  assert.ok(goodFood.candidates.length >= 90);
  assert.ok(goodFood.candidates.every((item) => new URL(item.sourceUrl).hostname === "www.bbcgoodfood.com"));
  assert.ok(allCandidates.every((item) => item.imageUse === "source-preview-only" && item.imageUrl?.startsWith("https://")));
});

test("editorial queue keeps promoted and pending candidates separate", () => {
  assert.equal(candidates.filter((item) => item.editorialStatus === "promoted").length, 28);
  assert.equal(candidates.filter((item) => item.editorialStatus === "pending").length, 98);
  assert.ok(goodFood.candidates.every((item) => item.editorialStatus === "pending"));
});

test("imported candidates have macros, time and ingredient facts without copied instructions", () => {
  for (const item of allCandidates) {
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
