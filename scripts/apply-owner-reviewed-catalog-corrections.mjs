/** Apply the checked-in, owner-reviewed corrections without reading another worktree or Git ref. */
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const corrections = JSON.parse(
  await readFile(new URL("../data/owner-reviewed-catalog-corrections.json", import.meta.url), "utf8"),
);
if (corrections.schemaVersion !== 1 || !Array.isArray(corrections.cards)) {
  throw new Error("Owner-reviewed catalog corrections have an unsupported schema");
}

const files = {
  mealprepmanual: "data/mealprepmanual-candidates.json",
  goodfood: "data/goodfood-candidates.json",
};
const editorialFiles = [
  "data/recipe-editorial/cards-a.json",
  "data/recipe-editorial/cards-b.json",
  "data/recipe-editorial/cards-c.json",
];
const datasets = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, JSON.parse(await readFile(file, "utf8"))])),
);
const editorials = await Promise.all(editorialFiles.map(async (file) => ({ file, cards: JSON.parse(await readFile(file, "utf8")) })));

for (const correction of corrections.cards) {
  const dataset = datasets[correction.dataset];
  if (!dataset) throw new Error(`${correction.id}: unknown correction dataset`);
  const index = dataset.candidates.findIndex((candidate) => candidate.id === correction.id);
  if (index < 0) throw new Error(`${correction.id}: missing candidate in current corpus`);
  dataset.candidates[index] = correction.candidate;
  if (correction.editorial) {
    const owner = editorials.find((entry) => entry.cards.some((card) => card.id === correction.id));
    if (!owner) throw new Error(`${correction.id}: missing editorial card in current corpus`);
    owner.cards[owner.cards.findIndex((card) => card.id === correction.id)] = correction.editorial;
  }
}

async function writeJson(file, value) {
  const target = resolve(file);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

await Promise.all([
  ...Object.entries(files).map(([key, file]) => writeJson(file, datasets[key])),
  ...editorials.map((entry) => writeJson(entry.file, entry.cards)),
]);
process.stdout.write(`${JSON.stringify({ applied: corrections.cards.length, sourceReviewCommit: corrections.sourceReviewCommit })}\n`);
