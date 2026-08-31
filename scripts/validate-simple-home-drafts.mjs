import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidateFile = "data/simple-home-candidates.json";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function validateCandidate(candidate, seenIds) {
  const prefix = `${candidateFile}: ${candidate?.id ?? "<missing id>"}`;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${candidateFile}: every candidate must be an object.`);
  }
  if (!nonEmptyString(candidate.id) || !idPattern.test(candidate.id)) throw new Error(`${prefix}: invalid id.`);
  if (seenIds.has(candidate.id)) throw new Error(`${prefix}: duplicate id.`);
  seenIds.add(candidate.id);
  if (!nonEmptyString(candidate.sourceUrl) || !/^https:\/\//u.test(candidate.sourceUrl)) throw new Error(`${prefix}: sourceUrl must be an https URL.`);
  if (!nonEmptyString(candidate.imageUrl) || !/^https:\/\//u.test(candidate.imageUrl)) throw new Error(`${prefix}: imageUrl must be an https URL.`);
  if (!candidate.catalogSections?.includes("simple_home")) throw new Error(`${prefix}: missing simple_home catalog section.`);
  if (!positiveNumber(candidate.servings)) throw new Error(`${prefix}: servings must be positive.`);
  if (!positiveNumber(candidate.macros?.protein) || Number(candidate.macros.protein) < 25) {
    throw new Error(`${prefix}: high-protein adaptation must provide at least 25 g protein per serving.`);
  }
  if (candidate.miseEditorialAdaptation?.kind !== "simple_home_measured_adaptation_v1") {
    throw new Error(`${prefix}: missing measured adaptation provenance.`);
  }
  if (!nonEmptyString(candidate.miseEditorialAdaptation?.note)) throw new Error(`${prefix}: missing adaptation note.`);
  if (!Array.isArray(candidate.ingredients) || !candidate.ingredients.length) throw new Error(`${prefix}: ingredients are required.`);
  candidate.ingredients.forEach((ingredient, index) => {
    if (ingredient.id && (!positiveNumber(ingredient.amountMetric) || ingredient.unitMetric !== "g")) {
      throw new Error(`${prefix}: ingredient ${index + 1} must have a positive measured gram amount.`);
    }
  });
  if (!Array.isArray(candidate.paraphrasedInstructionDraft) || !candidate.paraphrasedInstructionDraft.length) {
    throw new Error(`${prefix}: preparation steps are required.`);
  }
}

export async function validateSimpleHomeDrafts({ cwd = projectRoot } = {}) {
  const absoluteFile = resolve(cwd, candidateFile);
  const document = JSON.parse(await readFile(absoluteFile, "utf8"));
  if (!Array.isArray(document.candidates)) throw new Error(`${candidateFile}: expected { candidates: [] }.`);
  const seenIds = new Set();
  document.candidates.forEach((candidate) => validateCandidate(candidate, seenIds));
  return {
    files: [candidateFile],
    count: document.candidates.length,
    ids: [...seenIds].sort(),
    drafts: document.candidates,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await validateSimpleHomeDrafts();
  process.stdout.write(`${JSON.stringify({ files: report.files, count: report.count, ids: report.ids })}\n`);
}
