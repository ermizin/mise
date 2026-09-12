import manifestJson from "../../data/cooking-operations.json";
import runtimeJson from "../../data/recipe-runtime-catalog.json";
import actionCatalogJson from "../../data/cooking-action-catalog.json";
import { mergeCompatiblePreparations } from "./batch";
import { formatCookingActionText } from "../cooking-actions";
import { validGuidedBackgroundResources } from "./guided";
import type { CompiledSession, CookingOperation, CookingSessionInput, ResourceUse } from "./types";
import type { GuidedActionConfig } from "./types";

type ManifestOperation = Omit<CookingOperation, "id" | "recipeId" | "methodId" | "dependsOn" | "allocations"> & { key: string; dependsOn?: string[]; preparationCuts?: Record<string, string> };
type SourceDefinition = {
  steps: string[];
  ingredients: { sourceIngredientId: string; canonicalIngredientId: string; baseAmount: number; unit: string }[];
  method: unknown;
};
type ManifestRecipe = {
  recipeId: string; methodId: string; sourceStepsChecksum: string; sourceFingerprint: string;
  sourceDefinition: SourceDefinition; reviewed: boolean;
  ingredientTrace: [string, string, string][];
  cookingLoads: { operationKey: string; resourceId: string; sourceIngredientIds: string[]; unit: string }[];
  operations: ManifestOperation[];
};
const manifest = manifestJson as unknown as { version: number; recipes: ManifestRecipe[] };
const runtime = runtimeJson as unknown as { recipes: { id: string; steps: string[]; recipeFamily: { ingredients: SourceDefinition["ingredients"] }; equipmentOptions: { id: string }[] }[] };
type GuidedAction = { id: string; sourceStepIndex: number; text: string; sourceStart: number; sourceEnd: number; backgroundCandidate?: { durationSeconds: number; durationText: string; category: "oven" | "covered_simmer" | "boil" | "cold_wait" } };
type GuidedMethod = { methodId: string; sourceSteps: string[]; actions: GuidedAction[]; graphFingerprint?: string; fingerprint?: string; requiredEquipment?: string[] };
type GuidedRecipe = { recipeId: string; ingredientDefinitions?: { id: string; canonicalId: string; amount: number; unit: string }[]; methods: GuidedMethod[] };
const actionCatalog = actionCatalogJson as unknown as { schemaVersion?: number; recipes: GuidedRecipe[] };
const equipmentKinds: Record<string, ResourceUse["kind"]> = {
  baking_dish: "baking_dish", oven: "oven", pan: "pan", stove: "burner", blender: "blender", waffle_iron: "waffle_iron",
  pot: "pot", multicooker: "multicooker", pressure_cooker: "pressure_cooker", microwave: "microwave", air_fryer: "air_fryer",
};

export function cookingOperationManifest(recipeId: string, methodId: string) {
  return manifest.recipes.find(recipe => recipe.recipeId === recipeId && recipe.methodId === methodId);
}

export function guidedCookingMethod(recipeId: string, methodId: string) {
  if (cookingOperationManifest(recipeId, methodId)) return undefined;
  return actionCatalog.recipes.find(recipe => recipe.recipeId === recipeId)?.methods.find(method => method.methodId === methodId);
}

export function cookingSourceDescriptor(recipeId: string, methodId: string) {
  const manual = cookingOperationManifest(recipeId, methodId);
  if (manual) return { kind: "manual" as const, fingerprint: manual.sourceStepsChecksum, sourceStepsChecksum: manual.sourceStepsChecksum, sourceSteps: manual.sourceDefinition.steps };
  const guided = guidedCookingMethod(recipeId, methodId);
  const fingerprint = guided?.graphFingerprint ?? guided?.fingerprint ?? "";
  return guided ? { kind: "guided" as const, fingerprint, sourceStepsChecksum: fingerprint, sourceSteps: guided.sourceSteps, method: guided } : undefined;
}

function guidedResourceUses(config: GuidedActionConfig, input: CookingSessionInput) {
  const unique = [...new Set(config.resourceIds)];
  if (!unique.length || unique.length !== config.resourceIds.length || !config.allBatchFits) return undefined;
  const resources = unique.map(id => input.kitchen.resources.find(resource => resource.id === id));
  return resources.every(Boolean) ? resources.map(resource => ({ resourceId: resource!.id, kind: resource!.kind })) : undefined;
}

