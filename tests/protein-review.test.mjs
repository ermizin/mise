import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const url = new URL("../app/ui/protein-review.tsx", import.meta.url);
const output = ts.transpileModule(await readFile(url, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
const sandbox = { exports, module: { exports }, require: createRequire(url) };
vm.runInNewContext(output, sandbox);
const { ProteinReview } = sandbox.module.exports;
const person = { id: "one", name: "Я", actual: 70, target: 150, shortfall: 80, partial: true };
const batch = { id: "first", period: "25 сент — 27 сент", people: [person] };
const render = (batches) => renderToStaticMarkup(createElement(ProteinReview, { batches, onEdit() {} }));

test("partial menu distinguishes selected protein, daily target and food outside plan", () => {
  const html = render([batch]);
  assert.match(html, /Из выбранных блюд \/ дневная цель/);
  assert.match(html, /70 г/);
  assert.match(html, /150 г/);
  assert.match(html, /Ещё 80 г вне плана/);
  assert.match(html, /Учтены только выбранные блюда/);
  assert.match(html, /type="button"/);
});

test("two batches and two participants keep distinct values and periods", () => {
  const html = render([batch, { id: "second", period: "28 сент — 30 сент", people: [
    { ...person, actual: 71, shortfall: 79 },
    { ...person, id: "two", name: "Человек 2", actual: 95, target: 120, shortfall: 25 },
  ] }]);
  for (const text of [batch.period, "28 сент — 30 сент", "Человек 2", "Ещё 79 г вне плана", "Ещё 25 г вне плана"]) assert.ok(html.includes(text));
});

test("full menu does not claim that missing protein is outside the plan", () => {
  const html = render([{ ...batch, people: [{ ...person, partial: false }] }]);
  assert.match(html, /До цели — 80 г/);
  assert.doesNotMatch(html, /вне плана|Учтены только/);
});

test("met and exceeded targets have capped bars and no negative shortfall", () => {
  for (const actual of [150, 180]) {
    const html = render([{ ...batch, people: [{ ...person, actual, shortfall: 0 }] }]);
    assert.match(html, /Цель достигнута/);
    assert.match(html, /width:100%/);
    assert.doesNotMatch(html, /Ещё /);
    assert.ok(html.includes(`${actual} г`));
  }
});
