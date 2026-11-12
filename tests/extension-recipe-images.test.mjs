import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultModel, promptForCard, rightsStatus } from "../scripts/generate-extension-recipe-images.mjs";
import { webpWidth } from "../scripts/build-recipe-card-thumbs.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const [source, manifest, runtimeCatalog] = await Promise.all([
  readJson("data/extension-recipes.json"),
  readJson("data/extension-recipe-images.json"),
  readJson("data/recipe-runtime-catalog.json"),
]);
const imageById = new Map(manifest.images.map((image) => [image.id, image]));

/* Решение владельца от 2026-11-12: «недостающие фото сгенерь через опенраутер».
   До него 89 карточек пакета расширения показывали нейтральную заглушку. */
test("the manifest records the owner's decision and how the images were made", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generator, "scripts/generate-extension-recipe-images.mjs");
  assert.equal(manifest.ownerDecision.decisionMaker, "project_owner");
  assert.equal(manifest.ownerDecision.recordedAt, "2026-11-12");
  assert.equal(rightsStatus, "generated_for_Mise_owner_authorized_2026-11-12");
  assert.match(defaultModel, /^[a-z0-9-]+\/[a-z0-9.-]+$/u);
});

test("every card of the extension package has its own generated image", async () => {
  assert.equal(manifest.images.length, source.recipes.length);
  assert.deepEqual(manifest.images.map((image) => image.id), source.recipes.map((card) => card.id), "one image per card, in card order");
  const hashes = new Set();
  for (const card of source.recipes) {
    const image = imageById.get(card.id);
    assert.equal(image.localPath, `/recipe-images/${card.id}.webp`, card.id);
    assert.equal(image.origin, "generated", card.id);
    assert.equal(image.rightsStatus, rightsStatus, card.id);
    assert.match(image.generator, /^OpenRouter [a-z0-9-]+\/[a-z0-9.-]+$/u, `${card.id}: model`);
    assert.equal(image.subject, card.title, `${card.id}: the image was requested for this title`);
    assert.match(image.createdAt, /^\d{4}-\d{2}-\d{2}$/u, card.id);
    const bytes = await readFile(new URL(`public${image.localPath}`, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), image.sha256, `${card.id}: the file is the reviewed one`);
    assert.equal(bytes.length, image.bytes, card.id);
    assert.equal(webpWidth(bytes), 1024, `${card.id}: 1024 px wide`);
    assert.ok(bytes.length <= 220 * 1024, `${card.id}: ${bytes.length} bytes`);
    assert.ok(!hashes.has(image.sha256), `${card.id}: no two cards share one image`);
    hashes.add(image.sha256);
  }
});

test("each image was requested from the card itself and compared with it", () => {
  for (const card of source.recipes) {
    const image = imageById.get(card.id);
    // Запрос — название, продукты и шаги карточки; допустимо только уточнение после сверки.
    const prompt = promptForCard(card);
    assert.ok(image.prompt === prompt || image.prompt.startsWith(`${prompt}\nCorrection: `), `${card.id}: the prompt is built from the current card`);
    assert.match(image.prompt, /no text, no labels, no logos, no hands, no people/u, card.id);
    for (const item of card.ingredients) assert.ok(image.prompt.includes(`${item.name} ${item.grams} г`), `${card.id}: ${item.name} is in the prompt`);
    assert.notEqual(image.visualReview, "pending", `${card.id}: reviewed`);
    assert.match(image.visualReview, /^Checked against the card on \d{4}-\d{2}-\d{2}/u, `${card.id}: review note`);
  }
});

test("the runtime catalog shows the generated image and says it is generated", async () => {
  assert.equal(runtimeCatalog.extensionCoverage.withoutPhoto, 0);
  for (const record of runtimeCatalog.extensionRecipes) {
    const image = imageById.get(record.id);
    assert.deepEqual(record.provenance.preview, { kind: "generated_preview", imageUrl: image.localPath }, record.id);
    assert.equal(record.provenance.imageOrigin, "generated", record.id);
    assert.equal(record.provenance.kind, "generated", record.id);
    assert.equal(record.recipeFamily.image.photoType, "generated", record.id);
    assert.equal(record.recipeFamily.image.usageStatus, "owned", record.id);
  }
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  // Подпись под названием открытого рецепта — как у сгенерированных фото пакета «Простые».
  assert.match(page, /\(recipe\.id\.startsWith\("simple-"\) \|\| \(isExtensionRecipe\(recipe\) && hasLocalPhoto\(recipe\)\)\) && <small>\{recipe\.provenance\.kind === "generated" \? "Изображение создано для Mise; размер порции на фото условный\."/u);
});
