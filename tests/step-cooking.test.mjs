import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadTypeScriptModule} from './typescript-module.mjs';
const {buildMergedCookingPlan}=await loadTypeScriptModule(new URL('../domain/step-cooking.ts',import.meta.url));
const {profiles}=JSON.parse(await readFile(new URL('../data/recipe-step-scheduling.json',import.meta.url)));
const plain=value=>JSON.parse(JSON.stringify(value));
const capacity={oven:1,baking_dish:2,stove:2,pan:1,pot:2};
const dish=(profile,key=profile.recipeId)=>({id:key,recipeId:profile.recipeId,title:key,methodId:profile.methodId,requiredEquipment:[...profile.requiredEquipment],steps:[
 {id:`${key}:measure`,text:`Отмерьте продукты для ${key}`,products:['Ингредиент — 237 г','Масло — 8 г'],measurement:true},
 ...profile.steps.map((step,i)=>({id:`${key}:${i}`,text:step.text,products:['Ингредиент — 237 г','Масло — 8 г'],measurement:false}))
]});

test('real three-dish batch merges individual instructions during a reviewed oven wait',()=>{
 const dishes=profiles.map(p=>dish(p)),before=JSON.stringify(dishes);
 const result=buildMergedCookingPlan(dishes,profiles,capacity);
 assert.equal(result.available,true);
 assert.ok(result.totalMinutes<result.sequentialMinutes);
 const cold=profiles[2].recipeId;
 const wait=result.steps.find(row=>row.dishId===profiles[0].recipeId&&row.kind==='wait');
 const coldRows=result.steps.filter(row=>row.dishId===cold);
 assert.ok(coldRows.every(row=>row.start>=wait.start&&row.end<=wait.end));
 for(const d of dishes){
  const original=result.steps.filter(row=>row.dishId===d.id&&row.kind==='instruction');
  assert.deepEqual(plain(original.map(row=>row.text)),d.steps.map(step=>step.text));
  assert.deepEqual(plain(original.map(row=>row.sourceStepId)),d.steps.map(step=>step.id));
  for(const row of original) assert.deepEqual(plain(row.products),d.steps.find(s=>s.id===row.sourceStepId).products);
 }
 assert.equal(JSON.stringify(dishes),before,'no quantity or recipe mutation');
 assert.equal(new Set(result.steps.map(row=>row.id)).size,result.steps.length);
});

test('one cook, one occupied oven and source dependencies are preserved at every minute',()=>{
 const result=buildMergedCookingPlan(profiles.map(p=>dish(p)),profiles,capacity);
 for(let minute=0;minute<result.totalMinutes;minute++){
  assert.ok(result.steps.filter(row=>row.kind!=='wait'&&row.start<=minute&&row.end>minute).length<=1,`one cook at ${minute}`);
  const ovenDishes=profiles.filter(p=>p.requiredEquipment.includes('oven')).filter(p=>{
   const rows=result.steps.filter(row=>row.dishId===p.recipeId);
   return Math.min(...rows.map(r=>r.start))<=minute&&Math.max(...rows.map(r=>r.end))>minute;
  });
  assert.ok(ovenDishes.length<=1,`one oven at ${minute}`);
 }
 for(const p of profiles){
  const rows=result.steps.filter(r=>r.dishId===p.recipeId);
  for(let index=1;index<rows.length;index++) assert.ok(rows[index].start>=rows[index-1].end,'every local dependency completes first');
 }
});

test('same recipe in two assignments retains distinct identities and separate products',()=>{
 const a=dish(profiles[2],'lunch:person1'),b=dish(profiles[2],'dinner:person2');
 b.steps.forEach(step=>step.products=['Ингредиент — 413 г','Масло — 8 г']);
 const result=buildMergedCookingPlan([a,b],profiles,capacity);
 assert.equal(result.available,true);
 const measures=result.steps.filter(row=>row.instructionNumber===0);
 assert.equal(measures.length,2);
 assert.deepEqual(plain(measures.map(r=>r.products)),[b.steps[0].products,a.steps[0].products]);
});

test('uncovered recipe, alternate method, missing measurement or text drift reject the WHOLE batch',()=>{
 const valid=()=>dish(profiles[0]);
 for(const alter of [
  d=>{d.recipeId='unreviewed'},d=>{d.methodId='air_fryer'},
  d=>{d.steps[1].text+=' changed'},d=>{d.steps.pop()},d=>{d.steps.shift()},
  d=>{d.requiredEquipment.push('pot')},d=>{d.steps[1].id=d.steps[0].id}
 ]){
  const invalid=dish(profiles[2]);alter(invalid);
  const result=buildMergedCookingPlan([valid(),invalid],profiles,capacity);
  assert.equal(result.available,false);assert.equal(result.steps.length,0);
 }
});

test('missing provenance, dependency errors and invalid time semantics fail closed',()=>{
 for(const alter of [
  p=>{p.provenance=''},p=>{p.steps[1].dependsOn=['missing']},
  p=>{p.steps[1].dependsOn=[p.steps[1].sourceStepId]},p=>{p.steps[1].sourceStepId=p.steps[0].sourceStepId},
  p=>{p.steps[0].activeMinutes=NaN},p=>{p.steps[0].activeMinutes=0},
  p=>{p.steps[2].waitMinutes=-1},p=>{p.steps[2].waitBasis=''},p=>{p.steps[2].resumeMinutes=0}
 ]){
  const modified=structuredClone(profiles);alter(modified[0]);
  assert.equal(buildMergedCookingPlan([dish(profiles[0])],modified,capacity).available,false);
 }
});

test('equipment capacity is checked independently of waiting and no partial schedule leaks',()=>{
 for(const cap of [{...capacity,oven:0},{...capacity,pan:0},{...capacity,stove:0},{...capacity,oven:NaN}]){
  const result=buildMergedCookingPlan(profiles.map(p=>dish(p)),profiles,cap);
  assert.equal(result.reason,'resources');assert.equal(result.steps.length,0);
 }
});

test('deterministic timestamps release the cook into waiting before the next recipe begins',()=>{
 const dishes=[dish(profiles[0]),dish(profiles[2])];
 const result=buildMergedCookingPlan(dishes,profiles,capacity);
 assert.deepEqual(plain(result),plain(buildMergedCookingPlan([...dishes].reverse(),profiles,capacity)));
 const wait=result.steps.find(r=>r.kind==='wait');
 assert.deepEqual(plain(result.steps.filter(r=>r.start===wait.start).map(r=>r.kind)),['wait','instruction']);
 assert.equal(buildMergedCookingPlan([],profiles,capacity).available,false);
 assert.equal(buildMergedCookingPlan([dishes[0],dishes[0]],profiles,capacity).available,false);
});
