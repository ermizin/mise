import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRecipeCorpusEntries } from "./recipe-corpus-overlay.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputDirectory = resolve(projectRoot, "public/recipe-images");
const defaultManifestPath = resolve(projectRoot, "data/recipe-image-manifest.json");
const defaultDownloadSourcesPath = resolve(projectRoot, "data/recipe-image-download-sources.json");
const defaultCorrectionsPath = resolve(projectRoot, "data/recipe-image-corrections.json");
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

// A photo the import took from another dish on the same page is replaced by
// that page's photo of this dish. A correction is tied to the imported photo
// URL, so it never applies silently after the corpus changes, and its recorded
// SHA-256 ties the owner's publication-risk decision to the exact file.
export async function loadRecipeImageCorrections(correctionsPath, candidatesById) {
  let document;
  try {
    document = JSON.parse(await readFile(correctionsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  const acceptance = document.ownerPublicationRiskAcceptance;
  if (
    document.schemaVersion !== 1 ||
    !Array.isArray(document.corrections) ||
    acceptance?.decision !== "owner_accepts_public_use_risk" ||
    acceptance?.copyrightLicenseVerified !== false ||
    !acceptance?.recordedAt
  ) {
    throw new Error("Recipe image corrections need schemaVersion 1 and the owner's recorded publication risk decision.");
  }
  const corrections = new Map();
  for (const correction of document.corrections) {
    const candidate = candidatesById.get(correction.id);
    if (!candidate) throw new Error(`${correction.id}: image correction for an unknown source card`);
    if (corrections.has(correction.id)) throw new Error(`${correction.id}: duplicate image correction`);
    if (correction.sourceUrl !== candidate.sourceUrl || correction.catalogImageUrl !== candidate.imageUrl) {
      throw new Error(`${correction.id}: image correction does not match the imported page and photo`);
    }
    if (!/^https:\/\//u.test(correction.sourceImageUrl ?? "") || correction.sourceImageUrl === correction.catalogImageUrl) {
      throw new Error(`${correction.id}: image correction needs a different https photo URL`);
    }
    if (!correction.problem || !correction.evidence) throw new Error(`${correction.id}: image correction needs the problem and the evidence`);
    if (correction.sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(correction.sha256)) {
      throw new Error(`${correction.id}: image correction checksum must be a SHA-256 hex digest`);
    }
    corrections.set(correction.id, correction);
  }
  return corrections;
}

function requireCorrectionChecksum(correction, entry) {
  if (correction?.sha256 && correction.sha256 !== entry.sha256) {
    throw new Error(`${entry.id}: corrected photo checksum ${entry.sha256} differs from the one the owner approved`);
  }
  return entry;
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
  correctionsPath = defaultCorrectionsPath,
  concurrency = 3,
} = {}) {
  const { entries } = await loadRecipeCorpusEntries({ cwd: projectRoot });
  const candidates = entries.map((entry) => entry.candidate).sort((a, b) => a.id.localeCompare(b.id));
  const invalid = candidates.filter((candidate) => !candidate.sourceUrl || !candidate.imageUrl);
  if (invalid.length) throw new Error(`Every source card needs sourceUrl and imageUrl; missing: ${invalid.map((item) => item.id).join(", ")}`);
  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== candidates.length) throw new Error("Recipe image import requires unique candidate ids.");
  const corrections = await loadRecipeImageCorrections(
    correctionsPath,
    new Map(candidates.map((candidate) => [candidate.id, candidate])),
  );

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
    const correction = corrections.get(id);
    const sourceImageUrl = correction?.sourceImageUrl ?? downloadedSource?.sourceImageUrl ?? candidate.imageUrl;
    const previous = previousEntries.get(id);
    // After the photo URL changes, the card's local file is the old photo.
    const previousPhotoReplaced = Boolean(previous && previous.sourceImageUrl !== sourceImageUrl);
    const cached =
      await existingEntry(candidate, sourceImageUrl, previous, outputDirectory) ??
      (previousPhotoReplaced ? null : await discoveredLocalEntry(candidate, sourceImageUrl, outputDirectory));
    if (cached) {
      reused += 1;
      return requireCorrectionChecksum(correction, cached);
    }
    const { buffer, contentType } = await fetchImage(candidate, sourceImageUrl);
    const extension = contentTypeExtensions.get(contentType);
    if (!extension) throw new Error(`${candidate.id}: unsupported image type ${contentType}`);
    const filename = `${id}.${extension}`;
    const absolutePath = resolve(outputDirectory, filename);
    const temporaryPath = `${absolutePath}.tmp`;
    const entry = requireCorrectionChecksum(correction, {
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
    });
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, absolutePath);
    if (previousPhotoReplaced && previous.localPath !== entry.localPath) {
      const stalePath = resolve(projectRoot, `public${previous.localPath}`);
      if (stalePath.startsWith(`${outputDirectory}/`)) await rm(stalePath, { force: true });
    }
    downloaded += 1;
    return entry;
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
