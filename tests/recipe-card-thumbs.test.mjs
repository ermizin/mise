import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import test from "node:test";
import {
  buildRecipeCardThumbs,
  cardMaxBytes,
  cardThumbPath,
  cardWidth,
  coverPhotoPath,
  coverWidth,
  webpWidth,
} from "../scripts/build-recipe-card-thumbs.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const [manifest, covers, runtimeCatalog] = await Promise.all([
  readJson("data/recipe-card-thumbs.json"),
  readJson("data/recipe-photo-covers.json"),
  readJson("data/recipe-runtime-catalog.json"),
]);
const stemOf = (name) => basename(name, extname(name));

/* Замечание владельца от 2026-11-12: «медленно грузятся фотки». Карточки
   грузили исходное фото шириной до 2000 px и весом до 1,3 МБ. */
test("the card photo manifest records how the files are built", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generator, "scripts/build-recipe-card-thumbs.mjs");
  assert.equal(manifest.cardDirectory, "/recipe-images/card");
  assert.equal(manifest.coverDirectory, "/recipe-images/cover");
  assert.equal(manifest.cardWidth, cardWidth);
  assert.equal(manifest.coverWidth, coverWidth);
  assert.ok(cardWidth <= 640 && coverWidth <= 1280);
  assert.deepEqual(manifest.covers, covers, "the app reads the same list of covers");
});

test("card photos are current for every local photo", async () => {
  const messages = [];
  const result = await buildRecipeCardThumbs({ check: true, log: (message) => messages.push(message) });
  assert.ok(result.ok, `run node scripts/build-recipe-card-thumbs.mjs: ${messages.slice(0, 5).join("; ")}`);
  assert.ok(result.total >= 400);
});

test("every photo the runtime catalog shows has a small card photo", async () => {
  const records = [
    ...runtimeCatalog.recipes,
    ...(runtimeCatalog.simpleRecipes ?? []),
    ...(runtimeCatalog.extensionRecipes ?? []),
  ];
  let checked = 0;
  for (const record of records) {
    const preview = record.provenance.preview;
    if (preview.kind === "graphic_fallback") continue;
    assert.ok(manifest.thumbs[basename(preview.imageUrl)], `${record.id}: card photo is in the manifest`);
    const card = await readFile(new URL(`public${cardThumbPath(preview.imageUrl)}`, root));
    assert.ok(webpWidth(card) <= cardWidth, `${record.id}: card photo is ${webpWidth(card)} px wide`);
    assert.ok(card.length <= cardMaxBytes, `${record.id}: card photo is ${card.length} bytes`);
    checked += 1;
  }
  assert.ok(checked >= 300);
});

test("card photos are several times lighter than the photos they replace", async () => {
  let sources = 0;
  let cards = 0;
  for (const name of Object.keys(manifest.thumbs)) {
    sources += (await stat(new URL(`public/recipe-images/${name}`, root))).size;
    cards += (await stat(new URL(`public${cardThumbPath(name)}`, root))).size;
  }
  assert.ok(cards * 3 <= sources, `card photos weigh ${cards} bytes, sources ${sources}`);
});

test("a cover exists exactly for the listed heavy photos and is lighter than its source", async () => {
  const files = (await readdir(new URL("public/recipe-images/cover/", root))).filter((name) => name.endsWith(".webp")).map(stemOf).sort();
  assert.deepEqual(files, covers, "no cover without a record and no record without a cover");
  const sourceByStem = new Map(Object.keys(manifest.thumbs).map((name) => [stemOf(name), name]));
  for (const stem of covers) {
    const source = sourceByStem.get(stem);
    assert.ok(source, `${stem}: cover has a source photo`);
    const cover = await readFile(new URL(`public${coverPhotoPath(source)}`, root));
    assert.ok(webpWidth(cover) <= coverWidth, `${stem}: cover is ${webpWidth(cover)} px wide`);
    assert.ok(cover.length < (await stat(new URL(`public/recipe-images/${source}`, root))).size, `${stem}: cover is lighter than the source`);
  }
});

test("cards load the small photo, the open recipe the cover, and the source stays as a fallback", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  // Адрес выводится из пути локального фото так же, как в скрипте.
  assert.match(page, /return match \? `\/recipe-images\/card\/\$\{match\[1\]\}\.webp` : photo;/);
  assert.match(page, /return match && recipePhotoCovers\.has\(match\[1\]\) \? `\/recipe-images\/cover\/\$\{match\[1\]\}\.webp` : photo;/);
  const media = page.slice(page.indexOf("function RecipeMedia("), page.indexOf("function DeckCard("));
  assert.match(media, /const sized = cover \? recipeCoverPhotoUrl\(original\) : recipeCardPhotoUrl\(original\);/);
  assert.match(media, /const photo = sized && failedPhoto === sized \? original : sized;/, "a missing small file falls back to the source photo");
  assert.match(media, /decoding="async"/);
  // Обложка открытого рецепта и мягкий переход под ней — один файл.
  assert.match(page, /<RecipeMedia recipe=\{recipe\} eager cover \/>/);
  assert.match(page, /className="recipe-hero-soft"\s*src=\{heroSoftPhoto\}/);
  // «Неделя» показывает миниатюры блюд дня.
  assert.match(page, /const photo = recipeCardPhotoUrl\(row\.recipe\.provenance\.imageUrl\);/);
});

test("photos are cached by the browser instead of being rechecked on every visit", async () => {
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  const rule = (path) => new RegExp(`^${path.replaceAll("/", "\\/").replaceAll("*", "\\*")}\\n  Cache-Control: ([^\\n]+)$`, "mu").exec(headers)?.[1];
  assert.equal(rule("/recipe-images/*"), "public, max-age=86400, stale-while-revalidate=604800");
  assert.equal(rule("/bg/*"), "public, max-age=86400, stale-while-revalidate=604800");
  // Своё public/_headers заменяет файл сборщика, поэтому его правило повторено.
  assert.equal(rule("/_next/static/*"), "public, max-age=31536000, immutable");
});
