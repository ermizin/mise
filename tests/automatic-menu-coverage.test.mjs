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
    `${source.slice(start, end)}\nglobalThis.__runtime = { candidateRecipes, allMealSlots };`,
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
