import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRecipeImageCorrections } from "../scripts/download-recipe-images.mjs";
import { loadRecipeCorpusEntries } from "../scripts/recipe-corpus-overlay.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const manifest = await readJson("../data/recipe-image-manifest.json");
const corrections = await readJson("../data/recipe-image-corrections.json");
const candidates = (await loadRecipeCorpusEntries()).entries.map((entry) => entry.candidate);
const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
const manifestById = new Map(manifest.images.map((image) => [image.id, image]));

// Versions of one dish that their source illustrates with one photo.
const sameDishPhotos = [
  ["foodru-oblomov-ginger-chicken", "foodru-oblomov-ginger-pork"],
  ["foodru-oblomov-pepper-beef", "foodru-oblomov-pepper-chicken"],
  ["tmpm-21839", "tmpm-21841"], // Pasta e Fagioli and its weight-gain version
  ["tmpm-22181", "tmpm-24579"], // Broccoli Bites and the jalapeño cheddar version: the site shows one photo
  ["tmpm-22968", "tmpm-22980"], // HamBULKer Helper and Hamburger Helper
  ["tmpm-24968", "tmpm-24974"], // Big Boy BBQ Beef Meatballs and BBQ Beef Meatballs
];

test("a photo is shared only by versions of one dish", () => {
  // A round-up page once gave its first recipe photo to all five snacks on it.
  const idsByChecksum = new Map();
  for (const image of manifest.images) {
    idsByChecksum.set(image.sha256, [...(idsByChecksum.get(image.sha256) ?? []), image.id]);
  }
  const shared = [...idsByChecksum.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort().join(" + "));
  assert.deepEqual(shared.sort(), sameDishPhotos.map((ids) => [...ids].sort().join(" + ")).sort());
});

test("a corrected photo is the owner-approved photo of this dish from the same recipe page", () => {
  assert.equal(corrections.schemaVersion, 1);
  const acceptance = corrections.ownerPublicationRiskAcceptance;
  assert.equal(acceptance.decision, "owner_accepts_public_use_risk");
  assert.equal(acceptance.decisionMaker, "project_owner");
  assert.equal(acceptance.copyrightLicenseVerified, false);
  assert.deepEqual(
    corrections.corrections.map((correction) => correction.id),
    [
      "tmpm-17393",
      "tmpm-25006-apple-yogurt-granola",
      "tmpm-25006-avocado-bean-rice-cakes",
      "tmpm-25006-breakfast-quesadilla",
      "tmpm-25006-strawberry-lime-sorbet",
    ],
  );
  for (const correction of corrections.corrections) {
    const candidate = candidatesById.get(correction.id);
    const image = manifestById.get(correction.id);
    assert.ok(candidate && image, correction.id);
    assert.equal(correction.sourceUrl, candidate.sourceUrl, correction.id);
    // The imported photo stays on record; only the downloaded photo changes.
    assert.equal(correction.catalogImageUrl, candidate.imageUrl, correction.id);
    assert.equal(image.catalogImageUrl, candidate.imageUrl, correction.id);
    assert.equal(image.sourceImageUrl, correction.sourceImageUrl, correction.id);
    assert.notEqual(image.sourceImageUrl, image.catalogImageUrl, correction.id);
    assert.equal(image.sha256, correction.sha256, `${correction.id}: the file the owner approved`);
    assert.ok(correction.problem && correction.evidence, correction.id);
  }
});

test("an image correction applies only to the imported page and photo it was written for", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mise-image-corrections-"));
  const path = join(directory, "recipe-image-corrections.json");
  const [first] = corrections.corrections;

  await writeFile(path, JSON.stringify({ ...corrections, corrections: [{ ...first, catalogImageUrl: "https://example.com/another-photo.jpg" }] }));
  await assert.rejects(loadRecipeImageCorrections(path, candidatesById), /does not match the imported page and photo/u);

  await writeFile(path, JSON.stringify({ ...corrections, ownerPublicationRiskAcceptance: undefined }));
  await assert.rejects(loadRecipeImageCorrections(path, candidatesById), /owner's recorded publication risk decision/u);

  await writeFile(path, JSON.stringify(corrections));
  assert.equal((await loadRecipeImageCorrections(path, candidatesById)).size, corrections.corrections.length);
});
