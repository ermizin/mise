import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {productionCookingCatalog} from './production-cooking-catalog.mjs';

export const reviewFiles=['shard-1.json','shard-2.json','shard-3.json'];
const positive=n=>Number.isInteger(n)&&n>0&&n<=20160;
const bounded=n=>n===0||positive(n);
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
export function compileStepScheduling(catalog,sets){
 const reviews=sets.flatMap(set=>set.reviews.map(review=>({...review,sourceRevision:set.sourceRevision})));
 const key=item=>`${item.recipeId}@${item.methodId}`;
 const sourceKeys=new Set(catalog.map(key));
 if(sourceKeys.size!==catalog.length||new Set(reviews.map(key)).size!==reviews.length)throw Error('Duplicate recipe/method in scheduling sources');
 const byKey=new Map(reviews.map(review=>[key(review),review]));
 const extra=reviews.filter(review=>!sourceKeys.has(key(review)));
 if(extra.length)throw Error(`Scheduling reviews contain unavailable methods: ${extra.map(key).join(', ')}`);
 const profiles=catalog.map(method=>{
  const review=byKey.get(key(method));
  const fail=message=>{throw Error(`${key(method)}: ${message}`)};
  if(!review)fail('missing complete review');
  if(review.sourceSha256!==method.sourceSha256)fail('source drift; review current instructions/method before regeneration');
  if(!nonempty(review.reviewBasis)||!(/^[a-f0-9]{40}$/).test(review.sourceRevision)||!positive(review.measurementMinutes)||review.measurementMinutes>60)fail('missing review provenance/measurement estimate');
  if(review.steps.length!==method.steps.length||!review.steps.length)fail('omitted or extra steps');
  const seen=new Set();
  let deferred=false;
  const steps=method.steps.map((source,index)=>{
   if(!source.id||seen.has(source.id)||source.dependsOn.some(id=>!seen.has(id)))fail(`invalid source dependency graph at ${index+1}`);
   seen.add(source.id);
   const timing=review.steps[index];
   if((timing.deferred?timing.activeMinutes!==0:!positive(timing.activeMinutes))||!bounded(timing.waitMinutes)||!bounded(timing.resumeMinutes))fail(`invalid duration at ${index+1}`);
   if(timing.waitMinutes?(!nonempty(timing.waitBasis)||!positive(timing.resumeMinutes)):timing.resumeMinutes!==0)fail(`unreviewed wait at ${index+1}`);
   if(timing.deferred!==undefined&&typeof timing.deferred!=='boolean')fail(`invalid deferred marker at ${index+1}`);
   if(deferred&&!timing.deferred)fail(`in-session step follows deferred predecessor at ${index+1}`);
   if(timing.deferred){deferred=true;if(timing.waitMinutes||timing.resumeMinutes)fail(`deferred wait incorrectly scheduled now at ${index+1}`)}
   return {text:source.text,sourceStepId:source.id,dependsOn:index?[method.steps[index-1].id]:[],sourceDependsOn:source.dependsOn,
    activeMinutes:timing.activeMinutes,waitMinutes:timing.waitMinutes,resumeMinutes:timing.resumeMinutes,
    ...(timing.waitMinutes?{waitBasis:timing.waitBasis}:{}),...(timing.deferred?{deferred:true}:{})};
  });
  const duration=review.measurementMinutes+steps.filter(s=>!s.deferred).reduce((sum,s)=>sum+s.activeMinutes+s.waitMinutes+s.resumeMinutes,0);
  if(duration>20160)fail('recipe scheduling horizon exceeds 14 days');
  if(!positive(Math.ceil(method.totalMinutes)))fail('invalid source total time');
  if((duration>Math.max(method.totalMinutes*2,method.totalMinutes+30)||steps.some(s=>s.deferred))&&!nonempty(review.timingNote))fail('timing/deferred difference needs a specific review note');
  return {recipeId:method.recipeId,methodId:method.methodId,sourceRevision:review.sourceRevision,sourceSha256:method.sourceSha256,
   provenance:review.reviewBasis,sourceTotalMinutes:method.totalMinutes,sourceActiveMinutes:method.sourceActiveMinutes,
   ...(review.timingNote?{timingNote:review.timingNote}:{}),requiredEquipment:method.requiredEquipment,measurementMinutes:review.measurementMinutes,steps};
 });
 return {schemaVersion:2,coverage:{recipes:new Set(catalog.map(m=>m.recipeId)).size,methods:profiles.length,
  steps:profiles.reduce((sum,p)=>sum+p.steps.length,0),methodsWithReviewedWait:profiles.filter(p=>p.steps.some(s=>s.waitMinutes>0)).length,
  methodsWithoutReviewedWait:profiles.filter(p=>p.steps.every(s=>!s.waitMinutes)).length,
  deferredSteps:profiles.reduce((sum,p)=>sum+p.steps.filter(s=>s.deferred).length,0)},profiles};
}
export async function buildRecipeStepScheduling(){
 const [catalog,...sets]=await Promise.all([productionCookingCatalog(),...reviewFiles.map(name=>readFile(new URL(`../data/step-scheduling-reviews/${name}`,import.meta.url),'utf8').then(JSON.parse))]);
 return compileStepScheduling(catalog,sets);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const result=await buildRecipeStepScheduling();
 const encoded=JSON.stringify(result,null,2)+'\n';
 const i=process.argv.indexOf('--output');
 const path=i>=0?pathToFileURL(resolve(process.argv[i+1])):new URL('../data/recipe-step-scheduling.json',import.meta.url);
 if(process.argv.includes('--check')){
  if(await readFile(path,'utf8')!==encoded)throw Error('Scheduling artifact is stale; regenerate from reviewed sources');
 }else await writeFile(path,encoded);
 console.log(JSON.stringify(result.coverage));
}
