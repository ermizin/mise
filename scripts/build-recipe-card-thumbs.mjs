/*
 * Уменьшенные фото рецептов для карточек и обложки (замечание владельца от
 * 2026-11-12: «медленно грузятся фотки»).
 *
 * Карточки каталога, меню и «Недели» шириной 110–360 px грузили исходное
 * фото: половина файлов шире 1200 px, 63 тяжелее 400 КБ, самый тяжёлый —
 * 1,3 МБ. Из каждого public/recipe-images/<имя>.<jpg|png|webp|avif> скрипт
 * делает:
 *   public/recipe-images/card/<имя>.webp    до 640 px по ширине — карточки;
 *   public/recipe-images/cover/<имя>.webp   до 1080 px — обложка рецепта, и
 *       только если исходник шире 1080 px или тяжелее 300 КБ; иначе обложка
 *       показывает исходник.
 * Фото не увеличивается: исходник уже 640 px остаётся своего размера.
 *
 * Новых фото скрипт не добавляет: это производные уже одобренных локальных
 * фото, их происхождение и решение о публикации те же, что у исходника.
 *
 * Инструменты — `sips` из macOS (читает JPEG, PNG, WebP и AVIF, уменьшает) и
 * `cwebp` (brew install webp; `sips` не пишет WebP). `--check` проверяет
 * актуальность без них.
 *
 * Манифест data/recipe-card-thumbs.json: имя исходного файла → SHA-256
 * исходника, плюс список имён с обложкой. Приложению нужен только этот
 * список: data/recipe-photo-covers.json.
 *
 * Запуск:
 *   node scripts/build-recipe-card-thumbs.mjs           пересобрать устаревшие
 *   node scripts/build-recipe-card-thumbs.mjs --force   пересобрать все
 *   node scripts/build-recipe-card-thumbs.mjs --check   только проверить (exit 1, если не актуально)
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
export const cardDirectory = resolve(sourceDirectory, "card");
export const coverDirectory = resolve(sourceDirectory, "cover");
export const manifestPath = resolve(projectRoot, "data/recipe-card-thumbs.json");
export const coversPath = resolve(projectRoot, "data/recipe-photo-covers.json");
export const cardWidth = 640;
export const cardQuality = 74;
export const cardMaxBytes = 120 * 1024;
export const coverWidth = 1080;
export const coverQuality = 72;
export const coverMinSourceBytes = 300 * 1024;
const sourceExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

const stemOf = (name) => basename(name, extname(name));
/** Публичный адрес фото для карточки по локальному фото `/recipe-images/<имя>.<ext>`. */
export function cardThumbPath(localPath) {
  return `/recipe-images/card/${stemOf(localPath)}.webp`;
}
export function coverPhotoPath(localPath) {
  return `/recipe-images/cover/${stemOf(localPath)}.webp`;
}
export function needsCover({ width, bytes }) {
  return width > coverWidth || bytes > coverMinSourceBytes;
}
/** Ширина WebP из заголовка (VP8, VP8L или VP8X). */
export function webpWidth(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return buffer.readUInt16LE(26) & 0x3fff;
  if (chunk === "VP8L") return (buffer.readUInt32LE(21) & 0x3fff) + 1;
  if (chunk === "VP8X") return buffer.readUIntLE(24, 3) + 1;
  throw new Error(`unknown WebP chunk ${chunk}`);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/* Прежние записи годятся, только если файлы собраны с теми же параметрами. */
async function readManifest() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const sameSettings =
      manifest.cardWidth === cardWidth &&
      manifest.cardQuality === cardQuality &&
      manifest.coverWidth === coverWidth &&
      manifest.coverQuality === coverQuality &&
      manifest.coverMinSourceBytes === coverMinSourceBytes;
    return sameSettings ? { thumbs: manifest.thumbs ?? {}, covers: manifest.covers ?? [] } : { thumbs: {}, covers: [] };
  } catch (error) {
    if (error.code === "ENOENT") return { thumbs: {}, covers: [] };
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

async function sourceWidth(sourcePath) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", sourcePath]);
  const width = Number(/pixelWidth:\s*(\d+)/u.exec(stdout)?.[1]);
  if (!width) throw new Error(`${basename(sourcePath)}: cannot read the width`);
  return width;
}

async function renderWebp(sourcePath, workDirectory, label, width, sourcePixelWidth, quality) {
  const sample = join(workDirectory, `${label}.png`);
  const target = join(workDirectory, `${label}.webp`);
  const resize = sourcePixelWidth > width ? ["--resampleWidth", String(width)] : [];
  await execFileAsync("sips", ["-s", "format", "png", ...resize, sourcePath, "--out", sample]);
  await execFileAsync("cwebp", ["-quiet", "-q", String(quality), "-m", "6", "-metadata", "none", sample, "-o", target]);
  const image = await readFile(target);
  const expected = Math.min(width, sourcePixelWidth);
  if (webpWidth(image) !== expected) throw new Error(`${basename(sourcePath)}: ${label} is ${webpWidth(image)}px wide, expected ${expected}px`);
  return image;
}

