import assert from "node:assert/strict";
import test from "node:test";
import { recipeCatalog } from "./recipe-session-fixture.mjs";
const app = await recipeCatalog();
const batch = { id: "b", index: 0, start: "2026-09-08", end: "2026-09-10", days: 3 };
function plan(kcal = 2200) {
 const recipe = app.recipesById["src-creamy-chicken-pasta"];
 return { id: "test", people: [{id:"a", name:"A", daily:{kcal,protein:150,fat:70,carbs:230}, includedSlots:["lunch"]}], mealSlots:["lunch"], selections:{"b:lunch":recipe.id}, selectionAssignments:{"b:lunch":[{recipeId:recipe.id,personIds:["a"]}]}, batches:[batch], cookedWeights:{"b:lunch":{total:1000}} };
}
test("failed session is an explicit blocker, never a minute-long instruction", () => {
 const model = app.buildBatchCookingModel(plan(10), batch);
 assert.equal(model.canComplete, false);
 assert.equal(model.blockers.length, 1);
 assert.equal(model.dishes.length, 0);
 assert.equal(model.steps.length, 0);
 assert.equal(model.totalPortions, 0);
});
test("completion guard rejects old weights for blocked batches", () => {
 assert.throws(() => app.completeBatchCookingPlan(plan(10),batch,{anything:{total:5000}}), /рассчитать|готовк/);
});
test("valid cooking preserves measurement once and all recipe actions", () => {
 const model = app.buildBatchCookingModel(plan(),batch);
 assert.equal(model.canComplete,true);
 assert.equal(model.blockers.length,0);
 assert.equal(model.steps.filter(step=>step.sourceStepId === "measure").length,1);
 assert.ok(model.steps.every(step=>step.id.includes("b:")));
 assert.ok(model.steps.every(step=>step.productsScope === "dish"));
});

test("saved weights cannot re-complete a cooked batch or overwrite its history", () => {
 const current = {...plan(), cookedBatchIds:[batch.id]};
 assert.throws(() => app.completeBatchCookingPlan(current,batch,{}), /завершена/);
});
test("protein assessment stays personal and does not invent unselected meals", () => {
 const current = plan();
 const result = app.dailyProteinAssessment(current,batch,current.people[0]);
 assert.equal(result.partial,true);
 assert.ok(result.actual.protein > 0);
 assert.equal(result.shortfall, Math.max(0,Math.round(150-result.actual.protein)));
 assert.match(app.proteinAssessmentText(result),/за пределами этого плана/);
});
test("protein overshoot does not penalize a shared serving or compensate another person's deficit", () => {
 const target = {kcal:500,protein:40,fat:15,carbs:50};
 const exact = {viable:true, portions:[{target,actual:target}]};
 const high = {viable:true, portions:[{target,actual:{...target,protein:48}}]};
 const low = {viable:true, portions:[{target,actual:{...target,protein:32}}]};
 assert.equal(app.fitScoreForSession(high), app.fitScoreForSession(exact));
 assert.ok(app.fitScoreForSession(low)<app.fitScoreForSession(high));
});

test("completion records only owned weights and immutable real nutrition", () => {
 const current = plan();
 const key = "b:lunch:src-creamy-chicken-pasta";
 const next = app.completeBatchCookingPlan(current,batch,{[key]:{total:1234}, other:{total:999}});
 assert.equal(next.cookedWeights[key].total,1234);
 assert.equal(next.cookedWeights.other, undefined);
 assert.equal(next.cookedBatchIds[0],"b");
 assert.equal(Object.keys(next.nutritionHistory).length,3);
 const expected = app.recipeCookingSession(current.people,"lunch",app.recipesById["src-creamy-chicken-pasta"],3).portions[0].actual;
 assert.equal(next.nutritionHistory["a:2026-09-08:lunch"].actual.protein,expected.protein);
});
test("signature ignores names but changes when days or physical quantities change", () => {
 const current=plan();
 const signature=p=>app.batchCookingSignature(p,batch,app.buildBatchCookingModel(p,batch));
 assert.equal(signature(current),signature({...current,people:[{...current.people[0],name:"Renamed"}]}));
 const longer={...batch,days:5,end:"2026-09-12"};
 assert.notEqual(signature(current),app.batchCookingSignature(current,longer,app.buildBatchCookingModel(current,longer)));
});
