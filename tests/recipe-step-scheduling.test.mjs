import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {productionCookingCatalog} from '../scripts/production-cooking-catalog.mjs';
import {compileStepScheduling, reviewFiles} from '../scripts/build-recipe-step-scheduling.mjs';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [catalog,raw,...sets]=await Promise.all([productionCookingCatalog(),read('data/recipe-step-scheduling.json'),...reviewFiles.map(name=>read(`data/step-scheduling-reviews/${name}`).then(JSON.parse))]);
const scheduling=JSON.parse(raw);
const key=m=>`${m.recipeId}@${m.methodId}`;

test('every production recipe and selectable method has exact complete reviewed steps',()=>{
 assert.equal(scheduling.schemaVersion,2);
 assert.equal(new Set(catalog.map(m=>m.recipeId)).size,260);
 assert.equal(catalog.length,310);
 assert.equal(catalog.reduce((n,m)=>n+m.steps.length,0),1594);
 assert.deepEqual(scheduling.profiles.map(key),catalog.map(key));
 for(const [index,profile] of scheduling.profiles.entries()){
  const source=catalog[index];
  assert.deepEqual(profile.requiredEquipment,source.requiredEquipment);
  assert.equal(profile.sourceSha256,source.sourceSha256);
  assert.match(profile.sourceRevision,/^[a-f0-9]{40}$/);
  assert.ok(profile.provenance.trim());
  assert.deepEqual(profile.steps.map(s=>s.text),source.steps.map(s=>s.text));
  assert.deepEqual(profile.steps.map(s=>s.sourceStepId),source.steps.map(s=>s.id));
  assert.deepEqual(profile.steps.map(s=>s.sourceDependsOn),source.steps.map(s=>s.dependsOn));
  for(const [i,step] of profile.steps.entries()){
   assert.deepEqual(step.dependsOn,i?[source.steps[i-1].id]:[]);
   assert.equal('action' in step,false);
   if(step.waitMinutes)assert.ok(step.waitBasis&&step.resumeMinutes>0);
   if(step.deferred)assert.equal(step.activeMinutes+step.waitMinutes+step.resumeMinutes,0);
  }
 }
 assert.ok(catalog.some(m=>m.methodId==='air_fryer'));
 assert.ok(catalog.some(m=>m.methodId==='multicooker'));
});

test('review compilation regenerates byte-identical full catalogue artifact',()=>{
 assert.equal(JSON.stringify(compileStepScheduling(catalog,sets),null,2)+'\n',raw);
 assert.equal(JSON.stringify(compileStepScheduling(catalog,[...sets].reverse()),null,2)+'\n',raw);
});

test('missing, duplicate, obsolete and stale method reviews block generation',()=>{
 for(const alter of [
  s=>s[0].reviews.pop(),
  s=>s[0].reviews.push(structuredClone(s[0].reviews[0])),
  s=>{s[0].reviews[0].methodId='unavailable'},
  s=>{s[0].reviews[0].sourceSha256='stale'},
  s=>s[0].reviews[0].steps.pop(),
  s=>{s[0].reviews[0].measurementMinutes=0},
  s=>{s[0].reviews[0].reviewBasis=''},
  s=>{s[0].reviews[0].steps[0].activeMinutes=NaN},
  s=>{s[0].reviews[0].steps[0].waitMinutes=10},
  s=>{s[0].reviews[0].steps[0]={activeMinutes:0,waitMinutes:0,resumeMinutes:0,deferred:true}},
 ]){
  const modified=structuredClone(sets);alter(modified);
  assert.throws(()=>compileStepScheduling(catalog,modified));
 }
});

test('changed source instructions and dependency graph require renewed review',()=>{
 const changed=structuredClone(catalog);
 changed[0].sourceSha256='different';
 assert.throws(()=>compileStepScheduling(changed,sets),/source drift/);
 const graph=structuredClone(catalog);
 graph[0].steps[0].dependsOn=['missing'];
 assert.throws(()=>compileStepScheduling(graph,sets),/dependency graph/);
});

test('review annotations cannot override recipe text, ids, dependencies or equipment',()=>{
 const modified=structuredClone(sets);
 for(const set of modified)for(const review of set.reviews){
  review.requiredEquipment=[];
  for(const step of review.steps)Object.assign(step,{text:'injected',sourceStepId:'injected',dependsOn:[],sourceDependsOn:[]});
 }
 assert.deepEqual(compileStepScheduling(catalog,modified),compileStepScheduling(catalog,sets));
});
