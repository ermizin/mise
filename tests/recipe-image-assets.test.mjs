import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../data/recipe-image-manifest.json", import.meta.url), "utf8"),
);
const mealPrepManual = JSON.parse(
  await readFile(new URL("../data/mealprepmanual-candidates.json", import.meta.url), "utf8"),
);
const goodFood = JSON.parse(
  await readFile(new URL("../data/goodfood-candidates.json", import.meta.url), "utf8"),
);
const runtimeCatalog = JSON.parse(
  await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
);
const legacyManifest = JSON.parse(
  await readFile(new URL("../data/legacy-recipe-image-download-sources.json", import.meta.url), "utf8"),
);
const candidates = [...mealPrepManual.candidates, ...goodFood.candidates];

function detectedContentType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString("ascii").includes("ftypavif")) return "image/avif";
  return null;
}

test("every source card has one attributable, intact local photo", async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.policy, "local-source-copy-with-attribution");
  assert.equal(manifest.sourceCardCount, candidates.length);
  assert.equal(manifest.images.length, candidates.length);
  assert.equal(new Set(manifest.images.map((image) => image.id)).size, candidates.length);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const image of manifest.images) {
    const candidate = candidatesById.get(image.id);
    assert.ok(candidate, `${image.id}: candidate exists`);
    assert.equal(image.sourceUrl, candidate.sourceUrl);
    assert.equal(image.catalogImageUrl, candidate.imageUrl);
    assert.match(image.sourceImageUrl, /^https:\/\//u);
    assert.ok(image.attribution);
    assert.match(image.localPath, /^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u);
    const buffer = await readFile(new URL(`../public${image.localPath}`, import.meta.url));
    assert.equal(buffer.length, image.bytes, `${image.id}: byte count`);
    assert.equal(detectedContentType(buffer), image.contentType, `${image.id}: MIME signature`);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), image.sha256, `${image.id}: checksum`);
  }
});

test("every runtime card points to its local source photo", () => {
  const manifestById = new Map(manifest.images.map((image) => [image.id, image]));
  assert.ok(runtimeCatalog.recipes.length >= 200);
  for (const recipe of runtimeCatalog.recipes) {
    const image = manifestById.get(recipe.id);
    assert.ok(image, `${recipe.id}: manifest entry`);
    assert.equal(recipe.provenance.preview.kind, "source_preview");
    assert.equal(recipe.provenance.preview.imageUrl, image.localPath);
    assert.equal(recipe.provenance.preview.sourceImageUrl, image.sourceImageUrl);
    assert.equal(recipe.recipeFamily.image.imageUrl, image.localPath);
  }
});

test("every legacy source copy has one attributable, intact local photo", async () => {
  assert.equal(legacyManifest.schemaVersion, 1);
  assert.equal(legacyManifest.entries.length, 9);
  assert.deepEqual(legacyManifest.failures ?? [], []);
  assert.equal(new Set(legacyManifest.entries.map((image) => image.recipeId)).size, 9);
  for (const image of legacyManifest.entries) {
    assert.match(image.recipeId, /^src-[a-z0-9-]+$/u);
    assert.match(image.sourceUrl, /^https:\/\//u);
    assert.match(image.sourceImageUrl, /^https:\/\//u);
    assert.ok(image.attribution);
    assert.match(image.localPath, /^\/recipe-images\/legacy-src-[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u);
    const buffer = await readFile(new URL(`../public${image.localPath}`, import.meta.url));
    assert.equal(buffer.length, image.bytes, `${image.recipeId}: byte count`);
    assert.equal(detectedContentType(buffer), image.contentType, `${image.recipeId}: MIME signature`);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), image.sha256, `${image.recipeId}: checksum`);
  }
});