async function writeAtomically(target, buffer) {
  await writeFile(`${target}.tmp`, buffer);
  await rename(`${target}.tmp`, target);
}

async function mapWithLimit(items, limit, worker) {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export async function buildRecipeCardThumbs({ check = false, force = false, log = console.log } = {}) {
  const previous = await readManifest();
  const previousCovers = new Set(previous.covers);
  const names = await sourceNames();
  const stems = new Map();
  for (const name of names) {
    if (stems.has(stemOf(name))) throw new Error(`Two sources share one thumbnail name: ${stems.get(stemOf(name))} and ${name}`);
    stems.set(stemOf(name), name);
  }

  const hashes = new Map();
  const stale = [];
  for (const name of names) {
    const hash = sha256(await readFile(join(sourceDirectory, name)));
    hashes.set(name, hash);
    const current =
      !force &&
      previous.thumbs[name] === hash &&
      (await exists(join(cardDirectory, `${stemOf(name)}.webp`))) &&
      (!previousCovers.has(stemOf(name)) || (await exists(join(coverDirectory, `${stemOf(name)}.webp`))));
    if (!current) stale.push(name);
  }
  const orphaned = Object.keys(previous.thumbs).filter((name) => !hashes.has(name));

  if (check) {
    const problems = [
      ...stale.map((name) => `outdated or missing card photo: ${name}`),
      ...orphaned.map((name) => `card photo without source: ${name}`),
    ];
    for (const problem of problems) log(problem);
    if (problems.length === 0) log(`${names.length} card photos are current`);
    return { ok: problems.length === 0, built: [], removed: [], total: names.length };
  }

  if (stale.length > 0) {
    if (process.platform !== "darwin") throw new Error(`${stale.length} card photos need sips, which exists only on macOS; run this script on a Mac`);
    await execFileAsync("cwebp", ["-version"]).catch(() => {
      throw new Error("cwebp is required to write WebP: brew install webp");
    });
  }

  await mkdir(cardDirectory, { recursive: true });
  await mkdir(coverDirectory, { recursive: true });
  const covers = new Set([...previousCovers].filter((stem) => stems.has(stem)));
  const workDirectory = await mkdtemp(join(tmpdir(), "mise-card-thumbs-"));
  try {
    await mapWithLimit(stale, 6, async (name, index) => {
      const sourcePath = join(sourceDirectory, name);
      const width = await sourceWidth(sourcePath);
      const bytes = (await stat(sourcePath)).size;
      const card = await renderWebp(sourcePath, workDirectory, `card-${index}`, cardWidth, width, cardQuality);
      if (card.length > cardMaxBytes) throw new Error(`${name}: card photo is ${card.length} bytes, limit ${cardMaxBytes}`);
      await writeAtomically(join(cardDirectory, `${stemOf(name)}.webp`), card);
      const coverTarget = join(coverDirectory, `${stemOf(name)}.webp`);
      if (needsCover({ width, bytes })) {
        const cover = await renderWebp(sourcePath, workDirectory, `cover-${index}`, coverWidth, width, coverQuality);
        // Обложка тяжелее исходника не нужна: тогда обложкой остаётся исходник.
        if (cover.length < bytes) {
          await writeAtomically(coverTarget, cover);
          covers.add(stemOf(name));
          return;
        }
      }
      covers.delete(stemOf(name));
      await rm(coverTarget, { force: true });
    });
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }

  /* Производные названы по основе имени: при смене расширения источника
     (png → webp) прежняя запись «сиротеет», а файлы уже пересобраны. */
  for (const name of orphaned) {
    if (stems.has(stemOf(name))) continue;
    await rm(join(cardDirectory, `${stemOf(name)}.webp`), { force: true });
    await rm(join(coverDirectory, `${stemOf(name)}.webp`), { force: true });
  }

  const sortedCovers = [...covers].sort();
  const manifest = {
    schemaVersion: 1,
    generator: "scripts/build-recipe-card-thumbs.mjs",
    tool: "sips (macOS) + cwebp",
    source: "/recipe-images",
    cardDirectory: "/recipe-images/card",
    coverDirectory: "/recipe-images/cover",
    cardWidth,
    cardQuality,
    cardMaxBytes,
    coverWidth,
    coverQuality,
    coverMinSourceBytes,
    thumbs: Object.fromEntries([...hashes.entries()].sort(([left], [right]) => left.localeCompare(right))),
    covers: sortedCovers,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(coversPath, `${JSON.stringify(sortedCovers, null, 2)}\n`);
  log(`${stale.length} built, ${names.length - stale.length} current, ${orphaned.length} removed, ${sortedCovers.length} covers`);
  return { ok: true, built: stale, removed: orphaned, total: names.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => !["--check", "--force"].includes(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const result = await buildRecipeCardThumbs({ check: args.has("--check"), force: args.has("--force") });
  if (!result.ok) process.exit(1);
}
