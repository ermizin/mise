import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { startMenuAssemblyTask } from "../lib/menu-assembly-task.ts";

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const timing = {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  function tick() {
    const due = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!due) return false;
    now = due[1].at;
    timers.delete(due[0]);
    due[1].callback();
    return true;
  }
  function advance(to) {
    while (true) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due || due[1].at > to) break;
      tick();
    }
    now = to;
  }
  return { timing, tick, advance, elapse: (ms) => { now += ms; } };
}

test("yielded assembly keeps deterministic order and commits once", () => {
  const positions = ["breakfast-1", "lunch-1", "breakfast-2"];
  function* assemble() {
    const choices = {};
    const used = new Set();
    for (const position of positions) {
      const candidates = position.startsWith("breakfast") ? ["oats", "eggs"] : ["rice"];
      const selected = candidates.find((candidate) => !used.has(candidate)) ?? candidates[0];
      choices[position] = selected;
      used.add(selected);
      yield;
    }
    return choices;
  }
  const reference = assemble();
  let expected;
  while (true) {
    const next = reference.next();
    if (next.done) { expected = next.value; break; }
  }
  const time = clock();
  const commits = [];
  startMenuAssemblyTask(assemble(), {
    onSlow: () => assert.fail("unexpected slow state"),
    onComplete: (value) => commits.push(value),
    onError: (error) => { throw error; },
  }, time.timing);
  time.tick();
  assert.equal(commits.length, 0, "partial selections stay private");
  time.advance(0);
  assert.deepEqual(commits, [expected]);
});

test("production menu generator returns the same fill and reset result when yielded", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("function* assembleMenuSteps(");
  const end = page.indexOf("function startMenuAssembly(", start);
  assert.ok(start >= 0 && end > start);
  const source = ts.transpileModule(
    `${page.slice(start, end)}\nglobalThis.assembleMenuSteps = assembleMenuSteps;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const normalize = (value) => JSON.parse(JSON.stringify(value));
  function fixture() {
    const batches = [{ id: "first", days: 2 }, { id: "second", days: 2 }];
    const mealSlots = ["breakfast", "lunch"];
    const positions = batches.flatMap((batch) => mealSlots.map((slot) => ({ batch, slot })));
    const recipesById = Object.fromEntries(["oats", "eggs", "rice", "beans"].map((id) => [id, { id }]));
    const context = {
      validSelections: { "first::breakfast": "oats", "first::lunch": "rice", "second::breakfast": "eggs" },
      validSelectionAssignments: {
        "first::breakfast": [{ recipeId: "oats", personIds: ["one"] }],
        "first::lunch": [{ recipeId: "rice", personIds: ["one"] }],
        "second::breakfast": [{ recipeId: "eggs", personIds: ["one"] }],
      },
      mealSlots,
      positions,
      pinned: ["first::breakfast"],
      people: [{ id: "one" }],
      menuStyle: "protein",
      kitchenEquipment: ["stove"],
      recipesById,
      selectionKey: (batch, slot) => `${batch.id}::${slot}`,
      assignmentCoverageComplete: (_people, _slot, assignments) => assignments.some((item) => item.personIds.includes("one")),
      automaticAssignmentsFor: (slot, _style, _people, _days, used, avoid) => {
        const options = slot === "breakfast" ? ["oats", "eggs"] : ["rice", "beans"];
        const recipeId = options.find((id) => !used.has(id) && !avoid.has(id))
          ?? options.find((id) => !avoid.has(id)) ?? options[0];
        return [{ recipeId, personIds: ["one"] }];
      },
    };
    runInNewContext(source, context);
    return context.assembleMenuSteps;
  }
  for (const mode of ["fill", "reset"]) {
    const synchronous = fixture()(mode);
    let expected;
    while (true) {
      const next = synchronous.next();
      if (next.done) { expected = next.value; break; }
    }
    const time = clock();
    const commits = [];
    startMenuAssemblyTask(fixture()(mode), {
      onSlow: () => assert.fail("unexpected slow state"),
      onComplete: (result) => commits.push(normalize(result)),
      onError: (error) => { throw error; },
    }, time.timing);
    time.tick();
    assert.equal(commits.length, 0);
    time.advance(0);
    assert.deepEqual(commits, [normalize(expected)]);
    assert.equal(commits[0].assignments["first::breakfast"][0].recipeId, "oats");
  }
});

test("fast assembly completes without exposing the slow state", () => {
  const time = clock();
  const events = [];
  function* steps() {
    yield;
    yield;
    return "menu";
  }
  startMenuAssemblyTask(steps(), {
    onSlow: () => events.push("slow"),
    onComplete: (value) => events.push(value),
    onError: () => events.push("error"),
  }, time.timing);
  time.advance(2_100);
  assert.deepEqual(events, ["menu"]);
});

test("slow state appears only while real work remains pending", () => {
  const time = clock();
  const events = [];
  function* steps() {
    for (let index = 0; index < 4; index += 1) {
      time.elapse(600);
      yield;
    }
    return "menu";
  }
  startMenuAssemblyTask(steps(), {
    onSlow: () => events.push("slow"),
    onComplete: (value) => events.push(value),
    onError: () => events.push("error"),
  }, time.timing);
  time.advance(3_000);
  assert.deepEqual(events, ["slow", "menu"]);
});

test("cancel prevents stale completion and slow state", () => {
  const time = clock();
  const events = [];
  function* steps() {
    yield;
    return "menu";
  }
  const task = startMenuAssemblyTask(steps(), {
    onSlow: () => events.push("slow"),
    onComplete: (value) => events.push(value),
    onError: () => events.push("error"),
  }, time.timing);
  task.cancel();
  time.advance(3_000);
  assert.deepEqual(events, []);
});

test("cancel after a slow chunk prevents a partial menu from committing", () => {
  const time = clock();
  const events = [];
  function* steps() {
    time.elapse(2_100);
    yield;
    return "menu";
  }
  const task = startMenuAssemblyTask(steps(), {
    onSlow: () => events.push("slow"),
    onComplete: () => events.push("complete"),
    onError: () => events.push("error"),
  }, time.timing);
  time.tick();
  time.tick();
  task.cancel();
  time.advance(3_000);
  assert.deepEqual(events, ["slow"]);
});

test("failure clears pending work and reports one error", () => {
  const time = clock();
  const events = [];
  function* steps() {
    yield;
    throw new Error("candidate failed");
  }
  startMenuAssemblyTask(steps(), {
    onSlow: () => events.push("slow"),
    onComplete: () => events.push("complete"),
    onError: (error) => events.push(error.message),
  }, time.timing);
  time.advance(3_000);
  assert.deepEqual(events, ["candidate failed"]);
});
