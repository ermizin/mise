/*
 * Предразмытые миниатюры фото рецептов (редизайн C, пакет «photos»).
 *
 * Из каждого файла public/recipe-images/<имя>.<jpg|png|webp|avif> скрипт делает
 * public/recipe-images/blur/<имя>.jpg: 48 px по ширине, JPEG качества 60, без
 * метаданных, 1–2 КБ. Растянутая на весь экран, такая миниатюра заменяет
 * runtime `filter: blur()` в фоне карточки рецепта и «Недели».
 *
 * Прямое уменьшение до 48 px на экране 390 px размыто недостаточно: видны
 * край контейнера и отдельные куски еды. Поэтому фото сначала уменьшается до
 * 16 px, а затем сглаживающей интерполяцией sips увеличивается до 48 px —
 * на телефоне это выглядит как прежний blur(30px) полного фото, без ступенек,
 * которые даёт растяжение 6–8 px.
 * Новых фото скрипт не добавляет: миниатюра — производная от уже одобренного
 * локального фото, её происхождение и решение о публикации те же, что у
 * исходника (data/recipe-image-manifest.json, data/simple-recipe-images.json,
 * data/legacy-recipe-image-download-sources.json).
 *
 * Инструмент — `sips` из macOS. Своих зависимостей для обработки изображений у
 * проекта нет, а `sips` есть на любом Mac и читает JPEG, PNG, WebP и AVIF. Он
 * записывает в JPEG блоки Exif и Photoshop, поэтому скрипт вырезает все
 * сегменты APP1–APP15 и COM, оставляя JFIF, таблицы и сами данные. На других
 * ОС пересобрать миниатюры нельзя; `--check` проверяет актуальность без `sips`.
 *
 * Манифест data/recipe-blur-thumbs.json: имя исходного файла → SHA-256
 * исходника. Миниатюра пересобирается, только если исходник изменился или её
 * файла нет; миниатюры исчезнувших исходников удаляются вместе с записями.
 *
 * Запуск:
 *   node scripts/build-recipe-blur-thumbs.mjs           пересобрать устаревшие
 *   node scripts/build-recipe-blur-thumbs.mjs --force   пересобрать все
 *   node scripts/build-recipe-blur-thumbs.mjs --check   только проверить (exit 1, если не актуально)
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const sourceDirectory = resolve(projectRoot, "public/recipe-images");
export const thumbDirectory = resolve(sourceDirectory, "blur");
export const manifestPath = resolve(projectRoot, "data/recipe-blur-thumbs.json");
export const thumbWidth = 48;
export const thumbSampleWidth = 16;
export const thumbQuality = 60;
export const thumbMaxBytes = 6 * 1024;
const sourceExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** Публичный адрес миниатюры для локального фото `/recipe-images/<имя>.<ext>`. */
export function blurThumbPath(localPath) {
  const name = basename(localPath, extname(localPath));
  return `/recipe-images/blur/${name}.jpg`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function thumbFileFor(sourceName) {
  return join(thumbDirectory, `${basename(sourceName, extname(sourceName))}.jpg`);
}

/* Обходит сегменты JPEG до начала данных (SOS). Возвращает список
   { marker, start, end } и смещение SOS. */
export function jpegSegments(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("not a JPEG file");
  const segments = [];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error(`malformed JPEG segment at byte ${offset}`);
    const marker = buffer[offset + 1];
    if (marker === 0xda) return { segments, scanStart: offset };
    const length = buffer.readUInt16BE(offset + 2);
    segments.push({ marker, start: offset, end: offset + 2 + length });
    offset += 2 + length;
  }
  throw new Error("JPEG has no image data");
}

export function isJpegMetadataMarker(marker) {
  return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
}

/** Убирает Exif, ICC, XMP, Photoshop и комментарии; JFIF и данные остаются. */
export function stripJpegMetadata(buffer) {
  const { segments, scanStart } = jpegSegments(buffer);
  const kept = segments
    .filter((segment) => !isJpegMetadataMarker(segment.marker))
    .map((segment) => buffer.subarray(segment.start, segment.end));
  return Buffer.concat([buffer.subarray(0, 2), ...kept, buffer.subarray(scanStart)]);
}

/** Ширина и высота из заголовка кадра (SOF0–SOF15, кроме DHT/JPG/DAC). */
export function jpegSize(buffer) {
  const { segments } = jpegSegments(buffer);
  const frame = segments.find(
    (segment) => segment.marker >= 0xc0 && segment.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(segment.marker),
  );
  if (!frame) throw new Error("JPEG has no frame header");
  return {
    height: buffer.readUInt16BE(frame.start + 5),
    width: buffer.readUInt16BE(frame.start + 7),
  };
}

