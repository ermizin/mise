import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const expected = [
  ["apple-touch-icon.png", 180, 180, 2],
  ["icon-192.png", 192, 192, 2],
  ["icon-512.png", 512, 512, 2],
  ["icon-maskable-512.png", 512, 512, 2],
  ["favicon-32.png", 32, 32, 2],
  ["favicon-16.png", 16, 16, 2],
  ["badge-96.png", 96, 96, 6],
  ["og-image.png", 1200, 630, 2],
];

function pngHeader(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

test("app icon B exports have the declared sizes and alpha policy", async () => {
  for (const [name, width, height, colorType] of expected) {
    const buffer = await readFile(new URL(`../public/${name}`, import.meta.url));
    assert.deepEqual(pngHeader(buffer), { width, height, colorType }, name);
  }
  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(favicon, /width="75" height="96"/);
  assert.match(favicon, /width="60" height="96"/);
  assert.match(favicon, /fill-opacity="\.2"/);
});

test("manifest, metadata and push notifications use the complete icon set", async () => {
  const [manifestText, layout, serviceWorker] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.background_color, "#FDF6EE");
  assert.equal(manifest.theme_color, "#FBF3EA");
  assert.deepEqual(manifest.icons.map(({ src, sizes, purpose }) => [src, sizes, purpose]), [
    ["/icon-192.png", "192x192", "any"],
    ["/icon-512.png", "512x512", "any"],
    ["/icon-maskable-512.png", "512x512", "maskable"],
  ]);
  assert.match(layout, /favicon\.svg/);
  assert.match(layout, /og-image\.png/);
  assert.match(serviceWorker, /badge: "\/badge-96\.png"/);
});

test("committed icon assets regenerate byte-for-byte on macOS", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mise-app-icon-"));
  try {
    execFileSync("swift", ["scripts/generate-app-icons.swift", "--output", directory], {
      cwd: fileURLToPath(root),
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(tmpdir(), "mise-swift-module-cache") },
      stdio: "pipe",
    });
    for (const [name] of expected) {
      const [committed, regenerated] = await Promise.all([
        readFile(new URL(`../public/${name}`, import.meta.url)),
        readFile(path.join(directory, name)),
      ]);
      assert.deepEqual(regenerated, committed, name);
    }
    const [committedSVG, regeneratedSVG] = await Promise.all([
      readFile(new URL("../public/favicon.svg", import.meta.url)),
      readFile(path.join(directory, "favicon.svg")),
    ]);
    assert.deepEqual(regeneratedSVG, committedSVG);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
