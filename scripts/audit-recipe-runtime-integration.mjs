import { buildRecipeRuntimeCatalog } from "./build-recipe-runtime-catalog.mjs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function auditRecipeRuntimeIntegration() {
  const catalog = await buildRecipeRuntimeCatalog();
  return {
    schemaVersion: 2,
    releaseAuditCounts: catalog.coverage.releaseAudit,
    auditedReadyCards: catalog.coverage.auditReadyCandidates,
    runtimeReleaseableCards: catalog.recipes.length,
    recommendedReleaseBehavior: catalog.failures.length ? "hold_for_projection_failures" : "runtime_projection_ready",
    failureCounts: catalog.coverage.failureReasons,
    coverage: {
      bySlot: catalog.coverage.bySlot,
      byReleaseMenuTag: catalog.coverage.byReleaseMenuTag,
    },
    cards: catalog.recipes.map((recipe) => ({
      id: recipe.id,
      slot: recipe.slot,
      title: recipe.title,
      recipeFamilyId: recipe.recipeFamily.id,
      shoppingIngredientCount: recipe.shoppingIngredients.length,
      procedureIngredientCount: recipe.procedureIngredients.length,
      media: recipe.provenance.preview.kind,
    })),
    failures: catalog.failures,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await auditRecipeRuntimeIntegration();
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path");
  if (outputPath) {
    const absolutePath = resolve(outputPath);
    const temporaryPath = `${absolutePath}.tmp`;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporaryPath, absolutePath);
    process.stdout.write(`${JSON.stringify({ output: absolutePath, auditedReadyCards: report.auditedReadyCards, runtimeReleaseableCards: report.runtimeReleaseableCards })}\n`);
  } else process.stdout.write(`${JSON.stringify(report)}\n`);
}
