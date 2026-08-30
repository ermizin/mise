import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRecipeCorpusEntries } from "./recipe-corpus-overlay.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputDirectory = resolve(projectRoot, "public/recipe-images");
const defaultManifestPath = resolve(projectRoot, "data/recipe-image-manifest.json");
const defaultDownloadSourcesPath = resolve(projectRoot, "data/recipe-image-download-sources.json");
const contentTypeExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function detectedImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString("ascii").includes("ftypavif")) return "image/avif";
  return null;
}

function safeId(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) throw new Error(`Unsafe recipe id for image path: ${id}`);
  return id;
}

async function fetchImage(candidate, sourceImageUrl) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(sourceImageUrl, {
        redirect: "follow",
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "user-agent": "Mise recipe image importer/1.0",
        },
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (retryable && attempt < 5) throw new Error(`${response.status} ${response.statusText}`);
        throw new Error(`${candidate.id}: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1024) throw new Error(`${candidate.id}: image is unexpectedly small (${buffer.length} bytes)`);
      if (buffer.length > 15 * 1024 * 1024) throw new Error(`${candidate.id}: image exceeds the 15 MB asset limit`);
      const detectedContentType = detectedImageType(buffer);
      if (!detectedContentType) throw new Error(`${candidate.id}: response is not a supported image`);
      const declaredContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
      if (declaredContentType?.startsWith("image/") && declaredContentType !== detectedContentType) {
        throw new Error(`${candidate.id}: declared ${declaredContentType}, received ${detectedContentType}`);
      }
      return { buffer, contentType: detectedContentType };
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`${candidate.id}: failed after 5 attempts`, { cause: lastError });
}

async function existingEntry(candidate, sourceImageUrl, manifestEntry, outputDirectory) {
  if (
    !manifestEntry ||
    manifestEntry.catalogImageUrl !== candidate.imageUrl ||
    manifestEntry.sourceImageUrl !== sourceImageUrl ||
    manifestEntry.sourceUrl !== candidate.sourceUrl
  ) return null;
  const absolutePath = resolve(projectRoot, `public${manifestEntry.localPath}`);
  if (!absolutePath.startsWith(`${outputDirectory}/`)) return null;
  try {
    const [buffer, file] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    if (!file.isFile() || buffer.length !== manifestEntry.bytes || sha256(buffer) !== manifestEntry.sha256) return null;
    if (detectedImageType(buffer) !== manifestEntry.contentType) return null;
    return manifestEntry;
  } catch {
    return null;
  }
}

async function discoveredLocalEntry(candidate, sourceImageUrl, outputDirectory) {
  for (const [contentType, extension] of contentTypeExtensions) {
    const absolutePath = resolve(outputDirectory, `${safeId(candidate.id)}.${extension}`);
    try {
      const [buffer, file] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
      if (!file.isFile() || buffer.length < 1024 || detectedImageType(buffer) !== contentType) continue;
      return {
        id: candidate.id,
        sourceTitle: candidate.sourceTitle,
        sourceUrl: candidate.sourceUrl,
        catalogImageUrl: candidate.imageUrl,
        sourceImageUrl,
        localPath: `/recipe-images/${candidate.id}.${extension}`,
        contentType,
        bytes: buffer.length,
        sha256: sha256(buffer),
        attribution: candidate.sourceTitle,
      };
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export async function downloadRecipeImages({
  outputDirectory = defaultOutputDirectory,
  manifestPath = defaultManifestPath,
  downloadSourcesPath = defaultDownloadSourcesPath,
  concurrency = 3,
} = {}) {
  const { entries } = await loadRecipeCorpusEntries({ cwd: projectRoot });
  const candidates = entries.map((entry) => entry.candidate).sort((a, b) => a.id.localeCompare(b.id));
  const invalid = candidates.filter((candidate) => !candidate.sourceUrl || !candidate.imageUrl);
  if (invalid.length) throw new Error(`Every source card needs sourceUrl and imageUrl; missing: ${invalid.map((item) => item.id).join(", ")}`);
  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== candidates.length) throw new Error("Recipe image import requires unique candidate ids.");

  let previousEntries = new Map();
  try {
    const previous = JSON.parse(await readFile(manifestPath, "utf8"));
    previousEntries = new Map((previous.images ?? []).map((entry) => [entry.id, entry]));
  } catch {
    previousEntries = new Map();
  }
  let downloadedSourceEntries = new Map();
  try {
    const downloadedSources = JSON.parse(await readFile(downloadSourcesPath, "utf8"));
    if (downloadedSources.schemaVersion !== 1 || !Array.isArray(downloadedSources.entries)) {
      throw new Error("Recipe image download sources must use schemaVersion 1.");
    }
    downloadedSourceEntries = new Map(downloadedSources.entries.map((entry) => [entry.id, entry]));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(outputDirectory, { recursive: true });

  let downloaded = 0;
  let reused = 0;
  const images = await mapConcurrent(candidates, concurrency, async (candidate) => {
    const id = safeId(candidate.id);
    const downloadedSource = downloadedSourceEntries.get(id);
    if (
      downloadedSource &&
      (downloadedSource.sourceUrl !== candidate.sourceUrl || downloadedSource.catalogImageUrl !== candidate.imageUrl)
    ) {
      throw new Error(`${id}: downloaded source metadata does not match the candidate provenance`);
    }
    const sourceImageUrl = downloadedSource?.sourceImageUrl ?? candidate.imageUrl;
    const cached =
      await existingEntry(candidate, sourceImageUrl, previousEntries.get(id), outputDirectory) ??
      await discoveredLocalEntry(candidate, sourceImageUrl, outputDirectory);
    if (cached) {
      reused += 1;
      return cached;
    }
    const { buffer, contentType } = await fetchImage(candidate, sourceImageUrl);
    const extension = contentTypeExtensions.get(contentType);
    if (!extension) throw new Error(`${candidate.id}: unsupported image type ${contentType}`);
    const filename = `${id}.${extension}`;
    const absolutePath = resolve(outputDirectory, filename);
    const temporaryPath = `${absolutePath}.tmp`;
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, absolutePath);
    downloaded += 1;
    return {
      id,
      sourceTitle: candidate.sourceTitle,
      sourceUrl: candidate.sourceUrl,
      catalogImageUrl: candidate.imageUrl,
      sourceImageUrl,
      localPath: `/recipe-images/${filename}`,
      contentType,
      bytes: buffer.length,
      sha256: sha256(buffer),
      attribution: candidate.sourceTitle,
    };
  });

  const manifest = {
    schemaVersion: 1,
    policy: "local-source-copy-with-attribution",
    sourceCardCount: candidates.length,
    images,
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  const temporaryManifest = `${manifestPath}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryManifest, manifestPath);
  return { manifest, downloaded, reused, bytes: images.reduce((sum, image) => sum + image.bytes, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await downloadRecipeImages();
  process.stdout.write(`${JSON.stringify({ images: result.manifest.images.length, downloaded: result.downloaded, reused: result.reused, bytes: result.bytes })}\n`);
}
