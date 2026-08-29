import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditRecipeRelease } from "./audit-recipe-release.mjs";

const resolutionPath = new URL("../data/recipe-review-resolutions.json", import.meta.url);
const backlogNote = "Отложено владельцем в бэклог после второго прохода ревью.";

async function atomicWrite(url, value) {
  const path = resolve(url.pathname);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function mergeDecisions(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const decision of incoming) byId.set(decision.id, decision);
  return [...byId.values()];
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
}

export async function applyRecipeReviewBacklog(inputPath) {
  if (!inputPath) throw new Error("--input requires a recipe review decisions JSON file");
  const absoluteInputPath = resolve(inputPath);
  const review = JSON.parse(await readFile(absoluteInputPath, "utf8"));
  const resolutions = JSON.parse(await readFile(resolutionPath, "utf8"));
  if (review.schemaVersion !== 1 || !Array.isArray(review.decisions)) throw new Error("Recipe review decisions must use schemaVersion 1");

  resolutions.sourceExport = {
    exportedAt: review.exportedAt,
    sourceAuditGeneratedAt: review.sourceAuditGeneratedAt,
    fileName: basename(absoluteInputPath),
  };
  resolutions.decisions = mergeDecisions(resolutions.decisions, review.decisions);
  resolutions.backlog = [];

  for (const decision of review.decisions) {
    if (decision.option === "exclude_card") {
      upsertById(resolutions.exclusions, {
        id: decision.id,
        note: decision.note || "Исключено владельцем после второго прохода ревью.",
      });
      continue;
    }
    if (decision.option === "keep_specialty") {
      const resolution = {
        id: decision.id,
        gate: "editorial",
        code: "niche_localization",
        resolution: "Владелец подтвердил: карточка не требует локализационной замены.",
      };
      const index = resolutions.resolvedReasons.findIndex((item) => item.id === resolution.id && item.gate === resolution.gate && item.code === resolution.code);
      if (index >= 0) resolutions.resolvedReasons[index] = resolution;
      else resolutions.resolvedReasons.push(resolution);
      continue;
    }
    throw new Error(`${decision.id}: unsupported decision option ${decision.option || "<empty>"}`);
  }

  await atomicWrite(resolutionPath, resolutions);
  const activeAudit = await auditRecipeRelease();
  resolutions.backlog = activeAudit.cards
    .filter((card) => card.verdict === "review_required" || card.verdict === "blocked")
    .map((card) => ({ id: card.id, note: backlogNote }));
  await atomicWrite(resolutionPath, resolutions);

  const finalAudit = await auditRecipeRelease();
  if (finalAudit.counts.review_required !== 0 || finalAudit.counts.blocked !== 0) {
    throw new Error("Recipe review backlog application left active review cards");
  }
  return { total: finalAudit.total, counts: finalAudit.counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inputIndex = process.argv.indexOf("--input");
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;
  process.stdout.write(`${JSON.stringify(await applyRecipeReviewBacklog(inputPath))}\n`);
}
