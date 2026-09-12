import manifestJson from "../../data/cooking-operations.json";
import runtimeJson from "../../data/recipe-runtime-catalog.json";
import { mergeCompatiblePreparations } from "./batch";
import type { CompiledSession, CookingOperation, CookingSessionInput, ResourceUse } from "./types";

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

export function cookingOperationManifest(recipeId: string, methodId: string) {
  return manifest.recipes.find(recipe => recipe.recipeId === recipeId && recipe.methodId === methodId);
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
  for (const selected of input.recipes) {
    const recipe = cookingOperationManifest(selected.recipeId, selected.methodId);
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
