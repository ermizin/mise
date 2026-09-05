import assert from 'node:assert/strict';
import test from 'node:test';
import { recipeCatalog } from './recipe-session-fixture.mjs';
const catalog = await recipeCatalog();
const recipe = catalog.recipesById['goodfood-chicken-pasta-bake'];
function planFor(personIds = ['p1']) {
  return { id: 'batch-model-test', mealSlots: ['dinner'], people: personIds.map(id => ({id,name:id,daily:{kcal:2200,protein:150,fat:70,carbs:242},includedSlots:['dinner']})), selections:{'b1:dinner':recipe.id},selectionAssignments:{'b1:dinner':[{recipeId:recipe.id,personIds}]} };
}
const batch = {id:'b1',index:0,start:'2026-09-05',end:'2026-09-07',days:3};
test('batch model shares calculated products but does not call unscoped legacy mappings step-specific', () => {
  const model = catalog.buildBatchCookingModel(planFor(), batch);
  assert.ok(model.steps.length > 1);
  assert.equal(model.steps[0].productsScope, 'step');
  assert.equal(model.steps[0].products.length, recipe.ingredients.length + recipe.procedureIngredients.length);
  assert.equal(model.steps[1].productsScope, 'dish');
  assert.ok(Math.abs(model.steps.reduce((sum, step) => sum + step.activeMinutes, 0) - model.activeMinutes) < 1e-8);
});
test('assignment ordering cannot invalidate stable step identifiers', () => {
  const one = catalog.buildBatchCookingModel(planFor(['p1','p2']), batch);
  const two = catalog.buildBatchCookingModel(planFor(['p2','p1']), batch);
  assert.deepEqual(Array.from(one.steps, step=>step.id), Array.from(two.steps, step=>step.id));
});
test('an explicit narrow instruction mapping selects only its calculated product', () => {
  const family = catalog.recipeFamilyFor(recipe);
  const instruction = family.miseInstructions.find(step=>step.action!=='measure');
  const previous = instruction.ingredientIds;
  try {
    instruction.ingredientIds = [recipe.ingredients[1].id];
    const model = catalog.buildBatchCookingModel(planFor(), batch);
    const step = model.steps.find(step=>step.title===instruction.text);
    assert.equal(step.productsScope,'step');
    assert.equal(step.products.length,1);
    assert.equal(step.products[0],model.steps[0].products[1]);
  } finally {instruction.ingredientIds=previous;}
});
