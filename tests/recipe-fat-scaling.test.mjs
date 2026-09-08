import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const runtime = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));

const ingredient = (id, canonicalIngredientId, baseAmount, role, overrides = {}) => ({
  sourceIngredientId: id,
  canonicalIngredientId,
  baseAmount,
  unit: "g",
  role,
  minAmount: baseAmount,
  preferredMin: baseAmount,
  preferredMax: baseAmount,
  maxAmount: baseAmount,
  scalable: false,
  scalingPriority: 1,
  substitutions: [],
  optional: false,
  ...overrides,
});

test("only reviewed cooking fat is shared once; edible oil and butter scale with each serving", () => {
  const edibleOil = ingredient("oil", "olive_oil_processed", 12, "fat", {
    minAmount: 3,
    preferredMin: 8,
    preferredMax: 16,
    maxAmount: 22,
    scalable: true,
  });
  const edibleButter = ingredient("butter", "butter_processed", 10, "fat");
  const reviewedPanOil = ingredient("pan-oil", "olive_oil_processed", 6, "fat_cooking");
  const portions = [
    { oil: 8, butter: 10, "pan-oil": 3 },
    { oil: 16, butter: 10, "pan-oil": 3 },
  ];

  const cooked = engine.aggregateCookingAmounts(
    [edibleOil, edibleButter, reviewedPanOil],
    portions,
    3,
  );
  assert.equal(cooked.oil, 72, "edible oil retains each source-serving amount for every day");
  assert.equal(cooked.butter, 60, "edible butter is not turned into one pan-only amount");
  assert.equal(cooked["pan-oil"], 6, "reviewed pan oil remains once per physical cook");
  assert.equal(edibleOil.minAmount, 3, "edible fat is not given a fabricated fixed amount");
});

test("satay oils and potato-puree butter retain their source-serving basis at every batch size", () => {
  const satay = runtime.recipes.find((recipe) => recipe.id === "goodfood-satay-sweet-potato-curry").recipeFamily;
  const puree = runtime.recipes.find((recipe) => recipe.id === "tmpm-26872").recipeFamily;
  const fixedSourceServing = (item) => ({
    ...item,
    role: "fat",
    sourceScaling: "fixed_per_serving",
    minAmount: item.baseAmount,
    preferredMin: item.baseAmount,
    preferredMax: item.baseAmount,
    maxAmount: item.baseAmount,
    scalable: false,
  });
  const satayFats = satay.ingredients.filter((item) =>
    ["coconut_oil_processed", "peanut_butter_processed"].includes(item.canonicalIngredientId),
  ).map(fixedSourceServing);
  const pureeButter = fixedSourceServing(
    puree.ingredients.find((item) => item.canonicalIngredientId === "butter_processed"),
  );
  assert.equal(satayFats.length, 2);
  assert.ok(pureeButter);
  for (const item of [...satayFats, pureeButter]) {
    assert.equal(item.sourceScaling, "fixed_per_serving");
    assert.equal(item.minAmount, item.baseAmount);
    assert.equal(item.maxAmount, item.baseAmount);
    for (const servings of [1, 4, 6, 12]) {
      const cooked = engine.aggregateCookingAmounts(
        [item],
        Array.from({ length: servings }, () => ({ [item.sourceIngredientId]: item.baseAmount })),
      );
      assert.equal(cooked[item.sourceIngredientId], Math.round(item.baseAmount * servings * 10) / 10);
    }
  }
});

test("structural eggs are rounded once for the physical cook, never above a serving bound", () => {
  const egg = ingredient("egg", "egg_raw", 0.75, "protein", {
    unit: "piece",
    minAmount: 0.5,
    preferredMin: 0.5,
    preferredMax: 0.75,
    maxAmount: 0.75,
    scalable: true,
  });
  const family = {
    id: "egg-bound",
    minViableCalories: 1,
    maxViableCalories: 1_000,
    minimumProtein: 0,
    ingredients: [egg],
  };
  const solved = engine.solveRecipeFamily(family, { targetCalories: 50 });
  assert.ok(solved.amounts.egg <= egg.maxAmount, "per-serving solve cannot ceil eggs beyond its maximum");
  const cooked = engine.aggregateCookingAmounts([egg], [{ egg: 0.75 }, { egg: 0.75 }], 3);
  assert.equal(cooked.egg, 4, "4.5 eggs never round above the physical batch maximum");
  const gramEgg = { ...egg, unit: "g" };
  assert.equal(
    engine.aggregateCookingAmounts([gramEgg], [{ egg: 0.75 }, { egg: 0.75 }], 3).egg,
    4.5,
    "structural canonical identity alone never rounds a gram/ml amount",
  );
  assert.equal(
    engine.physicalBatchAmountsViable([egg], 1),
    false,
    "a single 0.5–0.75 egg serving has no actionable whole-unit batch",
  );
  const tortilla = { ...egg, canonicalIngredientId: "tortilla_processed", minAmount: 1, maxAmount: 1, baseAmount: 1 };
  assert.equal(engine.physicalBatchAmountsViable([tortilla], 3), true);
  assert.equal(
    engine.aggregateCookingAmounts([tortilla], [{ egg: 1 }, { egg: 1 }, { egg: 1 }]).egg,
    3,
    "separate tortillas retain one source unit per serving",
  );
  const repeatedEgg = { ...egg, minAmount: 1, maxAmount: 1, baseAmount: 1 };
  assert.equal(
    engine.aggregateCookingAmounts(
      [repeatedEgg],
      [{ egg: 2 }, { egg: 2 }],
      1,
      [2, 2],
    ).egg,
    4,
    "two people each eating two source servings retain four physical eggs",
  );
  assert.equal(engine.physicalBatchAmountsViable([repeatedEgg], 2, 1, [2, 2]), true);
});
