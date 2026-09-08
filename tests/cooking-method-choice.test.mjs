import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../app/cooking-method-choice.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/cooking-method-choice.css", import.meta.url), "utf8");

test("cooking method choice keeps native radio and actual method facts", () => {
  assert.match(component, /<fieldset className="cooking-method-choice"/u);
  assert.match(component, /type="radio"/u);
  assert.match(component, /name=\{groupId\}/u);
  assert.match(component, /checked=\{selected\}/u);
  assert.match(component, /onChange=\{\(\) => onChange\(method\.id\)\}/u);
  assert.match(component, /requiredEquipment\.map/u);
  assert.match(component, /Number\.isFinite\(method\.timeMinutes\)/u);
  assert.match(component, /Number\.isFinite\(method\.activeMinutes\)/u);
  assert.match(component, /По рецепту/u);
  assert.match(component, /В мультиварке/u);
  assert.match(component, /В аэрогриле/u);
  assert.match(component, /method\.note/u);
  assert.doesNotMatch(component, /Обычный способ/u);
  assert.doesNotMatch(component, /список шагов, техника и время меняются вместе/u);
});

test("method cards fit a 320px viewport and retain a visible keyboard focus state", () => {
  assert.match(styles, /minmax\(min\(100%, 232px\), 1fr\)/u);
  assert.match(styles, /:has\(input:focus-visible\)/u);
  assert.match(styles, /@media \(max-width: 340px\)/u);
});
