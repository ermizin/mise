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
  'function beginChatAdvance(nextStep) {',
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

test('reduced motion opens an ordinary step without artificial delay',()=>{
  const h=harness(true);
  h.ctx.beginChatAdvance(5);
  assert.deepEqual(h.changes,[5]);
  assert.equal(h.tasks.size,0);
  assert.equal(h.state.at(-1),null);
});

test('ordinary step transition keeps ordered feedback and completes within 240ms',()=>{
  const h=harness(false);
  h.ctx.beginChatAdvance(5);
  const tasks=[...h.tasks.values()].sort((a,b)=>a.delay-b.delay);
  assert.equal(tasks.at(-1).delay,240);
  for(const task of tasks) task.callback();
  assert.deepEqual(h.changes,[5]);
  assert.equal(h.state.at(-1),null);
  assert.ok(h.state.every(x=>x===null || x.kind==='step'));
});

test('menu advancement waits for real assembly instead of transition stages',()=>{
  const next = page.slice(page.indexOf('  function next()'), page.indexOf('  function chooseManualMenu()'));
  assert.match(next,/startMenuAssembly\("fill", \(\) => changeStep\(5\)\)/);
  assert.doesNotMatch(next,/beginChatAdvance\(step \+ 1,.*menu/);
  assert.doesNotMatch(page,/assemblyStage|menuAssemblyStages/);
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