function guidedEquipmentUses(selected: CookingSessionInput["recipes"][number], guided: GuidedMethod, input: CookingSessionInput): ResourceUse[] | undefined {
  const kinds = [...new Set((guided.requiredEquipment ?? []).map(equipment => equipmentKinds[equipment]))];
  const selectedIndex = input.recipes.indexOf(selected);
  const result: ResourceUse[] = [];
  for (const kind of kinds) {
    if (!kind) return undefined;
    const available = input.kitchen.resources.filter(resource => resource.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
    if (!available.length) return undefined;
    const preceding = input.recipes.slice(0, selectedIndex).filter(recipe => guidedCookingMethod(recipe.recipeId, recipe.methodId)?.requiredEquipment?.some(equipment => equipmentKinds[equipment] === kind)).length;
    const resource = available[preceding % available.length];
    result.push({ resourceId: resource.id, kind: resource.kind });
  }
  return result;
}

function uniqueUses(resources: readonly ResourceUse[]) {
  return [...new Map(resources.map(resource => [resource.resourceId, resource])).values()];
}

function guidedConfigIsBoundToSelectedActions(input: CookingSessionInput, diagnostics: CompiledSession["diagnostics"]): boolean {
  const config = input.guidedConfig;
  if (!config || !config.actions || typeof config.actions !== "object") return false;
  const candidates = new Map<string, GuidedAction>();
  for (const selected of input.recipes) {
    const method = guidedCookingMethod(selected.recipeId, selected.methodId);
    for (const action of method?.actions ?? []) if (action.backgroundCandidate) candidates.set(`${selected.dishKey}:${action.id}`, action);
  }
  for (const key of Object.keys(config.actions)) {
    const action = candidates.get(key), value = config.actions[key];
    if (!action || !value || !Array.isArray(value.resourceIds) || !action.backgroundCandidate || value.durationSeconds !== action.backgroundCandidate.durationSeconds || value.allBatchFits !== true) {
      diagnostics.push({ code: "guided_background_config_invalid", message: "Подтверждение фонового шага не соответствует исходной инструкции." });
      return false;
    }
  }
  return true;
}

function compileGuided(selected: CookingSessionInput["recipes"][number], input: CookingSessionInput, diagnostics: CompiledSession["diagnostics"], operations: CookingOperation[]) {
  const guided = guidedCookingMethod(selected.recipeId, selected.methodId);
  const config = input.guidedConfig;
  const fingerprint = guided?.graphFingerprint ?? guided?.fingerprint;
  const fail = (code: string, message: string) => diagnostics.push({ recipeId: selected.recipeId, code, message });
  if (!guided || !config || config.schemaVersion !== 1 || !Number.isInteger(config.activeStepSeconds) || config.activeStepSeconds < 1 || config.activeStepSeconds > 3600 || !fingerprint || selected.sourceStepsChecksum !== fingerprint) {
    fail("guided_config_required", "Подтвердите время и ресурсы для каждого шага исходной инструкции."); return;
  }
  const cook = input.kitchen.resources.find(resource => resource.kind === "cook");
  if (!cook) { fail("resource_unavailable", "Для действий нужен единственный подтверждённый повар."); return; }
  const cookUse: ResourceUse = { resourceId: cook.id, kind: "cook" };
  const methodResources = guidedEquipmentUses(selected, guided, input);
  if (!methodResources) { fail("resource_unavailable", "Подтвердите всё оборудование из исходного способа без замены метода."); return; }
  const configuredResources = new Map<string, ResourceUse[]>();
  for (const action of guided.actions) {
    const actionConfig = config.actions[`${selected.dishKey}:${action.id}`];
    if (!actionConfig) continue;
    const resources = guidedResourceUses(actionConfig, input);
    if (!resources) { fail("guided_resource_not_confirmed", `Выберите уникальные подтверждённые ресурсы для шага: ${action.text.trim()}`); return; }
    if (!action.backgroundCandidate || !validGuidedBackgroundResources(action.backgroundCandidate.category, resources, methodResources)) {
      fail("guided_heat_resource_invalid", "Фоновый шаг требует прибор и физическую ёмкость, указанные выбранным исходным способом."); return;
    }
    configuredResources.set(action.id, resources);
  }
  const dishResources = uniqueUses([...methodResources, ...[...configuredResources.values()].flat()]);
  const definitions = actionCatalog.recipes.find(recipe => recipe.recipeId === selected.recipeId)?.ingredientDefinitions;
  if (!definitions || definitions.length !== Object.keys(selected.cookingAmounts).length || definitions.some(definition => {
    const amount = selected.cookingAmounts[definition.id]; return !amount || amount.canonicalId !== definition.canonicalId || amount.unit !== definition.unit || !Number.isFinite(amount.amount) || amount.amount < 0;
  })) { fail("invalid_ingredient_amounts", "Количества продуктов не совпали с исходной инструкцией."); return; }
  const measureId = `${selected.dishKey}:${selected.methodId}:measure`;
  operations.push({ id: measureId, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "instruction", title: "Подготовьте продукты по исходной инструкции", sourceText: "", dependsOn: [], durationSeconds: config.activeStepSeconds, estimatedActive: true, attention: "required", resources: [cookUse], allocations: definitions.map(definition => ({ ...selected.cookingAmounts[definition.id], ingredientId: definition.id, recipeId: selected.recipeId, dishKey: selected.dishKey, state: selected.cookingAmounts[definition.id].state ?? "raw" })), sourceStepIndexes: [] });
  const cleanupId = `${selected.dishKey}:${selected.methodId}:cleanup`;
  let previous = measureId;
  for (const [actionIndex, action] of guided.actions.entries()) {
    const key = `${selected.dishKey}:${action.id}`;
    const actionConfig = config.actions[key];
    const prefix = `${selected.dishKey}:${selected.methodId}:${action.id}`;
    const candidate = action.backgroundCandidate;
    const title = formatCookingActionText(action.text);
    const sourceText = guided.sourceSteps[action.sourceStepIndex] ?? action.text;
    const sourceOperationIds = [action.id];
    if (actionConfig && (!candidate || !Number.isInteger(actionConfig.durationSeconds) || actionConfig.durationSeconds !== candidate.durationSeconds || actionConfig.allBatchFits !== true)) { fail("guided_background_config_invalid", `Фоновый режим доступен только для подтверждённого исходного нагрева: ${title}`); return; }
    const resources = configuredResources.get(action.id);
    if (candidate && actionConfig && resources) {
      const start = `${prefix}:start`, heat = `${prefix}:heat`, check = `${prefix}:check`;
      const firstHolds = actionIndex === 0 ? dishResources.map(resource => ({ ...resource, releaseAfterOpId: cleanupId })) : undefined;
      operations.push({ id: start, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "start_heat", title, sourceText, sourceOperationIds, dependsOn: [previous], durationSeconds: config.activeStepSeconds, estimatedActive: true, attention: "required", resources: [cookUse, ...dishResources], resourceHolds: firstHolds, allocations: [], sourceStepIndexes: [action.sourceStepIndex] });
      operations.push({ id: heat, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "heat", title, sourceText, sourceOperationIds, dependsOn: [start], durationSeconds: candidate.durationSeconds, attention: "background", resources, resourceHolds: resources.map(resource => ({ ...resource, releaseAfterOpId: cleanupId })), allocations: [], requiresCheckAtEnd: true, checkDeadlineSeconds: 0, sourceStepIndexes: [action.sourceStepIndex] });
      operations.push({ id: check, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "intervention", title: `Проверьте результат: ${title}`, sourceText, sourceOperationIds, dependsOn: [heat], durationSeconds: config.activeStepSeconds, estimatedActive: true, attention: "required", resources: [cookUse, ...dishResources], allocations: [], sourceStepIndexes: [action.sourceStepIndex] });
      previous = check;
    } else {
      operations.push({ id: prefix, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "instruction", title, sourceText, sourceOperationIds, dependsOn: [previous], durationSeconds: config.activeStepSeconds, estimatedActive: true, attention: "required", resources: [cookUse, ...dishResources], resourceHolds: actionIndex === 0 ? dishResources.map(resource => ({ ...resource, releaseAfterOpId: cleanupId })) : undefined, allocations: [], sourceStepIndexes: [action.sourceStepIndex] });
      previous = prefix;
    }
  }
  operations.push({ id: cleanupId, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey, kind: "wash", title: "Освободите посуду и вымойте использованный инвентарь", sourceText: "", dependsOn: [previous], durationSeconds: config.activeStepSeconds, estimatedActive: true, attention: "required", resources: [cookUse, ...dishResources], allocations: [], sourceStepIndexes: [] });
}

function sourceMatches(recipe: ManifestRecipe) {
  const source = runtime.recipes.find(item => item.id === recipe.recipeId);
  if (!source || !recipe.sourceDefinition) return false;
  const definition: SourceDefinition = {
    steps: source.steps,
    ingredients: source.recipeFamily.ingredients.map(({ sourceIngredientId, canonicalIngredientId, baseAmount, unit }) => ({ sourceIngredientId, canonicalIngredientId, baseAmount, unit })),
    method: source.equipmentOptions.find(method => method.id === recipe.methodId),
  };
  return JSON.stringify(definition) === JSON.stringify(recipe.sourceDefinition);
}

/** These are ingredient loads, never a guessed conversion from mass to vessel volume. */
export function cookingRequirements(input: Pick<CookingSessionInput, "recipes">) {
  return input.recipes.flatMap(selected => {
    const recipe = cookingOperationManifest(selected.recipeId, selected.methodId);
    if (!recipe) return [];
    return recipe.cookingLoads.map(load => ({
      dishKey: selected.dishKey, recipeId: selected.recipeId, resourceId: load.resourceId,
      capacityUnit: load.unit, ingredientIds: load.sourceIngredientIds,
      intendedLoad: (load.sourceIngredientIds ?? []).reduce((sum, id) => sum + (selected.cookingAmounts[id]?.amount ?? 0), 0),
    }));
  });
}

/** Logical resource numbers are recipe-local; actual kitchen resources are shared by all dishes. */
function resourceBindings(recipe: ManifestRecipe, input: CookingSessionInput) {
  const logical = [...new Map(recipe.operations.flatMap(op => [...op.resources, ...(op.resourceHolds ?? [])]).map(use => [use.resourceId, use])).values()];
  const result = new Map<string, ResourceUse>();
  const indexes = new Map<string, number>();
  for (const use of logical) {
    const available = input.kitchen.resources.filter(item => item.kind === use.kind).sort((a, b) => a.id.localeCompare(b.id));
    if (!available.length || (["pot", "pan", "tray"].includes(use.kind) && logical.filter(item => item.kind === use.kind).length > available.length)) return null;
    const index = indexes.get(use.kind) ?? 0;
    indexes.set(use.kind, index + 1);
    const actual = available[index % available.length];
    result.set(use.resourceId, { resourceId: actual.id, kind: actual.kind });
  }
  return result;
}

/** Compiles only source-pinned recipes with exact, addressed ingredient amounts and explicit capacities. */
export function compileCookingSession(input: CookingSessionInput): CompiledSession {
  const diagnostics: CompiledSession["diagnostics"] = [];
  const operations: CookingOperation[] = [];
  const fail = (recipeId: string, code: string, message: string) => diagnostics.push({ recipeId, code, message });
  if (!input.recipes.length || new Set(input.recipes.map(recipe => recipe.dishKey)).size !== input.recipes.length ||
      new Set(input.kitchen.resources.map(resource => resource.id)).size !== input.kitchen.resources.length ||
      input.kitchen.resources.filter(resource => resource.kind === "cook").length !== 1) {
    fail("", "invalid_session", "Проверьте блюда и ресурсы кухни. План рассчитан на одного человека у плиты.");
  }
  if (input.recipes.some(selected => !!guidedCookingMethod(selected.recipeId, selected.methodId)) && !guidedConfigIsBoundToSelectedActions(input, diagnostics)) {
    fail("", "guided_config_required", "Подтвердите единый темп действий и только подходящие фоновые шаги.");
    return { id: input.sessionId, input, operations: [], diagnostics, fallbackReason: "verified_manifest_required" };
  }
  for (const selected of input.recipes) {
    const recipe = cookingOperationManifest(selected.recipeId, selected.methodId);
    if (!recipe) {
      compileGuided(selected, input, diagnostics, operations);
      continue;
    }
    if (!recipe || !recipe.reviewed || !sourceMatches(recipe) || recipe.sourceStepsChecksum !== selected.sourceStepsChecksum) {
      fail(selected.recipeId, "manifest_unavailable_or_changed", "Для этого блюда или способа ещё нет проверенного плана операций. Откройте обычную инструкцию.");
      continue;
    }
    const sourceAmounts = selected.cookingAmounts;
    const source = recipe.sourceDefinition.ingredients;
    if (!sourceAmounts || Object.keys(sourceAmounts).length !== source.length || source.some(ingredient => {
      const amount = sourceAmounts[ingredient.sourceIngredientId];
      return !amount || amount.canonicalId !== ingredient.canonicalIngredientId || amount.unit !== ingredient.unit ||
        !Number.isFinite(amount.amount) || amount.amount < 0;
    })) {
      fail(selected.recipeId, "invalid_ingredient_amounts", "Количества продуктов не совпали с выбранной рецептурой. Пересчитайте план.");
      continue;
    }
    if (recipe.operations.some(item => item.unknownDuration && (!Number.isFinite(input.durationOverrides?.[`${selected.dishKey}:${item.key}`]) || input.durationOverrides![`${selected.dishKey}:${item.key}`] <= 0 || input.durationOverrides![`${selected.dishKey}:${item.key}`] > 24 * 3600))) {
      fail(selected.recipeId, "duration_not_confirmed", "Укажите время этапов, которое зависит от упаковки или вашего оборудования."); continue;
    }
    const bindings = resourceBindings(recipe, input);
    if (!bindings) { fail(selected.recipeId, "resource_unavailable", "Для плана операций не хватает подтверждённой утвари."); continue; }
    let copies = 1;
    let validLoads = true;
    for (const load of recipe.cookingLoads) {
      const resource = input.kitchen.resources.find(item => item.id === bindings.get(load.resourceId)?.resourceId);
      const amounts = (load.sourceIngredientIds ?? []).map(id => sourceAmounts[id]);
      const total = amounts.reduce((sum, amount) => sum + (amount?.amount ?? 0), 0);
      if (!amounts.length || amounts.some(amount => !amount || amount.unit !== load.unit) || !Number.isFinite(total) || total <= 0 ||
          !resource || !Number.isFinite(resource.capacities?.[load.unit] ?? (resource.capacityUnit === load.unit ? resource.capacity : undefined)) || (resource.capacities?.[load.unit] ?? (resource.capacityUnit === load.unit ? resource.capacity : 0) ?? 0) <= 0) {
        validLoads = false; break;
      }
      copies = Math.max(copies, Math.ceil(total / (resource.capacities?.[load.unit] ?? resource.capacity!)));
    }
    if (!validLoads || copies > 24) { fail(selected.recipeId, "capacity_not_confirmed", "Укажите допустимую загрузку посуды этими продуктами. Если нужно больше 24 заходов, уменьшите партию."); continue; }
    let previousTerminals: string[] = [];
    for (let run = 0; run < copies; run++) {
      const prefix = `${selected.dishKey}:${selected.methodId}:${run}:`;
      const keysUsedAsDependencies = new Set(recipe.operations.flatMap(item => item.dependsOn ?? []));
      for (const item of recipe.operations) {
        const resourceHolds = item.resourceHolds?.map(hold => ({ ...bindings.get(hold.resourceId)!, releaseAfterOpId: prefix + hold.releaseAfterOpId }));
        operations.push({ ...item, id: prefix + item.key, recipeId: selected.recipeId, methodId: selected.methodId, dishKey: selected.dishKey,
          durationSeconds: item.unknownDuration ? input.durationOverrides![`${selected.dishKey}:${item.key}`] : item.estimatedActive && input.pace === "comfortable" ? Math.ceil(item.durationSeconds * 1.2) : item.durationSeconds,
          title: copies > 1 ? `${item.title} · заход ${run + 1} из ${copies}` : item.title,
          sourceText: item.sourceStepIndexes.map(index => recipe.sourceDefinition.steps[index]).join("\n\n"),
          dependsOn: (item.dependsOn?.length ? item.dependsOn.map(key => prefix + key) : previousTerminals),
          resources: [...new Map(item.resources.map(use => { const actual = bindings.get(use.resourceId)!; return [actual.resourceId, actual] as const; })).values()],
          resourceHolds,
          allocations: recipe.ingredientTrace.filter(([, , key]) => key === item.key).map(([ingredientId]) => {
            const amount = sourceAmounts[ingredientId];
            return { ...amount, cut: item.preparationCuts?.[ingredientId] ?? amount.cut, amount: amount.amount / copies, ingredientId, recipeId: selected.recipeId, dishKey: selected.dishKey, state: amount.state ?? "raw" };
          }),
        });
      }
      previousTerminals = recipe.operations.filter(item => !keysUsedAsDependencies.has(item.key)).map(item => prefix + item.key);
    }
  }
  return { id: input.sessionId, input, operations: diagnostics.length ? [] : mergeCompatiblePreparations(operations), diagnostics,
    ...(diagnostics.length ? { fallbackReason: "verified_manifest_required" } : {}) };
}
