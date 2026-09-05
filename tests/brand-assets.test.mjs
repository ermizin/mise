import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("released brand vectors match their provenance and need no external fonts or images", async () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("assets/brand/manifest.json", root), "utf8"));
  assert.equal(manifest.assets.length, 2);
  for (const asset of manifest.assets) {
    const bytes = await readFile(new URL(asset.path, root));
    const svg = bytes.toString("utf8");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    assert.match(svg, new RegExp(`viewBox="0 0 ${asset.width} ${asset.height}"`));
    assert.equal(asset.transparent, true);
    assert.doesNotMatch(svg, /<(?:text|script|image|foreignObject)\b|(?:href|src)\s*=/i);
    assert.doesNotMatch(svg, new RegExp(`<rect[^>]*width="${asset.width}"[^>]*height="${asset.height}"`));
  }
});
