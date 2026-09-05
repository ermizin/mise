import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTypeScriptModule } from './typescript-module.mjs';
const kitchen = await loadTypeScriptModule(new URL('../domain/kitchen.ts', import.meta.url));
const source = ts.transpileModule(await readFile(new URL('../hooks/use-kitchen.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clone = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(resolve=>setImmediate(resolve));
function harness(fetcher, stored = null) {
 const slots=[], effects=[], timers=new Map(), listeners=new Map(), storage=new Map();
 const id='11111111-1111-4111-8111-111111111111', key=`mise-kitchen-v1:${id}`;
 if(stored) storage.set(key,JSON.stringify(stored));
 let cursor=0, timerId=0, current;
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((x,i)=>x!==b[i]);
 const React={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useCallback(callback,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))slots[i]={value:callback,deps};return slots[i].value;},
  useEffect(callback,deps){const i=cursor++;if(changed(slots[i]?.deps,deps)){slots[i]={deps};effects.push(callback);}}
 };
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>listeners.get(event.type)?.()};
 const navigator={onLine:true};
 const exports={};
 vm.runInNewContext(source,{exports,require:name=>name==='react'?React:kitchen,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},navigator,window,document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},Event,setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),fetch:fetcher});
 const getId=()=>id;
 const render=()=>{cursor=0;current=exports.useKitchen(getId,['stove','pot'],true);for(const fn of effects.splice(0))fn();return current;};
 return {render,navigator,stored:()=>JSON.parse(storage.get(key)),async settle(){await tick();await tick();return render();},async flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}await tick();return render();},offline(){navigator.onLine=false;window.dispatchEvent(new Event('offline'));},online(){navigator.onLine=true;window.dispatchEvent(new Event('online'));}};
}
const reply=(value,status=200)=>new Response(JSON.stringify({kitchen:value}),{status,headers:{'content-type':'application/json'}});
test('kitchen coalesces edits and retains the newest snapshot while a request is in flight',async()=>{
 let resolveFirst;const sent=[];
 const h=harness(async(_url,init)=>{if(init.method!=='PATCH')return reply(kitchen.defaultKitchen());sent.push(JSON.parse(init.body));if(sent.length===1)return new Promise(resolve=>resolveFirst=resolve);return reply(JSON.parse(init.body));});
 h.render();let state=await h.settle();
 const first=clone(state.value);first.hob.burners=1;state.update(first,'hob');
 state=await h.flush();const second=clone(state.value);second.hob.burners=2;state.update(second,'hob');
 resolveFirst(reply(first));state=await h.settle();state=await h.settle();
 assert.equal(sent.length,2);assert.equal(state.value.hob.burners,2);assert.equal(state.status,'synced');assert.equal(h.stored().pending,false);
});
test('offline edit is durable and replayed after reopening even when remote has older data',async()=>{
 const confirmed=kitchen.defaultKitchen();const h=harness(async()=>reply(confirmed));h.render();let state=await h.settle();
 h.navigator.onLine=false;const next=clone(state.value);next.containers.count=17;state.update(next,'containers');state=await h.flush();
 assert.equal(state.status,'pending');assert.equal(h.stored().pending,true);
 let sent;const restored=harness(async(_url,init)=>{if(init.method==='PATCH'){sent=JSON.parse(init.body);return reply(sent);}return reply(confirmed);},h.stored());
 restored.render();state=await restored.settle();state=await restored.settle();
 assert.equal(sent.containers.count,17);assert.equal(state.status,'synced');assert.equal(state.value.containers.count,17);
});
test('server rejection rolls back confirmed settings; uncertain transport preserves pending edits',async()=>{
 for(const transport of [false,true]){
 const confirmed=kitchen.defaultKitchen();const h=harness(async(_url,init)=>{if(init.method!=='PATCH')return reply(confirmed);if(transport)throw new Error('offline');return reply(null,422);});h.render();let state=await h.settle();
 const next=clone(state.value);next.cookware.pan=9;state.update(next,'cookware');state=await h.flush();
 assert.equal(state.value.cookware.pan,transport?9:confirmed.cookware.pan);assert.equal(h.stored().pending,transport);assert.equal(state.status,transport?'pending':'error');
 }
});
test('uncached load failure cannot replace unknown server settings with defaults',async()=>{
 const h=harness(async()=>{throw new Error('unavailable');});h.render();const state=await h.settle();assert.equal(state.editable,false);assert.equal(state.status,'error');
 const next=kitchen.defaultKitchen();next.hob.burners=6;state.update(next,'hob');assert.equal(h.render().value.hob.burners,4);
});

test('reconnecting with no pending edit returns to synced and does not trap apply disabled',async()=>{
 const h=harness(async()=>reply(kitchen.defaultKitchen()));h.render();await h.settle();h.offline();assert.equal(h.render().status,'pending');h.online();const state=await h.settle();assert.equal(state.status,'synced');assert.equal(h.stored().pending,false);
});

test('temporary server failure retains the edit and retry sends it once recovered',async()=>{
 let fail=true;const sent=[];const h=harness(async(_url,init)=>{if(init.method!=='PATCH')return reply(kitchen.defaultKitchen());sent.push(JSON.parse(init.body));return reply(fail?null:JSON.parse(init.body),fail?503:200);});
 h.render();let state=await h.settle();const next=clone(state.value);next.containers.count=23;state.update(next,'containers');state=await h.flush();
 assert.equal(state.status,'pending');assert.equal(h.stored().pending,true);assert.equal(state.value.containers.count,23);fail=false;state.retry();state=await h.settle();
 assert.equal(state.status,'synced');assert.equal(h.stored().pending,false);assert.equal(sent[1].containers.count,23);
});
