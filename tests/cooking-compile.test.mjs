import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import manifest from "../data/cooking-operations.json" with { type: "json" };

const root = new URL("..", import.meta.url);
async function compiler() {
  const modules = {};
  for (const name of ["batch", "validate", "schedule", "compile"]) {
    const url = new URL(`domain/cooking/${name}.ts`, root), module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, resolveJsonModule: true } }).outputText, {
      module, exports: module.exports, require: (id) => modules[id] ?? (id.endsWith(".json") ? { default: createRequire(url)(id) } : createRequire(url)(id)), Map, Set, Math, Object, Array, JSON, Number, Infinity,
    }, { filename: url.pathname });
    modules[`./${name}`] = module.exports; modules[`./${name}.ts`] = module.exports;
  }
  return { ...modules["./batch"], ...modules["./validate"], ...modules["./schedule"], ...modules["./compile"] };
}
const card = (id) => manifest.recipes.find((recipe) => recipe.recipeId === id);
const inputFor = (recipe, { capacity = 5_000, checksum = recipe.sourceStepsChecksum, methodId = recipe.methodId, omitCapacity = false } = {}) => {
  const amounts = Object.fromEntries(recipe.sourceDefinition.ingredients.map((ingredient) => [ingredient.sourceIngredientId, { amount: ingredient.baseAmount, unit: ingredient.unit, canonicalId: ingredient.canonicalIngredientId, state: "raw", cut: "dice" }]));
  const logicalByKind = new Map();
  for (const use of recipe.operations.flatMap((operation) => [...operation.resources, ...(operation.resourceHolds ?? [])])) logicalByKind.set(use.kind, new Set([...(logicalByKind.get(use.kind) ?? []), use.resourceId]));
  const resources = [...logicalByKind].flatMap(([kind, logical]) => [...logical].map((_, index) => ({ id: `${kind}-${index + 1}`, kind, ...(kind === "tray" || kind === "pot" || kind === "pan" ? { capacities: omitCapacity ? {} : { g: capacity, ml: capacity } } : {}) })));
  const overrides = Object.fromEntries(recipe.operations.filter((operation) => operation.unknownDuration).map((operation) => [`dish:${operation.key}`, 90]));
  return { sessionId: "session", planId: "plan", pace: "comfortable", kitchen: { resources }, durationOverrides: overrides, recipes: [{ dishKey: "dish", recipeId: recipe.recipeId, methodId, personIds: ["person"], cookingAmounts: amounts, sourceStepsChecksum: checksum }] };
};

test("compiler preserves every exact source ingredient amount across capacity split runs", async () => {
  const { compileCookingSession } = await compiler();
  const recipe = card("tmpm-28247"), input = inputFor(recipe, { capacity: 100 });
  const compiled = compileCookingSession(input);
  assert.equal(compiled.diagnostics.length, 0);
  const expectedRuns = Math.max(...recipe.cookingLoads.map((load) => Math.ceil(load.sourceIngredientIds.reduce((sum, sourceId) => sum + input.recipes[0].cookingAmounts[sourceId].amount, 0) / 100)));
  assert.ok(compiled.operations.some((operation) => operation.title.includes(`заход ${expectedRuns} из ${expectedRuns}`)));
  const totals = new Map();
  for (const allocation of compiled.operations.flatMap((operation) => operation.allocations)) totals.set(allocation.ingredientId, (totals.get(allocation.ingredientId) ?? 0) + allocation.amount);
  for (const ingredient of recipe.sourceDefinition.ingredients) assert.equal(totals.get(ingredient.sourceIngredientId), ingredient.baseAmount, `lost ${ingredient.sourceIngredientId}`);
  const oilIds = recipe.sourceDefinition.ingredients.filter((ingredient) => ingredient.canonicalIngredientId === "olive_oil_processed").map((ingredient) => ingredient.sourceIngredientId);
  assert.equal(oilIds.length, 2); assert.notEqual(oilIds[0], oilIds[1]);
  assert.equal(totals.get(oilIds[0]), recipe.sourceDefinition.ingredients.find((item) => item.sourceIngredientId === oilIds[0]).baseAmount);
  assert.equal(totals.get(oilIds[1]), recipe.sourceDefinition.ingredients.find((item) => item.sourceIngredientId === oilIds[1]).baseAmount);
});

test("capacity and source identity failures fall back rather than compiling guessed work", async () => {
  const { compileCookingSession } = await compiler(); const recipe = card("tmpm-28247");
  for (const bad of [inputFor(recipe, { omitCapacity: true }), inputFor(recipe, { checksum: "drift" }), inputFor(recipe, { methodId: "air_fryer" })]) {
    const compiled = compileCookingSession(bad); assert.equal(compiled.operations.length, 0); assert.ok(compiled.diagnostics.length); assert.equal(compiled.fallbackReason, "verified_manifest_required");
  }
  const low = compileCookingSession(inputFor(recipe, { capacity: 100 })), high = compileCookingSession(inputFor(recipe, { capacity: 5_000 }));
  assert.ok(low.operations.length > high.operations.length, "lower verified capacity must produce more runs");
});

test("unknown source durations require an explicit per-operation override", async () => {
  const { compileCookingSession } = await compiler(); const recipe = card("tmpm-28247"); const input = inputFor(recipe);
  delete input.durationOverrides[Object.keys(input.durationOverrides)[0]];
  const compiled = compileCookingSession(input);
  assert.equal(compiled.operations.length, 0); assert.ok(compiled.diagnostics.some((item) => item.code === "duration_not_confirmed"));
});

