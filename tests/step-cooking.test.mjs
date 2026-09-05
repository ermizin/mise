import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadTypeScriptModule} from './typescript-module.mjs';
const {buildMergedCookingPlan}=await loadTypeScriptModule(new URL('../domain/step-cooking.ts',import.meta.url));
const {profiles:catalogProfiles}=JSON.parse(await readFile(new URL('../data/recipe-step-scheduling.json',import.meta.url)));
const profiles=['new-home-buckwheat-legs','tmpm-23462','tmpm-25006-avocado-bean-rice-cakes'].map(id=>catalogProfiles.find(p=>p.recipeId===id&&p.methodId==='original'));
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
  d=>{d.recipeId='unreviewed'},d=>{d.methodId='unknown-method'},
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
  p=>{p.steps[2].waitMinutes=-1},p=>{p.steps.find(s=>s.waitMinutes).waitBasis=''},p=>{p.steps.find(s=>s.waitMinutes).resumeMinutes=0}
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

const fullCapacity=Object.fromEntries(catalogProfiles.flatMap(p=>p.requiredEquipment).map(id=>[id,4]));
function assertScheduleIntegrity(dishes,result,cap){
 assert.equal(result.available,true);
 assert.ok(result.totalMinutes<=result.sequentialMinutes);
 for(const d of dishes){
  const source=result.steps.filter(r=>r.dishId===d.id&&(r.kind==='instruction'||r.kind==='deferred'));
  assert.deepEqual(plain(source.map(s=>({text:s.text,id:s.sourceStepId,products:s.products}))),d.steps.map(s=>({text:s.text,id:s.id,products:s.products})));
  const timed=result.steps.filter(r=>r.dishId===d.id&&r.kind!=='deferred');
  for(let i=1;i<timed.length;i++)assert.ok(timed[i].start>=timed[i-1].end);
 }
 const attended=result.steps.filter(r=>r.kind==='instruction'||r.kind==='resume').sort((a,b)=>a.start-b.start);
 for(let i=1;i<attended.length;i++)assert.ok(attended[i].start>=attended[i-1].end,'no overlapping attention');
 const spans=dishes.map(d=>{
  const rows=result.steps.filter(r=>r.dishId===d.id&&r.start!==null);
  const resources=Object.fromEntries(d.requiredEquipment.map(id=>[id,1]));
  if(resources.stove)resources.stove=Math.max(1,(resources.pan??0)+(resources.pot??0));
  return {start:Math.min(...rows.map(r=>r.start)),end:Math.max(...rows.map(r=>r.end)),resources};
 });
 for(const minute of spans.flatMap(s=>[s.start,s.end]))for(const [resource,limit] of Object.entries(cap)){
  const used=spans.filter(s=>s.start<=minute&&s.end>minute).reduce((n,s)=>n+(s.resources[resource]??0),0);
  assert.ok(used<=limit,`${resource} capacity at ${minute}`);
 }
 assert.equal(new Set(result.steps.map(r=>r.id)).size,result.steps.length);
}

test('all 310 real methods preserve every instruction, identity and scaled product list',()=>{
 for(const profile of catalogProfiles){
  const dishes=[dish(profile)];
  assertScheduleIntegrity(dishes,buildMergedCookingPlan(dishes,catalogProfiles,fullCapacity),fullCapacity);
 }
});

test('mixed catalogue batches respect attention, full equipment spans and source chains',()=>{
 for(let i=0;i<catalogProfiles.length;i+=5){
  const dishes=catalogProfiles.slice(i,i+5).map((p,j)=>dish(p,`${i}:${j}`));
  const before=JSON.stringify(dishes);
  assertScheduleIntegrity(dishes,buildMergedCookingPlan(dishes,catalogProfiles,fullCapacity),fullCapacity);
  assert.equal(JSON.stringify(dishes),before);
 }
});

test('multi-day reviewed waits remain schedulable alongside another assignment',()=>{
 const long=catalogProfiles.find(p=>p.recipeId==='goodfood-beef-red-wine-potato-pie');
 const dishes=[dish(long),dish(profiles[2])];
 const result=buildMergedCookingPlan(dishes,catalogProfiles,fullCapacity);
 assert.ok(result.available&&result.totalMinutes>1440);
 assertScheduleIntegrity(dishes,result,fullCapacity);
});

test('overnight prerequisite and dependent tail retain source text without fabricated timestamps',()=>{
 for(const recipeId of ['tmpm-26676','tmpm-28499','tmpm-25244']){
  const profile=catalogProfiles.find(p=>p.recipeId===recipeId&&p.methodId==='original');
  const result=buildMergedCookingPlan([dish(profile)],catalogProfiles,fullCapacity);
  assert.equal(result.available,true);
  const deferred=result.steps.filter(r=>r.kind==='deferred');
  assert.ok(deferred.length);
  assert.ok(deferred.every(r=>r.start===null&&r.end===null));
  assert.deepEqual(plain(deferred.map(r=>r.text)),profile.steps.filter(s=>s.deferred).map(s=>s.text));
  const bad=structuredClone(profile),first=bad.steps.findIndex(s=>s.deferred);
  bad.steps[first].activeMinutes=1;
  assert.equal(buildMergedCookingPlan([dish(profile)],[bad],fullCapacity).available,false);
 }
});

test('return occurs before mid-cook additions and lid changes in reviewed long appliance steps',()=>{
 const find=(id,method,index)=>catalogProfiles.find(p=>p.recipeId===id&&p.methodId===method).steps[index];
 const lid=find('tmpm-26660','multicooker',2);
 assert.equal(lid.waitMinutes,300);
 assert.ok(lid.resumeMinutes>=60);
 const vegetables=find('tmpm-26720','multicooker',2);
 assert.equal(vegetables.waitMinutes,330);
 assert.ok(vegetables.resumeMinutes>=30);
 for(const s of [lid,vegetables])assert.ok(s.activeMinutes<10,'setup excludes the appliance wait');
 const alternatives=find('goodfood-orange-oregano-pulled-pork','original',2);
 assert.equal(alternatives.waitMinutes,0);
 assert.ok(alternatives.activeMinutes>=600,'do not silently select a shorter unselected mode');
});
