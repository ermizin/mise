import {createHash} from 'node:crypto';
import {productionRecipes} from './build-plan-recipe-registry.mjs';

export async function productionCookingCatalog(){
 const recipes=await productionRecipes();
 return structuredClone(recipes.flatMap(recipe=>recipe.equipmentOptions.map(method=>{
  const family=recipe.recipeFamily?.miseInstructions??[];
  const measures=new Set(family.filter(s=>s.action==='measure').map(s=>s.id));
  const source=method.steps?method.steps.map((text,index)=>({id:`method-step-${index+1}`,text,dependsOn:index?[`method-step-${index}`]:[]})):
   family.filter(s=>s.action!=='measure');
  const steps=source.map((s,index)=>({id:s.id??`step-${index+1}`,text:s.text,dependsOn:(s.dependsOn??[]).filter(id=>!measures.has(id))}));
  const item={recipeId:recipe.id,title:recipe.title,methodId:method.id,requiredEquipment:method.requiredEquipment,
   totalMinutes:method.timeMinutes??recipe.time,sourceActiveMinutes:method.activeMinutes??recipe.effort.activeMinutes,
   steps};
  return {...item,sourceSha256:createHash('sha256').update(JSON.stringify(item)).digest('hex')};
 })).sort((a,b)=>a.recipeId<b.recipeId?-1:a.recipeId>b.recipeId?1:a.methodId.localeCompare(b.methodId)));
}
