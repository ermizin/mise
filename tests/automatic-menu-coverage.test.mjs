import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const engine = await loadTypeScriptModule(new URL("../domain/recipe-engine.ts", import.meta.url));
const nutrition = await loadTypeScriptModule(new URL("../domain/nutrition.ts", import.meta.url));

async function automaticMenuRuntime() {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const mealMeta");
  const end = source.indexOf("export default function Home");
  assert.ok(start >= 0 && end > start, "menu runtime section is present");
  const output = ts.transpileModule(
    `${source.slice(start, end)}\nglobalThis.__runtime = { candidateRecipes, allMealSlots, recipeCookingSession, targetFor };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const runtimeRecipeCatalogJson = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const legacyRecipeImageDownloadSourcesJson = JSON.parse(
    await readFile(new URL("../data/legacy-recipe-image-download-sources.json", import.meta.url), "utf8"),
  );
  const sandbox = {
    runtimeRecipeCatalogJson,
    legacyRecipeImageDownloadSourcesJson,
    ACTIVITY_FACTORS: nutrition.ACTIVITY_FACTORS,
    MEAL_SLOT_SHARES: nutrition.MEAL_SLOT_SHARES,
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    calculateMealPlanTargets: nutrition.calculateMealPlanTargets,
    capMacrosAtCalories: nutrition.capMacrosAtCalories,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    materializeInstructions: engine.materializeInstructions,
    canonicalIngredients: engine.canonicalIngredients,
    PILOT_RAW_SOURCE_SLUGS: engine.PILOT_RAW_SOURCE_SLUGS,
    recipeToFamily: engine.recipeToFamily,
    deriveRecipeFamilyFromCatalog: engine.deriveRecipeFamilyFromCatalog,
    solveRecipeFamily: engine.solveRecipeFamily,
    normalizeRawRecipeCandidate: engine.normalizeRawRecipeCandidate,
    auditRawCandidateAgainstFamily: engine.auditRawCandidateAgainstFamily,
    aggregateCookingAmounts: engine.aggregateCookingAmounts,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__runtime;
}

// Bounds plus the default 2,100-kcal target. This stays fast enough for the
// full suite; the exhaustive exploratory sweep is intentionally kept out of
// the regression test.
const calorieSamples = [1200, 2100, 5000];
const styles = ["protein", "budget"];
// Candidate eligibility changes only when batch days pass a recipe's declared
// refrigerator limit. The current catalog has limits of 3 and 4 days, so these
// points cover the equivalent ranges 1–3, 4, and 5–14 without repeating the
// same selector result fourteen times.
const storageThresholdDays = [1, 4, 5, 14];

function dailyMacros(kcal) {
  return { kcal, protein: Math.round((kcal * 0.3) / 4), fat: Math.round((kcal * 0.3) / 9), carbs: Math.round((kcal * 0.4) / 4) };
}

function person(kcal, includedSlots) {
  return {
    id: "coverage",
    name: "Coverage",
    daily: dailyMacros(kcal),
    includedSlots,
    hardExclusions: [],
    dislikes: [],
  };
}

test("automatic menu has a released, engine-viable candidate throughout the supported coverage grid", async (t) => {
  const { candidateRecipes, allMealSlots } = await automaticMenuRuntime();
  const gaps = [];
  let checks = 0;
  const startedAt = performance.now();

  // Each count uses the wizard's first N slots. Across five counts, every slot
  // is exercised at every applicable target-share configuration.
  for (let mealCount = 1; mealCount <= allMealSlots.length; mealCount += 1) {
    {
      const includedSlots = allMealSlots.slice(0, mealCount);
      for (const kcal of calorieSamples)
        for (const days of storageThresholdDays)
          for (const style of styles)
            for (const slot of includedSlots) {
              const options = candidateRecipes(slot, style, [person(kcal, includedSlots)], days, { limit: 1 });
              checks += 1;
              if (!options.length)
                gaps.push({ kcal, mealCount, slots: includedSlots.join(","), days, style, slot });
            }
    }
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const grouped = Object.groupBy(gaps, (gap) => `${gap.style}/${gap.mealCount}/${gap.slot}`);
  const gapsByCalories = Object.groupBy(gaps, (gap) => String(gap.kcal));
  t.diagnostic(`checks=${checks}; gaps=${gaps.length}; elapsedMs=${elapsedMs}`);
  t.diagnostic(`gapsByCalories=${Object.entries(gapsByCalories).map(([kcal, values]) => `${kcal}:${values.length}`).join(",")}`);
  t.diagnostic(
    Object.entries(grouped)
      .map(([key, values]) => `${key}: ${values.length} (${values.slice(0, 3).map((gap) => `${gap.kcal}kcal,d${gap.days},[${gap.slots}]`).join("; ")})`)
      .join("\n") || "No gaps",
  );
  assert.equal(
    gaps.length,
    0,
    `automatic-menu coverage gaps: ${JSON.stringify(gaps.slice(0, 20))}`,
  );
});

// A person's daily protein share is split across slots in proportion to
// calories, so the wizard's own 40%-of-energy ceiling used to ask a 400 kcal
// breakfast for 40 g of protein and a 775 kcal one for 77 g. That share was
// enforced as a viability gate, which cut the offered breakfasts down to three
// at 2,500-3,500 kcal. The floor is now capped at 32% of the meal's energy, so
// these are the two targets the owner reported, pinned against a return of the
// collapse.
const HIGH_PROTEIN_SHARE = 0.4;
const MINIMUM_OFFERED = { breakfast: 6, lunch: 15, dinner: 15 };

function highProteinPerson(kcal, includedSlots) {
  return proteinSharePerson(kcal, includedSlots, HIGH_PROTEIN_SHARE);
}

function proteinSharePerson(kcal, includedSlots, proteinShare) {
  const daily = nutrition.fitMacrosToCalories(kcal, {
    protein: (kcal * proteinShare) / 4,
    fat: (kcal * 0.3) / 9,
    carbs: (kcal * (0.7 - proteinShare)) / 4,
  });
  return { id: "variety", name: "Variety", daily, includedSlots, hardExclusions: [], dislikes: [] };
}

test("high-protein daily targets keep real menu variety at 1600 and 3100 kcal", async (t) => {
  const { candidateRecipes, recipeCookingSession, targetFor } = await automaticMenuRuntime();
  const includedSlots = ["breakfast", "lunch", "dinner"];
  const failures = [];
  for (const kcal of [1600, 3100])
    for (const style of styles)
      for (const days of [1, 3])
        for (const slot of includedSlots) {
          const person = highProteinPerson(kcal, includedSlots);
          const options = candidateRecipes(slot, style, [person], days, { limit: "all" });
          t.diagnostic(`${kcal}kcal ${style} d${days} ${slot}: ${options.length}`);
          if (options.length < MINIMUM_OFFERED[slot])
            failures.push(`${kcal}kcal ${style} d${days} ${slot}: ${options.length} < ${MINIMUM_OFFERED[slot]}`);
          // Relaxing the protein floor must not buy variety with calories.
          const target = targetFor(person, slot);
          for (const recipe of options) {
            const portion = recipeCookingSession([person], slot, recipe, days).portions[0];
            const deviation = (portion.actual.kcal - target.kcal) / target.kcal;
            if (deviation < -0.1 || deviation > 0.05)
              failures.push(`${kcal}kcal ${style} d${days} ${slot} ${recipe.id}: ${(deviation * 100).toFixed(1)}% off target`);
          }
        }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("snack slots stay viable across the pilot calorie, protein, and batch grid", async (t) => {
  const { candidateRecipes, allMealSlots, recipeCookingSession, targetFor } = await automaticMenuRuntime();
  const failures = [];
  let checks = 0;

  for (const kcal of [1200, 1400, 1600])
    for (const proteinShare of [0.3, 0.4])
      for (const slot of ["snack1", "snack2"])
        for (const days of [3, 4, 5, 7]) {
          const person = proteinSharePerson(kcal, allMealSlots, proteinShare);
          const options = candidateRecipes(slot, "protein", [person], days, {
            limit: "all",
          });
          const optionIds = options.map((recipe) => recipe.id);
          checks += 1;
          if (optionIds.length === 0)
            failures.push(`${kcal}kcal ${Math.round(proteinShare * 100)}% protein ${slot} d${days}: no candidates`);
          if (optionIds.includes("tmpm-26746"))
            failures.push(`${kcal}kcal ${Math.round(proteinShare * 100)}% protein ${slot} d${days}: tmpm-26746 must stay lunch-only`);
          if (optionIds.some((id) => id !== "tmpm-26965"))
            failures.push(`${kcal}kcal ${Math.round(proteinShare * 100)}% protein ${slot} d${days}: unexpected ${optionIds.join(",")}`);
          const target = targetFor(person, slot);
          for (const recipe of options) {
            const portion = recipeCookingSession([person], slot, recipe, days).portions[0];
            const deviation = (portion.actual.kcal - target.kcal) / target.kcal;
            if (deviation < -0.1 || deviation > 0.05)
              failures.push(`${kcal}kcal ${Math.round(proteinShare * 100)}% protein ${slot} d${days} ${recipe.id}: ${(deviation * 100).toFixed(1)}% off target`);
            const proteinFloor = nutrition.mealProteinFloor(target.kcal, target.protein);
            if (portion.actual.protein + 0.2 < proteinFloor)
              failures.push(`${kcal}kcal ${Math.round(proteinShare * 100)}% protein ${slot} d${days} ${recipe.id}: ${portion.actual.protein}g protein < ${proteinFloor}g floor`);
          }
        }

  t.diagnostic(`checks=${checks}; failures=${failures.length}`);
  assert.deepEqual(failures, [], failures.join("\n"));
});
