import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScriptModule } from './typescript-module.mjs';
const { defaultKitchen }=await loadTypeScriptModule(new URL('../domain/kitchen.ts',import.meta.url));
const { buildParallelSchedule,validCookingWindow }=await loadTypeScriptModule(new URL('../domain/parallel-cooking.ts',import.meta.url));
const plain=x=>JSON.parse(JSON.stringify(x));
const dish=(id,equipment=[],totalMinutes=20)=>({id,title:id,methodId:'original',requiredEquipment:equipment,totalMinutes});
const full=()=>{const k=defaultKitchen(['stove','pot','pan','oven','baking_dish']);k.cookware.pot=2;k.cookware.tray=2;return k};

test('disabled hands-free windows never fabricate parallelism from total recipe time',()=>{
 const result=buildParallelSchedule([dish('a',['oven']),dish('b',['stove','pot'])],full());
 assert.equal(result.totalMinutes,40);assert.equal(result.maxParallelDishes,1);
});
test('explicit unattended interval allows compatible work, with one cook at all times',()=>{
 const result=buildParallelSchedule([dish('a',['oven'],30),dish('b',['stove','pot'],10)],full(),{a:{afterMinutes:5,minutes:20}});
 assert.deepEqual(plain(result.dishes.map(d=>[d.start,d.end])),[[0,30],[5,15]]);
 assert.equal(result.totalMinutes,30);assert.equal(result.maxParallelDishes,2);
 for(let m=0;m<result.totalMinutes;m++) assert.ok(result.dishes.filter(d=>m>=d.start&&m<d.end&&(!d.unattended||m<d.start+d.unattended.afterMinutes||m>=d.start+d.unattended.afterMinutes+d.unattended.minutes)).length<=1);
});
test('one oven stays occupied until the dish ends, even in its unattended interval',()=>{
 const result=buildParallelSchedule([dish('a',['oven'],30),dish('b',['oven'],10)],full(),{a:{afterMinutes:5,minutes:20}});
 assert.equal(result.totalMinutes,40);assert.equal(result.maxParallelDishes,1);
});
test('burner and vessel counts constrain parallelism separately',()=>{
 const k=full();k.hob.burners=1;
 const ds=[dish('a',['stove','pot'],30),dish('b',['stove','pot'],10)];
 const windows={a:{afterMinutes:5,minutes:20}};
 assert.equal(buildParallelSchedule(ds,k,windows).totalMinutes,40);
 k.hob.burners=2;assert.equal(buildParallelSchedule(ds,k,windows).totalMinutes,30);
 k.cookware.pot=1;assert.equal(buildParallelSchedule(ds,k,windows).totalMinutes,40);
});
test('unknown resource and unavailable selected method are explicit conflicts',()=>{
 for(const d of [dish('a',['invented']),{...dish('a'),methodId:'missing'},dish('a',[],NaN)]) assert.deepEqual(plain(buildParallelSchedule([d],full()).conflicts),['a']);
});
test('invalid input windows do not free the cook; alternate methods use their own time',()=>{
 for(const window of [{afterMinutes:0,minutes:19},{afterMinutes:1,minutes:20},{afterMinutes:1,minutes:-1},{afterMinutes:1.5,minutes:3}]) assert.equal(validCookingWindow(window,20),false);
 const ds=[{...dish('a',['oven'],35),methodId:'oven-mode'},dish('b',[],10)];
 assert.equal(buildParallelSchedule(ds,full(),{a:{afterMinutes:2,minutes:100}}).totalMinutes,45);
});
test('planner deterministic and does not modify recipe objects',()=>{
 const ds=[dish('a',['oven'],30),dish('b',['stove','pot'],10)];
 const before=JSON.stringify(ds),k=full(),windows={a:{afterMinutes:5,minutes:20}};
 assert.deepEqual(plain(buildParallelSchedule(ds,k,windows)),plain(buildParallelSchedule(ds,k,windows)));
 assert.equal(JSON.stringify(ds),before);
});

const { buildCookingOrder } = await loadTypeScriptModule(new URL('../domain/parallel-cooking.ts', import.meta.url));
test('common order switches during explicit windows and returns after other work', () => {
 const schedule=buildParallelSchedule([dish('a',['oven'],30),dish('b',['stove','pot'],10)],full(),{a:{afterMinutes:5,minutes:20}});
 const before=JSON.stringify(schedule);
 assert.deepEqual(plain(buildCookingOrder(schedule).map(e=>[e.minute,e.kind,e.dishId])),[
  [0,'start','a'],[5,'wait','a'],[5,'start','b'],[15,'finish','b'],[25,'resume','a'],[30,'finish','a']
 ]);
 assert.equal(JSON.stringify(schedule),before);
});
test('same minute releases work before resuming or starting, regardless of input order', () => {
 const schedule={conflicts:[],dishes:[
  {id:'z',title:'z',start:10,end:12,unattended:null},
  {id:'a',title:'a',start:0,end:10,unattended:null},
  {id:'b',title:'b',start:1,end:15,unattended:{afterMinutes:1,minutes:8}},
  {id:'c',title:'c',start:2,end:20,unattended:{afterMinutes:8,minutes:2}}
 ]};
 assert.deepEqual(plain(buildCookingOrder(schedule).filter(e=>e.minute===10).map(e=>e.kind)),['finish','wait','resume','start']);
 assert.deepEqual(plain(buildCookingOrder(schedule)),plain(buildCookingOrder({...schedule,dishes:[...schedule.dishes].reverse()})));
});
test('sequential and invalid windows preserve dish order; conflicts expose no partial order', () => {
 const ds=[dish('a',[],20),dish('b',[],10)];
 for(const windows of [{},{a:{afterMinutes:0,minutes:10}}]) {
  assert.deepEqual(plain(buildCookingOrder(buildParallelSchedule(ds,full(),windows)).map(e=>[e.minute,e.kind])),[[0,'start'],[20,'finish'],[20,'start'],[30,'finish']]);
 }
 assert.deepEqual(plain(buildCookingOrder(buildParallelSchedule([dish('a',['unknown'])],full()))),[]);
 assert.deepEqual(plain(buildCookingOrder(buildParallelSchedule([],full()))),[]);
});
