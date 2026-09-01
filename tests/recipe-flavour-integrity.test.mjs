import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRecipeFlavourIntegrityInputs,
  validateRecipeFlavourIntegrity,
} from "../scripts/validate-recipe-flavour-integrity.mjs";

const inputs = await loadRecipeFlavourIntegrityInputs();

test("restored flavour components survive into ingredients and instructions", () => {
  assert.deepEqual(validateRecipeFlavourIntegrity(inputs), []);
});

test("the flavour gate fails when a restored spice disappears", () => {
  const catalog = structuredClone(inputs.catalog);
  const recipe = catalog.recipes.find((item) => item.id === "foodru-oblomov-chashushuli");
  assert.ok(recipe);
  recipe.procedureIngredients = recipe.procedureIngredients.filter((ingredient) => ingredient.nameRu !== "Хмели-сунели");
  const violations = validateRecipeFlavourIntegrity({
    catalog,
    registry: inputs.registry,
    releaseAudit: inputs.releaseAudit,
  });
  assert.ok(violations.some((violation) => violation.id === recipe.id && violation.kind === "missing_ingredient" && violation.term === "Хмели-сунели"));
});
