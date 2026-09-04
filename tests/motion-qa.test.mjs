import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// Exercise the actual transition scheduler with a deterministic clock.
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const start = page.indexOf('  function beginChatAdvance(');
const end = page.indexOf('  function setQuickPeriod(', start);
const scheduler = page.slice(start, end).replace(
  /function beginChatAdvance\([\s\S]*?\) \{/,
  'function beginChatAdvance(nextStep, kind = "step") {',
);
function harness(reducedMotion) {
  let current = 0;
  const tasks = new Map();
  const changes = [];
  const state = [];
  const ctx = {
    chatTransition: null,
    chatTimersRef: {current: []},
    builderChatTurns: [{answer:'Ответ'}],
    step:0,
    menuAssemblyStages:[0,1,2,3],
    setChatTransition: value => state.push(value),
    changeStep: value => changes.push(value),
    window: {
      matchMedia: () => ({matches: reducedMotion}),
      setTimeout: (callback, delay) => {const id=++current;tasks.set(id,{callback,delay});return id;},
      clearTimeout: id => tasks.delete(id),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(scheduler,ctx);
  return {ctx,tasks,changes,state};
}

test('reduced motion opens both ordinary steps and assembled menu without artificial delays',()=>{
  for(const kind of ['step','menu']) {
    const h=harness(true);
    h.ctx.beginChatAdvance(5,kind);
    assert.deepEqual(h.changes,[5]);
    assert.equal(h.tasks.size,0);
    assert.equal(h.state.at(-1),null);
  }
});

test('ordinary menu transition keeps ordered feedback and completes within 1200ms',()=>{
  const h=harness(false);
  h.ctx.beginChatAdvance(5,'menu');
  const tasks=[...h.tasks.values()].sort((a,b)=>a.delay-b.delay);
  assert.ok(tasks.at(-1).delay <= 1200);
  for(const task of tasks) task.callback();
  assert.deepEqual(h.changes,[5]);
  assert.deepEqual(h.state.filter(x=>x?.assemblyStage>=0).map(x=>x.assemblyStage),[0,1,2,3,4]);
});

test('restarting the scheduler cancels every previous callback',()=>{
  const h=harness(false);
  h.ctx.beginChatAdvance(1);
  const oldIds=[...h.tasks.keys()];
  h.ctx.beginChatAdvance(2);
  assert.ok(oldIds.every(id=>!h.tasks.has(id)));
  for(const task of [...h.tasks.values()].sort((a,b)=>a.delay-b.delay)) task.callback();
  assert.deepEqual(h.changes,[2]);
});
