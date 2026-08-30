import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("wizard keeps its chat history in a touch-scrollable viewport", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(
    page,
    /<section className="builder-content" ref=\{builderContentRef\}>/,
  );
  assert.match(
    css,
    /\.builder-shell \{[\s\S]*?height: 100dvh;[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/,
  );
  assert.match(
    css,
    /\.builder-content \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior-y: contain;[\s\S]*?-webkit-overflow-scrolling: touch;/,
  );
  assert.match(css, /scroll-padding-bottom: calc\(112px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(
    css,
    /\.builder-chat-response \{[\s\S]*?min-height: calc\(100% - 92px\);/,
  );
  assert.match(page, /const builderContentRef = useRef<HTMLElement/);
  assert.match(
    page,
    /content\.scrollTo\(\{[\s\S]*?questionBox\.top - contentBox\.top - 22/,
  );
  assert.match(page, /menuAssemblyRef\.current\?\.scrollIntoView\(/);
  assert.doesNotMatch(page, /className="builder-menu-mode-options"/);
  assert.match(page, /const showManualMenuChoice =/);
  assert.match(page, /className="builder-chat-alternative"/);
  assert.match(page, />\s*Выбрать вручную\s*<\/button>/);
  assert.match(
    css,
    /\.builder-chat-alternative \{[\s\S]*?min-height: 56px;/,
  );
  const menuReview = page.slice(
    page.indexOf("function MenuReviewStep("),
    page.indexOf("function ReviewStep("),
  );
  assert.doesNotMatch(menuReview, /Выбрать вручную/);
  assert.equal(
    [...menuReview.matchAll(/<RecipeMedia recipe=\{recipe\} \/>/g)].length,
    2,
  );
  assert.match(
    css,
    /\.menu-row-art img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/,
  );
});
