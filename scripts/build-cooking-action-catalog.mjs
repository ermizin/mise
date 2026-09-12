import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { productionRecipes } from "./build-plan-recipe-registry.mjs";

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function sourceSentence(text, sourceStart, sourceEnd) {
  const start = Math.max(text.lastIndexOf(".", sourceStart), text.lastIndexOf("!", sourceStart), text.lastIndexOf("?", sourceStart)) + 1;
  const tail = text.slice(sourceEnd);
  const next = tail.search(/[.!?]/u);
  return text.slice(start, next < 0 ? text.length : sourceEnd + next + 1);
}

function cookingIngredientDefinitions(recipe) {
  if (!recipe.cookingFamily?.ingredients) throw new Error(`Production recipe ${recipe.id} is missing its Recipe Family.`);
  return Array.from(recipe.cookingFamily.ingredients, (ingredient) => ({
    id: ingredient.sourceIngredientId,
    canonicalId: ingredient.canonicalIngredientId,
    amount: ingredient.baseAmount,
    unit: ingredient.unit,
  }));
}

async function loadCookingEvidenceModule(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const moduleBox = { exports: {} };
  vm.runInNewContext(output, { module: moduleBox, exports: moduleBox.exports, RegExp, String }, { filename: url.pathname });
  return moduleBox.exports;
}

export async function buildCookingActionCatalog() {
  const [recipes, actionsModule, evidenceModule] = await Promise.all([
    productionRecipes(),
    loadCookingEvidenceModule("../domain/cooking-actions.ts"),
    loadCookingEvidenceModule("../domain/cooking-evidence.ts"),
  ]);
  const { splitCookingActions } = actionsModule;
  const { backgroundCandidateForAction } = evidenceModule;
  const entries = Array.from(recipes, (recipe) => ({
      recipeId: recipe.id,
      ingredientDefinitions: cookingIngredientDefinitions(recipe),
      methods: Array.from(recipe.equipmentOptions, (method) => {
        const sourceSteps = Array.from(recipe.rawCookingSourceStepsByMethod[method.id] ?? []);
        const requiredEquipment = Array.from(method.requiredEquipment);
        const actions = sourceSteps.flatMap((text, sourceStepIndex) =>
          splitCookingActions(text).map((action, index) => {
            const backgroundCandidate = backgroundCandidateForAction(
              action.text,
              requiredEquipment,
              sourceSentence(text, action.sourceStart, action.sourceEnd),
            );
            return {
              id: `${recipe.id}:${method.id}:${sourceStepIndex}:${index}`,
              sourceStepIndex,
              ...action,
              ...(backgroundCandidate ? { backgroundCandidate: { ...backgroundCandidate } } : {}),
            };
          }),
        );
        const fingerprint = sha256({ recipeId: recipe.id, methodId: method.id, sourceSteps, actions: actions.map(({ sourceStepIndex, text, sourceStart, sourceEnd }) => ({ sourceStepIndex, text, sourceStart, sourceEnd })) });
        const sourceDefinition = {
          recipeId: recipe.id,
          ingredients: cookingIngredientDefinitions(recipe),
          method: { id: method.id, requiredEquipment },
          sourceSteps,
          actions: actions.map(({ id, sourceStepIndex, text, sourceStart, sourceEnd }) => ({ id, sourceStepIndex, text, sourceStart, sourceEnd })),
        };
        const graphFingerprint = sha256({ sourceDefinition, backgroundCandidates: actions.map(({ id, backgroundCandidate }) => ({ id, backgroundCandidate: backgroundCandidate ?? null })) });
        return { methodId: method.id, requiredEquipment, sourceSteps, actions, fingerprint, sourceDefinition, graphFingerprint };
      }),
    }))
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  const methodCount = entries.reduce((sum, recipe) => sum + recipe.methods.length, 0);
  if (entries.some((recipe) => !recipe.methods.length) || methodCount === 0)
    throw new Error("Every production recipe needs at least one displayable cooking method.");
  return { schemaVersion: 1, recipeCount: entries.length, methodCount, recipes: entries };
}

export async function writeCookingActionCatalog(outputPath = new URL("../data/cooking-action-catalog.json", import.meta.url)) {
  const catalog = await buildCookingActionCatalog();
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const index = process.argv.indexOf("--output");
  const output = index >= 0 ? pathToFileURL(resolve(process.argv[index + 1])) : undefined;
  const catalog = await writeCookingActionCatalog(output);
  console.log(JSON.stringify({ recipes: catalog.recipeCount, methods: catalog.methodCount, actions: catalog.recipes.reduce((sum, recipe) => sum + recipe.methods.reduce((count, method) => count + method.actions.length, 0), 0) }));
}
