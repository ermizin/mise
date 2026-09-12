import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import manifest from "../data/cooking-operations.json" with { type: "json" };
import actionCatalog from "../data/cooking-action-catalog.json" with { type: "json" };

const root = new URL("..", import.meta.url);
async function compiler() {
  const modules = {};
  const actionsUrl = new URL("domain/cooking-actions.ts", root), actionsModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(await readFile(actionsUrl, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    module: actionsModule, exports: actionsModule.exports, Map, Set, Math, Object, Array, JSON, Number, Infinity, RegExp,
  }, { filename: actionsUrl.pathname });
  modules["../cooking-actions"] = actionsModule.exports;
  for (const name of ["batch", "validate", "schedule", "guided", "compile"]) {
    const url = new URL(`domain/cooking/${name}.ts`, root), compiledModule = { exports: {} };
    vm.runInNewContext(ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, resolveJsonModule: true } }).outputText, {
      module: compiledModule, exports: compiledModule.exports, require: (id) => modules[id] ?? (id.endsWith(".json") ? { default: createRequire(url)(id) } : createRequire(url)(id)), Map, Set, Math, Object, Array, JSON, Number, Infinity,
    }, { filename: url.pathname });
    modules[`./${name}`] = compiledModule.exports; modules[`./${name}.ts`] = compiledModule.exports;
  }
  return { ...modules["./batch"], ...modules["./validate"], ...modules["./schedule"], ...modules["./compile"] };
}
const card = (id) => manifest.recipes.find((recipe) => recipe.recipeId === id);
const inputFor = (recipe, { capacity = 5_000, checksum = recipe.sourceStepsChecksum, methodId = recipe.methodId, omitCapacity = false } = {}) => {
  const amounts = Object.fromEntries(recipe.sourceDefinition.ingredients.map((ingredient) => [ingredient.sourceIngredientId, { amount: ingredient.baseAmount, unit: ingredient.unit, canonicalId: ingredient.canonicalIngredientId, state: "raw", cut: "dice" }]));
  const logicalByKind = new Map();
  for (const resourceUse of recipe.operations.flatMap((operation) => [...operation.resources, ...(operation.resourceHolds ?? [])])) logicalByKind.set(resourceUse.kind, new Set([...(logicalByKind.get(resourceUse.kind) ?? []), resourceUse.resourceId]));
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

const genericInput = (recipe, method, { dishKey = "guided", actions = {} } = {}) => ({
  sessionId: `guided-${dishKey}`, planId: "plan", pace: "speed",
  kitchen: { resources: [{ id: "cook-a", kind: "cook" }, { id: "oven-a", kind: "oven" }, { id: "fridge-a", kind: "fridge" }, { id: "burner-a", kind: "burner" }, { id: "pot-a", kind: "pot" }, { id: "pan-a", kind: "pan" }, { id: "dish-a", kind: "baking_dish" }, { id: "blender-a", kind: "blender" }, { id: "waffle-a", kind: "waffle_iron" }, { id: "microwave-a", kind: "microwave" }, { id: "air-a", kind: "air_fryer" }, { id: "multicooker-a", kind: "multicooker" }, { id: "pressure-a", kind: "pressure_cooker" }] },
  guidedConfig: { schemaVersion: 1, activeStepSeconds: 45, actions },
  recipes: [{ dishKey, recipeId: recipe.recipeId, methodId: method.methodId, personIds: ["person"], sourceStepsChecksum: method.graphFingerprint, cookingAmounts: Object.fromEntries(recipe.ingredientDefinitions.map(item => [item.id, { amount: item.amount, unit: item.unit, canonicalId: item.canonicalId, state: "raw" }])) }],
});

const candidateResourceIds = (method, candidate) => {
  if (candidate.category === "oven") return ["oven-a", "dish-a"];
  if (method.requiredEquipment.includes("multicooker")) return ["multicooker-a"];
  if (method.requiredEquipment.includes("pressure_cooker")) return ["pressure-a"];
  return ["burner-a", ...method.requiredEquipment.filter(item => item === "pot" || item === "pan").map(item => `${item}-a`)];
};
const equipmentKind = { baking_dish: "baking_dish", oven: "oven", pan: "pan", stove: "burner", blender: "blender", waffle_iron: "waffle_iron", pot: "pot", multicooker: "multicooker", pressure_cooker: "pressure_cooker", microwave: "microwave", air_fryer: "air_fryer" };

test("every catalog method compiles with explicit global active pace and exact ingredient identities", async () => {
  const { compileCookingSession, cookingSourceDescriptor, guidedCookingMethod } = await compiler();
  let compiledMethods = 0;
  for (const recipe of actionCatalog.recipes) for (const method of recipe.methods) {
    const descriptor = cookingSourceDescriptor(recipe.recipeId, method.methodId);
    assert.ok(descriptor, `${recipe.recipeId}:${method.methodId} descriptor`);
    if (manifest.recipes.some(item => item.recipeId === recipe.recipeId && item.methodId === method.methodId)) {
      assert.equal(guidedCookingMethod(recipe.recipeId, method.methodId), undefined);
      continue;
    }
    const compiled = compileCookingSession(genericInput(recipe, method));
    assert.equal(compiled.diagnostics.length, 0, `${recipe.recipeId}:${method.methodId} ${JSON.stringify(compiled.diagnostics)}`);
    assert.ok(compiled.operations.length >= method.actions.length + 1);
    const allocations = compiled.operations.flatMap(operation => operation.allocations);
    assert.equal(allocations.length, recipe.ingredientDefinitions.length);
    const requiredKinds = method.requiredEquipment.map(item => equipmentKind[item]);
    for (const operation of compiled.operations.filter(item => item.attention === "required" && item.sourceOperationIds?.length)) {
      assert.ok(operation.resources.some(resource => resource.kind === "cook"));
      for (const kind of requiredKinds) assert.ok(operation.resources.some(resource => resource.kind === kind), `${operation.id} must retain ${kind}`);
    }
    compiledMethods += 1;
  }
  assert.ok(compiledMethods >= 300);
});

test("guided oven and stove candidates preserve source evidence, hold equipment, and interleave safely", async () => {
  const { compileCookingSession, scheduleCookingSession, validateCookingSchedule } = await compiler();
  const oven = actionCatalog.recipes.flatMap(recipe => recipe.methods.map(method => ({ recipe, method }))).find(({ method }) => method.requiredEquipment.includes("oven") && method.requiredEquipment.includes("baking_dish") && !method.requiredEquipment.some(item => item === "stove" || item === "pot" || item === "pan") && method.actions.some(action => action.backgroundCandidate?.category === "oven"));
  const stove = actionCatalog.recipes.flatMap(recipe => recipe.methods.map(method => ({ recipe, method }))).find(({ method }) => method.requiredEquipment.includes("stove") && !method.requiredEquipment.includes("multicooker") && method.actions.some(action => action.backgroundCandidate?.category === "boil"));
  assert.ok(oven && stove);
  const ovenAction = oven.method.actions.find(action => action.backgroundCandidate?.category === "oven");
  const stoveAction = stove.method.actions.find(action => action.backgroundCandidate?.category === "boil");
  const input = genericInput(oven.recipe, oven.method, { dishKey: "oven", actions: { [`oven:${ovenAction.id}`]: { durationSeconds: ovenAction.backgroundCandidate.durationSeconds, resourceIds: candidateResourceIds(oven.method, ovenAction.backgroundCandidate), allBatchFits: true } } });
  input.recipes.push({ ...genericInput(stove.recipe, stove.method, { dishKey: "stove", actions: { [`stove:${stoveAction.id}`]: { durationSeconds: stoveAction.backgroundCandidate.durationSeconds, resourceIds: candidateResourceIds(stove.method, stoveAction.backgroundCandidate), allBatchFits: true } } }).recipes[0] });
  input.guidedConfig.actions[`stove:${stoveAction.id}`] = { durationSeconds: stoveAction.backgroundCandidate.durationSeconds, resourceIds: candidateResourceIds(stove.method, stoveAction.backgroundCandidate), allBatchFits: true };
  const compiled = compileCookingSession(input);
  assert.equal(compiled.diagnostics.length, 0, JSON.stringify(compiled.diagnostics));
  const heat = compiled.operations.find(operation => operation.kind === "heat" && operation.dishKey === "oven");
  const check = compiled.operations.find(operation => operation.kind === "intervention" && operation.dependsOn.includes(heat?.id));
  const cleanup = compiled.operations.find(operation => operation.kind === "wash" && operation.dishKey === "oven");
  assert.ok(heat && check && cleanup && heat.resourceHolds?.some(hold => hold.resourceId === "oven-a" && hold.releaseAfterOpId === cleanup.id));
  assert.ok(heat.resourceHolds?.some(hold => hold.resourceId === "dish-a" && hold.releaseAfterOpId === cleanup.id));
  const sourceAction = oven.method.actions.find(action => action.id === heat.sourceOperationIds?.[0]);
  assert.equal(heat.sourceText, oven.method.sourceSteps[sourceAction.sourceStepIndex]);
  const schedule = scheduleCookingSession(compiled);
  assert.equal(validateCookingSchedule(compiled, schedule).length, 0);
  assert.equal(schedule.mode, "optimized");
  const stoveHeat = compiled.operations.find(operation => operation.kind === "heat" && operation.dishKey === "stove");
  const ovenInterval = schedule.entries.find(entry => entry.opId === heat.id), stoveInterval = schedule.entries.find(entry => entry.opId === stoveHeat?.id);
  assert.ok(ovenInterval.startAt < stoveInterval.endAt && stoveInterval.startAt < ovenInterval.endAt, "independent confirmed background chains should interleave");
  const invalid = structuredClone(input);
  invalid.guidedConfig.actions[`oven:${ovenAction.id}`].durationSeconds -= 1;
  assert.ok(compileCookingSession(invalid).diagnostics.some(item => item.code === "guided_background_config_invalid"));
  const drift = structuredClone(input);
  drift.recipes[0].sourceStepsChecksum = "changed-source";
  assert.ok(compileCookingSession(drift).diagnostics.some(item => item.code === "guided_config_required"));
  const unknown = structuredClone(input);
  unknown.guidedConfig.actions["oven:not-a-source-action"] = { durationSeconds: 1, resourceIds: ["oven-a", "dish-a"], allBatchFits: true };
  assert.ok(compileCookingSession(unknown).diagnostics.some(item => item.code === "guided_background_config_invalid"));
  const missingEquipment = structuredClone(input);
  missingEquipment.kitchen.resources = missingEquipment.kitchen.resources.filter(resource => resource.kind !== "oven");
  assert.ok(compileCookingSession(missingEquipment).diagnostics.some(item => item.code === "resource_unavailable"));
  const missingVessel = structuredClone(input);
  missingVessel.guidedConfig.actions[`oven:${ovenAction.id}`].resourceIds = ["oven-a"];
  assert.ok(compileCookingSession(missingVessel).diagnostics.some(item => item.code === "guided_heat_resource_invalid"));
});

test("every current source-backed candidate compiles with its source appliance and requires an immediate check", async () => {
  const { compileCookingSession, scheduleCookingSession, validateCookingSchedule } = await compiler();
  let candidates = 0;
  for (const recipe of actionCatalog.recipes) for (const method of recipe.methods) for (const action of method.actions.filter(item => item.backgroundCandidate)) {
    const dishKey = `candidate-${candidates}`;
    const resources = candidateResourceIds(method, action.backgroundCandidate);
    const input = genericInput(recipe, method, { dishKey, actions: { [`${dishKey}:${action.id}`]: { durationSeconds: action.backgroundCandidate.durationSeconds, resourceIds: resources, allBatchFits: true } } });
    const compiled = compileCookingSession(input);
    assert.equal(compiled.diagnostics.length, 0, `${recipe.recipeId}:${method.methodId}:${action.id} ${JSON.stringify(compiled.diagnostics)}`);
    const heat = compiled.operations.find(operation => operation.kind === "heat" && operation.sourceOperationIds?.[0] === action.id);
    const check = compiled.operations.find(operation => operation.kind === "intervention" && operation.dependsOn.includes(heat?.id));
    assert.ok(heat && check && heat.requiresCheckAtEnd && heat.checkDeadlineSeconds === 0);
    assert.equal(heat.sourceText, method.sourceSteps[action.sourceStepIndex]);
    const schedule = scheduleCookingSession(compiled);
    assert.equal(validateCookingSchedule(compiled, schedule).length, 0);
    candidates += 1;
  }
  assert.equal(candidates, 48);
});

test("generic cookware is leased to cleanup: disjoint stove work can run during an oven timer, but a second oven waits", async () => {
  const { compileCookingSession, scheduleCookingSession, validateCookingSchedule } = await compiler();
  const oven = actionCatalog.recipes.flatMap(recipe => recipe.methods.map(method => ({ recipe, method }))).find(({ method }) => method.actions.some(action => action.backgroundCandidate?.category === "oven"));
  const stove = actionCatalog.recipes.flatMap(recipe => recipe.methods.map(method => ({ recipe, method }))).find(({ method }) => method.requiredEquipment.includes("stove") && !method.requiredEquipment.includes("multicooker") && method.actions.some(action => action.backgroundCandidate?.category === "boil"));
  assert.ok(oven && stove);
  const ovenAction = oven.method.actions.find(action => action.backgroundCandidate?.category === "oven");
  const stoveAction = stove.method.actions.find(action => action.backgroundCandidate?.category === "boil");
  const input = genericInput(oven.recipe, oven.method, { dishKey: "oven-a", actions: { [`oven-a:${ovenAction.id}`]: { durationSeconds: ovenAction.backgroundCandidate.durationSeconds, resourceIds: ["oven-a", "dish-a"], allBatchFits: true } } });
  input.recipes.push({ ...genericInput(stove.recipe, stove.method, { dishKey: "stove", actions: { [`stove:${stoveAction.id}`]: { durationSeconds: stoveAction.backgroundCandidate.durationSeconds, resourceIds: ["burner-a", ...stove.method.requiredEquipment.filter(item => item === "pot" || item === "pan").map(item => `${item}-a`)], allBatchFits: true } } }).recipes[0] });
  input.guidedConfig.actions[`stove:${stoveAction.id}`] = { durationSeconds: stoveAction.backgroundCandidate.durationSeconds, resourceIds: ["burner-a", ...stove.method.requiredEquipment.filter(item => item === "pot" || item === "pan").map(item => `${item}-a`)], allBatchFits: true };
  const compiled = compileCookingSession(input), schedule = scheduleCookingSession(compiled);
  assert.equal(compiled.diagnostics.length, 0, JSON.stringify(compiled.diagnostics));
  assert.equal(validateCookingSchedule(compiled, schedule).length, 0);
  const ovenHeat = compiled.operations.find(operation => operation.kind === "heat" && operation.dishKey === "oven-a");
  const ovenHeatEntry = schedule.entries.find(entry => entry.opId === ovenHeat.id);
  assert.ok(compiled.operations.filter(operation => operation.dishKey === "stove").some(operation => { const entry = schedule.entries.find(item => item.opId === operation.id); return entry.startAt < ovenHeatEntry.endAt && ovenHeatEntry.startAt < entry.endAt; }));
  const wrongAppliance = structuredClone(input);
  wrongAppliance.guidedConfig.actions[`stove:${stoveAction.id}`].resourceIds = ["multicooker-a"];
  assert.ok(compileCookingSession(wrongAppliance).diagnostics.some(item => item.code === "guided_heat_resource_invalid"), "a stove method cannot silently become multicooker cooking");
  const duplicate = structuredClone(input);
  duplicate.recipes = [duplicate.recipes[0], { ...duplicate.recipes[0], dishKey: "oven-b" }];
  duplicate.guidedConfig.actions = {
    [`oven-a:${ovenAction.id}`]: { durationSeconds: ovenAction.backgroundCandidate.durationSeconds, resourceIds: ["oven-a", "dish-a"], allBatchFits: true },
    [`oven-b:${ovenAction.id}`]: { durationSeconds: ovenAction.backgroundCandidate.durationSeconds, resourceIds: ["oven-a", "dish-a"], allBatchFits: true },
  };
  const doubleCompiled = compileCookingSession(duplicate), doubleSchedule = scheduleCookingSession(doubleCompiled);
  assert.equal(validateCookingSchedule(doubleCompiled, doubleSchedule).length, 0);
  const firstCleanup = doubleCompiled.operations.find(operation => operation.kind === "wash" && operation.dishKey === "oven-a");
  const secondStart = doubleCompiled.operations.find(operation => operation.kind === "start_heat" && operation.dishKey === "oven-b");
  assert.ok(doubleSchedule.entries.find(entry => entry.opId === secondStart.id).startAt >= doubleSchedule.entries.find(entry => entry.opId === firstCleanup.id).endAt);
});

test("capacity and source identity failures fall back rather than compiling guessed work", async () => {
  const { compileCookingSession } = await compiler(); const recipe = card("tmpm-28247");
  for (const bad of [inputFor(recipe, { omitCapacity: true }), inputFor(recipe, { checksum: "drift" }), inputFor(recipe, { methodId: "air_fryer" })]) {
    const compiled = compileCookingSession(bad); assert.equal(compiled.operations.length, 0); assert.ok(compiled.diagnostics.length); assert.equal(compiled.fallbackReason, "verified_manifest_required");
  }
  const low = compileCookingSession(inputFor(recipe, { capacity: 100 })), high = compileCookingSession(inputFor(recipe, { capacity: 5_000 }));
  assert.ok(low.operations.length > high.operations.length, "lower verified capacity must produce more runs");
});

test("capacity loads include every physically loaded native-unit ingredient", async () => {
  const { compileCookingSession, cookingRequirements } = await compiler();
  const chicken = card("tmpm-28247"), nuggets = card("tmpm-26965");
  const chickenInput = inputFor(chicken);
  const chickenLoads = cookingRequirements(chickenInput);
  assert.deepEqual(chickenLoads.filter((load) => load.resourceId === "tray-1").map((load) => [load.capacityUnit, load.ingredientIds]).sort((a, b) => a[0].localeCompare(b[0])), [
    ["g", ["source-ingredient-1"]], ["ml", ["source-ingredient-2"]],
  ]);
  assert.deepEqual(chickenLoads.filter((load) => load.resourceId === "tray-2").map((load) => [load.capacityUnit, load.ingredientIds]).sort((a, b) => a[0].localeCompare(b[0])), [
    ["g", ["source-ingredient-6", "source-ingredient-7"]], ["ml", ["source-ingredient-8"]],
  ]);
  const nuggetInput = inputFor(nuggets);
  assert.deepEqual(cookingRequirements(nuggetInput).filter((load) => load.resourceId === "tray-1").map((load) => [load.capacityUnit, load.ingredientIds]).sort((a, b) => a[0].localeCompare(b[0])), [
    ["g", ["source-ingredient-1", "source-ingredient-2", "source-ingredient-3", "source-ingredient-4"]], ["ml", ["source-ingredient-8"]],
  ]);
  for (const resource of chickenInput.kitchen.resources.filter((resource) => resource.kind === "tray")) delete resource.capacities.ml;
  const missingMlCapacity = compileCookingSession(chickenInput);
  assert.equal(missingMlCapacity.operations.length, 0);
  assert.ok(missingMlCapacity.diagnostics.some((item) => item.code === "capacity_not_confirmed"));
  const splitByMl = inputFor(chicken, { capacity: 5_000 });
  for (const resource of splitByMl.kitchen.resources.filter((resource) => resource.kind === "tray")) resource.capacities.ml = 1;
  const compiled = compileCookingSession(splitByMl);
  assert.equal(compiled.diagnostics.length, 0);
  assert.ok(compiled.operations.some((operation) => operation.title.includes("заход 4 из 4")), "native ml capacity must determine repeated runs without converting units");
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