/* Прежние записи годятся, только если миниатюры собраны с теми же параметрами. */
async function readManifest() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const sameSettings =
      manifest.width === thumbWidth &&
      manifest.sampleWidth === thumbSampleWidth &&
      manifest.quality === thumbQuality;
    return sameSettings ? manifest.thumbs ?? {} : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sourceNames() {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && sourceExtensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

async function renderThumb(sourcePath, workDirectory, index) {
  const sample = join(workDirectory, `${index}.png`);
  const temporary = join(workDirectory, `${index}.jpg`);
  await execFileAsync("sips", [
    "-s", "format", "png",
    "--resampleWidth", String(thumbSampleWidth),
    sourcePath,
    "--out", sample,
  ]);
  await execFileAsync("sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(thumbQuality),
    "--resampleWidth", String(thumbWidth),
    sample,
    "--out", temporary,
  ]);
  const thumb = stripJpegMetadata(await readFile(temporary));
  const { width } = jpegSize(thumb);
  if (width !== thumbWidth) throw new Error(`${basename(sourcePath)}: thumbnail is ${width}px wide, expected ${thumbWidth}px`);
  if (thumb.length > thumbMaxBytes) throw new Error(`${basename(sourcePath)}: thumbnail is ${thumb.length} bytes, limit ${thumbMaxBytes}`);
  return thumb;
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export async function buildRecipeBlurThumbs({ check = false, force = false, log = console.log } = {}) {
  const previous = await readManifest();
  const names = await sourceNames();
  const stems = new Map();
  for (const name of names) {
    const stem = basename(name, extname(name));
    if (stems.has(stem)) throw new Error(`Two sources share one thumbnail name: ${stems.get(stem)} and ${name}`);
    stems.set(stem, name);
  }

  const hashes = new Map();
  const stale = [];
  for (const name of names) {
    const hash = sha256(await readFile(join(sourceDirectory, name)));
    hashes.set(name, hash);
    if (force || previous[name] !== hash || !(await exists(thumbFileFor(name)))) stale.push(name);
  }
  const orphaned = Object.keys(previous).filter((name) => !hashes.has(name));

  if (check) {
    const problems = [
      ...stale.map((name) => `outdated or missing thumbnail: ${name}`),
      ...orphaned.map((name) => `thumbnail without source: ${name}`),
    ];
    for (const problem of problems) log(problem);
    if (problems.length === 0) log(`${names.length} blur thumbnails are current`);
    return { ok: problems.length === 0, built: [], removed: [], total: names.length };
  }

  if (stale.length > 0 && process.platform !== "darwin") {
    throw new Error(`${stale.length} thumbnails need sips, which exists only on macOS; run this script on a Mac`);
  }

  await mkdir(thumbDirectory, { recursive: true });
  const workDirectory = await mkdtemp(join(tmpdir(), "mise-blur-thumbs-"));
  try {
    await mapWithLimit(stale, 6, async (name, index) => {
      const thumb = await renderThumb(join(sourceDirectory, name), workDirectory, index);
      const target = thumbFileFor(name);
      const temporaryTarget = `${target}.tmp`;
      await writeFile(temporaryTarget, thumb);
      await rename(temporaryTarget, target);
    });
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }

  /* Миниатюра названа по основе имени, поэтому при смене расширения источника
     (png → webp) запись о прежнем файле «сиротеет», а её миниатюра уже
     пересобрана из нового файла — такую не удаляем. */
  for (const name of orphaned) {
    if (stems.has(basename(name, extname(name)))) continue;
    await rm(thumbFileFor(name), { force: true });
  }

  const thumbs = Object.fromEntries([...hashes.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const manifest = {
    schemaVersion: 1,
    generator: "scripts/build-recipe-blur-thumbs.mjs",
    tool: "sips (macOS)",
    source: "/recipe-images",
    directory: "/recipe-images/blur",
    width: thumbWidth,
    sampleWidth: thumbSampleWidth,
    quality: thumbQuality,
    maxBytes: thumbMaxBytes,
    thumbs,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${stale.length} built, ${names.length - stale.length} current, ${orphaned.length} removed`);
  return { ok: true, built: stale, removed: orphaned, total: names.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => !["--check", "--force"].includes(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const result = await buildRecipeBlurThumbs({ check: args.has("--check"), force: args.has("--force") });
  if (!result.ok) process.exit(1);
}
