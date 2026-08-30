import { auditRecipeCorpus } from "./audit-recipe-corpus.mjs";
import { auditRecipeNutritionCorpus } from "./audit-recipe-nutrition.mjs";
import { applyOwnerRecipeResolutions, loadOwnerRecipeResolutions } from "./recipe-owner-resolutions.mjs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function auditRecipeRelease() {
  const [editorial, nutrition, ownerResolutions] = await Promise.all([
    auditRecipeCorpus(),
    auditRecipeNutritionCorpus(),
    loadOwnerRecipeResolutions(),
  ]);
  const nutritionById = new Map(nutrition.cards.map((card) => [card.id, card]));
  const cards = editorial.verdicts.map((card) => {
    const nutritionCard = nutritionById.get(card.id);
    if (!nutritionCard) throw new Error(`${card.id}: missing nutrition audit`);
    const verdicts = [card.verdict, nutritionCard.verdict];
    const verdict = verdicts.includes("blocked") ? "blocked" : verdicts.includes("review_required") ? "review_required" : "ready";
    return {
      id: card.id,
      title: card.title,
      sourceUrl: card.sourceUrl,
      verdict,
      editorialVerdict: card.verdict,
      nutritionVerdict: nutritionCard.verdict,
      calculatedNutrition: nutritionCard.calculatedNutrition,
      reasons: [
        ...card.reasons.map((item) => ({ gate: "editorial", ...item })),
        ...nutritionCard.reasons.map((item) => ({ gate: "nutrition", ...item })),
      ],
    };
  });
  if (cards.length !== 217 || new Set(cards.map((card) => card.id)).size !== 217) throw new Error("Release audit must cover 217 unique cards");
  const counts = Object.fromEntries(["ready", "review_required", "blocked"].map((verdict) => [verdict, cards.filter((card) => card.verdict === verdict).length]));
  const reasonCounts = Object.fromEntries([...new Set(cards.flatMap((card) => card.reasons.map((item) => `${item.gate}:${item.code}`)))].sort().map((key) => [
    key,
    cards.filter((card) => card.reasons.some((item) => `${item.gate}:${item.code}` === key)).length,
  ]));
  return applyOwnerRecipeResolutions({
    schemaVersion: 1,
    total: cards.length,
    counts,
    reasonCounts,
    cards,
  }, ownerResolutions);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = await auditRecipeRelease();
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path");
  if (outputPath) {
    const absolutePath = resolve(outputPath);
    const temporaryPath = `${absolutePath}.tmp`;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporaryPath, absolutePath);
    process.stdout.write(`${JSON.stringify({ output: absolutePath, total: report.total, counts: report.counts })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}