test("all production pilot recipes compile and schedule with one confirmed cook and complete resources", async () => {
  const { compileCookingSession, scheduleCookingSession, validateCookingSchedule } = await compiler();
  const selected = manifest.recipes.map((recipe, index) => ({ ...inputFor(recipe), recipes: [{ ...inputFor(recipe).recipes[0], dishKey: `dish-${index}` }] }));
  const recipes = selected.flatMap((item) => item.recipes);
  const capacity = { capacities: { g: 5_000, ml: 5_000 } };
  const resources = [
    { id: "cook-a", kind: "cook" }, { id: "oven-a", kind: "oven" }, { id: "sink-a", kind: "sink" }, { id: "blender-a", kind: "blender" },
    { id: "pot-a", kind: "pot", ...capacity }, { id: "pot-b", kind: "pot", ...capacity }, { id: "pan-a", kind: "pan", ...capacity },
    { id: "tray-a", kind: "tray", ...capacity }, { id: "tray-b", kind: "tray", ...capacity },
    { id: "board-a", kind: "board" }, { id: "board-b", kind: "board" }, { id: "knife-a", kind: "knife" }, { id: "knife-b", kind: "knife" },
    { id: "burner-a", kind: "burner" }, { id: "burner-b", kind: "burner" },
  ];
  const overrides = Object.assign({}, ...selected.map((item) => Object.fromEntries(Object.entries(item.durationOverrides).map(([key, value]) => [key.replace("dish:", `${item.recipes[0].dishKey}:`), value]))));
  const input = { sessionId: "pilot", planId: "plan", pace: "comfortable", recipes, kitchen: { resources }, durationOverrides: overrides };
  const compiled = compileCookingSession(input);
  assert.equal(compiled.diagnostics.length, 0); assert.ok(compiled.operations.length > 30);
  assert.equal(compiled.operations.filter((operation) => operation.resources.some((resource) => resource.kind === "cook")).every((operation) => operation.resources.filter((resource) => resource.kind === "cook").length === 1), true);
  const schedule = scheduleCookingSession(compiled);
  const diagnostics = validateCookingSchedule(compiled, schedule);
  assert.equal(diagnostics.length, 0, diagnostics.map((item) => `${item.code}:${item.message}`).join("\n"));
  const ovenHolder = compiled.operations.find((operation) => operation.resourceHolds?.some((hold) => hold.kind === "oven"));
  assert.ok(ovenHolder, "source oven load must retain the only oven through physical unload");
  const ovenHold = ovenHolder.resourceHolds.find((hold) => hold.kind === "oven");
  const start = schedule.entries.find((entry) => entry.opId === ovenHolder.id).startAt;
  const end = schedule.entries.find((entry) => entry.opId === ovenHold.releaseAfterOpId).endAt;
  for (const operation of compiled.operations.filter((item) => item.dishKey !== ovenHolder.dishKey && item.resources.some((resource) => resource.resourceId === ovenHold.resourceId))) {
    const interval = schedule.entries.find((entry) => entry.opId === operation.id);
    assert.ok(interval.endAt <= start || interval.startAt >= end, `oven operation ${operation.id} overlaps retained oven lease`);
  }
});

test("two real taco-pasta portions merge prep without losing addressed allocations or dependants", async () => {
  const { compileCookingSession } = await compiler(); const recipe = card("tmpm-28083");
  const left = inputFor(recipe), right = inputFor(recipe);
  right.recipes[0].dishKey = "dish-b";
  right.durationOverrides = Object.fromEntries(Object.entries(right.durationOverrides).map(([key, value]) => [key.replace("dish:", "dish-b:"), value]));
  const input = { ...left, recipes: [left.recipes[0], right.recipes[0]], durationOverrides: { ...left.durationOverrides, ...right.durationOverrides } };
  const compiled = compileCookingSession(input);
  assert.equal(compiled.diagnostics.length, 0);
  const merged = compiled.operations.find((operation) => operation.sourceOperationIds?.length === 2);
  assert.ok(merged, "compatible real prep should merge");
  const prep = recipe.operations.find((operation) => operation.key === "prep-vegetables");
  assert.equal(merged.allocations.length, 2 * prep.allocationSourceIngredientIds.length);
  assert.deepEqual([...new Set(merged.allocations.map((allocation) => allocation.dishKey))].sort(), ["dish", "dish-b"]);
  for (const dishKey of ["dish", "dish-b"]) for (const sourceIngredientId of prep.allocationSourceIngredientIds) {
    const expected = left.recipes[0].cookingAmounts[sourceIngredientId];
    const allocation = merged.allocations.find((item) => item.dishKey === dishKey && item.ingredientId === sourceIngredientId);
    assert.ok(allocation, `missing ${dishKey}:${sourceIngredientId}`);
    assert.equal(allocation.amount, expected.amount);
    assert.equal(allocation.unit, expected.unit);
    assert.equal(allocation.canonicalId, expected.canonicalId);
  }
  assert.ok(compiled.operations.filter((operation) => operation.dependsOn.includes(merged.id)).length >= 2, "dependant loads must be rewired to merged prep");
});
