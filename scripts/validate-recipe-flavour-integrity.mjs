import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY = "data/recipe-flavour-integrity.json";
const DEFAULT_CATALOG = "data/recipe-runtime-catalog.json";

const normalized = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU");

export function validateRecipeFlavourIntegrity({ catalog, registry }) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.recipes)) {
    throw new Error("Recipe flavour integrity registry is missing or invalid.");
  }
  const ids = registry.recipes.map((recipe) => recipe.id);
  if (new Set(ids).size !== ids.length) throw new Error("Recipe flavour integrity registry contains duplicate recipe ids.");

  const recipes = new Map((catalog?.recipes ?? []).map((recipe) => [recipe.id, recipe]));
  const violations = [];
  for (const expectation of registry.recipes) {
    const recipe = recipes.get(expectation.id);
    if (!recipe) {
      violations.push({ id: expectation.id, kind: "missing_runtime_recipe" });
      continue;
    }
    const ingredientText = normalized([
      ...(recipe.shoppingIngredients ?? []).map((ingredient) => ingredient.nameRu),
      ...(recipe.procedureIngredients ?? []).map((ingredient) => ingredient.nameRu),
    ].join("\n"));
    const instructionText = normalized((recipe.steps ?? []).join("\n"));
    for (const term of expectation.ingredientTerms ?? []) {
      if (!ingredientText.includes(normalized(term))) violations.push({ id: expectation.id, kind: "missing_ingredient", term });
    }
    for (const term of expectation.instructionTerms ?? []) {
      if (!instructionText.includes(normalized(term))) violations.push({ id: expectation.id, kind: "missing_instruction", term });
    }
  }
  return violations;
}

export async function loadRecipeFlavourIntegrityInputs({ cwd = process.cwd() } = {}) {
  const [registry, catalog] = await Promise.all([
    readFile(resolve(cwd, DEFAULT_REGISTRY), "utf8").then(JSON.parse),
    readFile(resolve(cwd, DEFAULT_CATALOG), "utf8").then(JSON.parse),
  ]);
  return { registry, catalog };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inputs = await loadRecipeFlavourIntegrityInputs();
  const violations = validateRecipeFlavourIntegrity(inputs);
  if (violations.length) {
    process.stderr.write(`${JSON.stringify({ ok: false, violations }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({ ok: true, recipes: inputs.registry.recipes.length })}\n`);
  }
}
