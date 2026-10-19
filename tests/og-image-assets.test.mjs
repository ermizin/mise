import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file, encoding) => readFile(path.join(root, file), encoding);

test("og-image matches its recorded HTML source, screens and render", async () => {
  const manifest = JSON.parse(await read("assets/og-image/manifest.json", "utf8"));
  assert.deepEqual(manifest.output, { path: "public/og-image.png", width: 1200, height: 630, colorType: 2 });
  assert.equal(manifest.renderer.command, "node scripts/render-og-image.mjs");
  const recorded = new Map(manifest.files.map((file) => [file.path, file]));
  for (const required of [
    "assets/og-image/og-image.html",
    "assets/og-image/screens/week.png",
    "assets/og-image/screens/plan-ready.png",
    "public/og-image.png",
  ]) assert.ok(recorded.has(required), `${required} is recorded`);
  for (const file of manifest.files) {
    const bytes = await read(file.path);
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
  }

  const png = await read("public/og-image.png");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [1200, 630, 2]);
  for (const screen of ["week", "plan-ready"]) {
    const shot = await read(`assets/og-image/screens/${screen}.png`);
    assert.deepEqual([shot.readUInt32BE(16), shot.readUInt32BE(20)], [780, 1688], `${screen} is a 390×844 @2x capture`);
  }
});

test("og-image source is self-contained and carries the approved headline", async () => {
  const html = await read("assets/og-image/og-image.html", "utf8");
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*"(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /Готовим раз&nbsp;—<br>едим всю неделю/);
  assert.match(html, /mise\.ermizinm\.ru/);
  const layout = await read("app/layout.tsx", "utf8");
  assert.match(layout, /images: \[\{ url: "\/og-image\.png", width: 1200, height: 630/);
});
