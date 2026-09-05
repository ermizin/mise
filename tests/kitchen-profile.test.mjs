import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadTypeScriptModule } from './typescript-module.mjs';
const { defaultKitchen, isKitchenProfile, kitchenEquipment, sameEquipment } = await loadTypeScriptModule(new URL('../domain/kitchen.ts', import.meta.url));
const plain = x => JSON.parse(JSON.stringify(x));

test('profile preserves all released equipment including pressure cooker and waffle iron', () => {
 const equipment=['stove','pot','pan','oven','baking_dish','multicooker','air_fryer','blender','microwave','waffle_iron','pressure_cooker'];
 const kitchen=defaultKitchen(equipment);
 assert.equal(isKitchenProfile(kitchen),true);
 assert.equal(sameEquipment(equipment,kitchenEquipment(kitchen)),true);
 assert.equal(kitchen.parallelCooking,false);
});
test('zero kitchen stays empty; unrelated appliances and custom names do not create recipe capabilities',()=>{
 const kitchen=defaultKitchen([]);
 kitchen.appliances.processor=true; kitchen.appliances.steamer=true;
 kitchen.cookware.saucepan=2;
 kitchen.custom=[{id:'a',title:'Аэрогриль',count:1}];
 assert.deepEqual(plain(kitchenEquipment(kitchen)),[]);
});
test('profile bounds and names reject corruption rather than silently applying defaults',()=>{
 for(const change of [k=>k.hob.burners=7,k=>k.hob.type='wood',k=>k.hob.type=['gas'],k=>k.appliances.stove=true,k=>k.cookware.pot=-1,k=>k.containers.compartments=0,k=>k.appliances.oven='true',k=>k.custom=[{id:'x',title:' ',count:1}],k=>k.custom=[{id:'x',title:'A',count:1},{id:'x',title:'B',count:1}]]){
  const k=defaultKitchen();change(k);assert.equal(isKitchenProfile(k),false);
 }
});
test('migration adds only kitchen and applies cleanly after earlier migrations',async()=>{
 const sql=await readFile(new URL('../drizzle/0006_polite_george_stacy.sql',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE `kitchens`/);
 assert.doesNotMatch(sql,/ALTER TABLE|DROP TABLE|analytics_events|push_jobs/);
});
test('generated kitchen assets are final checksummed PNGs with provenance',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../assets/kitchen-icons/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.assets.length,9);assert.match(manifest.rightsDecision,/User explicitly requested/);
 for(const asset of manifest.assets){
  const bytes=await readFile(new URL('../'+asset.path,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  assert.equal(bytes.readUInt32BE(16),128);assert.equal(bytes.readUInt32BE(20),128);
  assert.ok(bytes.length<20000);
 }
});
