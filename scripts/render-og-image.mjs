#!/usr/bin/env node
// Рендерит public/og-image.png (1200×630) из assets/og-image/og-image.html в headless Chrome
// и записывает происхождение и контрольные суммы в assets/og-image/manifest.json.
//
//   node scripts/render-og-image.mjs
//
// Путь к Chrome переопределяется переменной CHROME. Растр Chrome зависит от его версии,
// поэтому побайтную воспроизводимость проверяет не тест, а манифест: тест сверяет SHA-256
// результата и всех исходников (HTML, экраны, фон, шрифты) с записанными здесь.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const html = "assets/og-image/og-image.html";
const output = "public/og-image.png";
const manifestPath = "assets/og-image/manifest.json";
const width = 1200;
const height = 630;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngHeader(buffer) {
  if (buffer.subarray(1, 4).toString() !== "PNG") throw new Error("Chrome did not write a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

const htmlText = await readFile(path.join(root, html), "utf8");
const localSources = [...htmlText.matchAll(/url\("([^"]+)"\)|src="([^"]+)"/g)]
  .map((match) => match[1] ?? match[2])
  .map((relative) => path.relative(root, path.resolve(path.dirname(path.join(root, html)), relative)));
if (localSources.some((source) => source.startsWith("..") || /^[a-z]+:/i.test(source))) {
  throw new Error(`og-image.html may reference only files inside the repository: ${localSources.join(", ")}`);
}

const profile = await mkdtemp(path.join(tmpdir(), "mise-og-chrome-"));
const shot = path.join(profile, "og-image.png");
try {
  // Headless Chrome on macOS sometimes exits non-zero from its teardown watchdog after the
  // screenshot is written; the PNG checks below decide whether the render succeeded.
  const run = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-color-profile=srgb",
    `--window-size=${width},${height}`,
    "--force-device-scale-factor=1",
    "--virtual-time-budget=6000",
    `--user-data-dir=${profile}`,
    `--screenshot=${shot}`,
    pathToFileURL(path.join(root, html)).href,
  ], { stdio: "pipe", timeout: 60_000 });
  const png = await readFile(shot).catch(() => {
    throw new Error(`Chrome wrote no screenshot (status ${run.status}): ${run.stderr?.toString().slice(-600)}`);
  });
  const header = pngHeader(png);
  if (header.width !== width || header.height !== height || header.colorType !== 2) {
    throw new Error(`Expected an opaque ${width}×${height} RGB PNG, got ${JSON.stringify(header)}`);
  }
  await writeFile(path.join(root, output), png);

  const version = execFileSync(chrome, ["--version"], { encoding: "utf8" }).trim();
  const files = [];
  for (const file of [html, ...new Set(localSources), output]) {
    const bytes = await readFile(path.join(root, file));
    files.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const previous = JSON.parse(await readFile(path.join(root, manifestPath), "utf8").catch(() => "{}"));
  const manifest = {
    purpose: "Open Graph / Twitter preview for https://mise.ermizinm.ru (layout.tsx metadata)",
    output: { path: output, width, height, colorType: 2 },
    renderer: { command: "node scripts/render-og-image.mjs", chrome: version },
    screens: previous.screens ?? {},
    files,
  };
  await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Rendered ${output} (${png.length} bytes) with ${version}`);
} finally {
  await rm(profile, { recursive: true, force: true });
}
