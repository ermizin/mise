import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";
import {
  blurThumbPath,
  isJpegMetadataMarker,
  jpegSegments,
  jpegSize,
  thumbMaxBytes,
  thumbSampleWidth,
  thumbWidth,
} from "../scripts/build-recipe-blur-thumbs.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

const blurManifest = await readJson("data/recipe-blur-thumbs.json");
const imageManifest = await readJson("data/recipe-image-manifest.json");
const simpleImages = await readJson("data/simple-recipe-images.json");
const legacyImages = await readJson("data/legacy-recipe-image-download-sources.json");
const runtimeCatalog = await readJson("data/recipe-runtime-catalog.json");

/* Каждое фото, которое показывает приложение: корпус источников, пакет
   «Простые» и прежние ручные карточки. У всех трёх манифестов есть SHA-256. */
const photos = [
  ...imageManifest.images.map((image) => ({ id: image.id, localPath: image.localPath, sha256: image.sha256 })),
  ...simpleImages.images.map((image) => ({ id: image.id, localPath: image.localPath, sha256: image.sha256 })),
  ...legacyImages.entries.map((image) => ({ id: image.recipeId, localPath: image.localPath, sha256: image.sha256 })),
];

async function assertThumb(localPath, label) {
  const thumbUrl = blurThumbPath(localPath);
  assert.match(thumbUrl, /^\/recipe-images\/blur\/[a-z0-9-]+\.jpg$/u, `${label}: thumbnail path`);
  const buffer = await readFile(new URL(`public${thumbUrl}`, root));
  assert.ok(buffer.length <= thumbMaxBytes, `${label}: ${buffer.length} bytes, limit ${thumbMaxBytes}`);
  assert.ok(buffer.length <= 6 * 1024, `${label}: thumbnail is not larger than 6 KB`);
  assert.deepEqual([...buffer.subarray(0, 3)], [0xff, 0xd8, 0xff], `${label}: JPEG signature`);
  assert.equal(jpegSize(buffer).width, 48, `${label}: 48 px wide`);
  const metadata = jpegSegments(buffer).segments.filter((segment) => isJpegMetadataMarker(segment.marker));
  assert.deepEqual(metadata, [], `${label}: no Exif, ICC, XMP or comment segments`);
}

test("the blur manifest records how thumbnails are built", () => {
  assert.equal(blurManifest.schemaVersion, 1);
  assert.equal(blurManifest.generator, "scripts/build-recipe-blur-thumbs.mjs");
  assert.equal(blurManifest.directory, "/recipe-images/blur");
  assert.equal(blurManifest.width, 48);
  assert.equal(blurManifest.width, thumbWidth);
  assert.equal(blurManifest.sampleWidth, thumbSampleWidth);
  assert.ok(blurManifest.quality >= 50 && blurManifest.quality <= 70);
  assert.equal(blurManifest.maxBytes, 6 * 1024);
});

test("every recipe photo in the image manifest has a current blur thumbnail", async () => {
  assert.ok(imageManifest.images.length >= 200);
  for (const image of imageManifest.images) {
    const name = basename(image.localPath);
    assert.equal(blurManifest.thumbs[name], image.sha256, `${image.id}: thumbnail built from the approved photo`);
    await assertThumb(image.localPath, image.id);
  }
});

test("simple-pack and legacy photos have current blur thumbnails too", async () => {
  for (const photo of photos.slice(imageManifest.images.length)) {
    const name = basename(photo.localPath);
    assert.equal(blurManifest.thumbs[name], photo.sha256, `${photo.id}: thumbnail built from the approved photo`);
    await assertThumb(photo.localPath, photo.id);
  }
});

test("every photo the runtime catalog shows has a blur thumbnail", () => {
  const records = [
    ...runtimeCatalog.recipes,
    ...(runtimeCatalog.simpleRecipes ?? []),
    ...(runtimeCatalog.extensionRecipes ?? []),
  ];
  for (const record of records) {
    const preview = record.provenance.preview;
    if (preview.kind === "graphic_fallback") continue;
    assert.ok(blurManifest.thumbs[basename(preview.imageUrl)], `${record.id}: blur thumbnail`);
  }
});

test("the blur manifest has no orphaned thumbnails", async () => {
  for (const [name, sha256] of Object.entries(blurManifest.thumbs)) {
    assert.match(sha256, /^[0-9a-f]{64}$/u, `${name}: SHA-256`);
    await stat(new URL(`public/recipe-images/${name}`, root));
    await stat(new URL(`public${blurThumbPath(`/recipe-images/${name}`)}`, root));
  }
});

test("the recipe and week backgrounds use the thumbnail instead of a runtime blur", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const recipeCss = await readFile(new URL("app/redesign-c-recipe.css", root), "utf8");
  const weekCss = await readFile(new URL("app/redesign-c-week.css", root), "utf8");

  // Миниатюра выводится из пути локального фото так же, как в скрипте.
  assert.match(page, /return match \? `\/recipe-images\/blur\/\$\{match\[1\]\}\.jpg` : null;/);
  // Фон карточки рецепта — CSS-слой с миниатюрой, без <img> под filter: blur().
  const backdrop = page.slice(page.indexOf('className="recipe-backdrop"'), page.indexOf('<div className="recipe-hero-photo">'));
  assert.match(backdrop, /"--recipe-thumb": `url\("\$\{heroThumb\}"\)`/);
  assert.doesNotMatch(backdrop, /<img/);
  const photosRecipe = recipeCss.slice(recipeCss.indexOf("Пакет «photos»"));
  assert.match(photosRecipe, /\.recipe-backdrop::before \{[^}]*var\(--recipe-thumb, none\) center \/ cover no-repeat/);
  assert.doesNotMatch(photosRecipe, /blur\(/);
  // Без миниатюры остаётся прежний /bg/recipe.jpg.
  assert.match(recipeCss, /--bg-photo: url\("\/bg\/recipe\.jpg"\)/);
  assert.match(photosRecipe, /\.recipe-detail\.has-hero-photo \.recipe-backdrop \{\s*background: var\(--bg-photo\) center \/ cover no-repeat, var\(--bg-base\);/);

  // «Неделя»: слои миниатюр сменяются прозрачностью, без размытия.
  const photosWeek = weekCss.slice(weekCss.indexOf("Пакет «photos»"));
  assert.match(photosWeek, /\.week-photo-layer\.is-active \{[^}]*opacity: 1;[^}]*transition: opacity/);
  assert.doesNotMatch(photosWeek, /blur\(/);
  assert.match(page, /\{tab === "week" && <WeekPhotoBackdrop backdrop=\{weekBackdrop\} \/>\}/);
});

test("showcases pick photographed dishes deterministically", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const showcase = page.slice(page.indexOf("function deckDishes("), page.indexOf("function currentBatchLabel("));
  assert.doesNotMatch(showcase, /Math\.random/);
  assert.match(showcase, /function onboardingPhotoRecipes\(count: number\) \{\s*const withPhoto = showcaseOrder\(newMenuRecipes\)\.filter\(hasLocalPhoto\);/);
  assert.match(showcase, /ownShowcase\.find\(\(item\) => fits\(item\) && hasLocalPhoto\(item\)\) \?\?\s*catalogShowcase\.find\(\(item\) => fits\(item\) && hasLocalPhoto\(item\)\)/);
  // Каталог: «сначала те, где меньше докупать» остаётся главным ключом, фото — только при равенстве.
  assert.match(page, /return diff \|\| photoDifference \|\| timeDifference;/);
});
