import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const balance = await loadTypeScriptModule(new URL("../domain/menu-balance.ts", import.meta.url));

const macros = (kcal, protein, fat = 1, carbs = 1) => ({ kcal, protein, fat, carbs });
const candidate = (id, a, b, extra = {}) => ({
  id,
  recipeIds: [`recipe-${id}`],
  macrosByPerson: { A: macros(...a), B: macros(...b) },
  ...extra,
});

function baseInput(overrides = {}) {
  return {
    people: [
      { id: "A", calorieCeiling: 225, proteinTarget: 40 },
      { id: "B", calorieCeiling: 225, proteinTarget: 40 },
    ],
    positions: [
      { id: "breakfast", currentCandidateId: "base-1", candidateIds: ["base-1", "a-boost"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
      { id: "lunch", currentCandidateId: "base-2", candidateIds: ["base-2", "b-boost"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
    ],
    candidateGroups: [
      candidate("base-1", [100, 10, 2, 8], [100, 10, 3, 7]),
      candidate("a-boost", [110, 30, 5, 6], [100, 10, 3, 7], { rank: 1, payload: { source: "a" } }),
      candidate("base-2", [100, 10, 2, 8], [100, 10, 3, 7]),
      candidate("b-boost", [100, 10, 2, 8], [110, 30, 4, 6], { rank: 1, payload: { source: "b" } }),
    ],
    ...overrides,
  };
}

test("bounded search matches an independent exhaustive oracle on a tiny matrix", () => {
  const input = baseInput();
  const byId = new Map(input.candidateGroups.map((item) => [item.id, item]));
  const baseline = [byId.get("base-1"), byId.get("base-2")];
  const score = (items) => ["A", "B"].reduce((sum, personId) => {
    const protein = items.reduce((subtotal, item) => subtotal + item.macrosByPerson[personId].protein, 0);
    return sum + Math.max(0, 40 - protein);
  }, 0);
  const valid = [];
  for (const first of input.positions[0].candidateIds) for (const second of input.positions[1].candidateIds) {
    const items = [byId.get(first), byId.get(second)];
    const withinCap = ["A", "B"].every((personId) => items.reduce((sum, item) => sum + item.macrosByPerson[personId].kcal, 0) <= 225);
    const nonWorsening = ["A", "B"].every((personId) => {
      const current = baseline.reduce((sum, item) => sum + item.macrosByPerson[personId].protein, 0);
      const proposed = items.reduce((sum, item) => sum + item.macrosByPerson[personId].protein, 0);
      return Math.max(0, 40 - proposed) <= Math.max(0, 40 - current);
    });
    if (withinCap && nonWorsening) valid.push({ ids: [first, second], score: score(items) });
  }
  valid.sort((left, right) => left.score - right.score || left.ids.join("|").localeCompare(right.ids.join("|")));

  const result = balance.optimizeDailyProteinBalance(input);
  assert.deepEqual(Object.values(result.selectionByPosition), valid[0].ids);
  assert.equal(result.improved, true);
  assert.deepEqual({ ...result.after.A }, { kcal: 210, protein: 40, fat: 7, carbs: 14, proteinShortfall: 0 });
  assert.deepEqual({ ...result.after.B }, { kcal: 210, protein: 40, fat: 7, carbs: 13, proteinShortfall: 0 });
});

test("a protein surplus for A cannot pay for B's worsened deficit", () => {
  const input = baseInput({
    candidateGroups: [
      candidate("base-1", [100, 10], [100, 10]),
      candidate("a-only", [100, 50], [100, 0]),
      candidate("base-2", [100, 10], [100, 10]),
    ],
    positions: [
      { id: "breakfast", currentCandidateId: "base-1", candidateIds: ["base-1", "a-only"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
      { id: "lunch", currentCandidateId: "base-2", candidateIds: ["base-2"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
    ],
  });
  const result = balance.optimizeDailyProteinBalance(input);
  assert.equal(result.improved, false);
  assert.equal(result.selectionByPosition.breakfast, "base-1");
  assert.equal(result.before.B.proteinShortfall, result.after.B.proteinShortfall);
});

test("strict personal calorie caps rule out an otherwise protein-rich replacement", () => {
  const input = baseInput({
    people: [
      { id: "A", calorieCeiling: 205, proteinTarget: 40 },
      { id: "B", calorieCeiling: 205, proteinTarget: 40 },
    ],
  });
  const result = balance.optimizeDailyProteinBalance(input);
  assert.equal(result.improved, false);
  assert.deepEqual(result.changedPositionIds, []);
  assert.equal(result.goalReached, false);
});

test("an over-ceiling current menu can be recovered without worsening either person's protein shortfall", () => {
  const input = {
    people: [
      { id: "A", calorieCeiling: 220, proteinTarget: 50 },
      { id: "B", calorieCeiling: 220, proteinTarget: 50 },
    ],
    positions: [
      { id: "breakfast", currentCandidateId: "over-1", candidateIds: ["over-1", "trim-1"], kcalRangesByPerson: { A: { min: 90, max: 125 }, B: { min: 90, max: 125 } } },
      { id: "lunch", currentCandidateId: "over-2", candidateIds: ["over-2"], kcalRangesByPerson: { A: { min: 90, max: 125 }, B: { min: 90, max: 125 } } },
    ],
    candidateGroups: [
      candidate("over-1", [120, 20], [120, 20]),
      candidate("trim-1", [100, 20], [100, 20]),
      candidate("over-2", [120, 20], [120, 20]),
    ],
  };
  const result = balance.optimizeDailyProteinBalance(input);
  assert.equal(result.improved, true);
  assert.equal(result.selectionByPosition.breakfast, "trim-1");
  assert.equal(result.feasibility.baselineWithinCalorieCeiling, false);
  assert.equal(result.feasibility.proposalWithinCalorieCeiling, true);
  assert.equal(result.feasibility.proteinShortfallsNonworsening, true);
  assert.equal(result.after.A.kcal, 220);
  assert.equal(result.goalReached, false, "protein and calories must both pass to reach the goal");
});

test("an over-ceiling baseline with no strict-calorie combination returns diagnostics and retains the current selection", () => {
  const input = {
    people: [{ id: "A", calorieCeiling: 220, proteinTarget: 50 }, { id: "B", calorieCeiling: 220, proteinTarget: 50 }],
    positions: [
      { id: "breakfast", currentCandidateId: "over-1", candidateIds: ["over-1"], kcalRangesByPerson: { A: { min: 90, max: 125 }, B: { min: 90, max: 125 } } },
      { id: "lunch", currentCandidateId: "over-2", candidateIds: ["over-2"], kcalRangesByPerson: { A: { min: 90, max: 125 }, B: { min: 90, max: 125 } } },
    ],
    candidateGroups: [candidate("over-1", [120, 20], [120, 20]), candidate("over-2", [120, 20], [120, 20])],
  };
  const result = balance.optimizeDailyProteinBalance(input);
  assert.equal(result.improved, false);
  assert.deepEqual(Object.values(result.selectionByPosition), ["over-1", "over-2"]);
  assert.deepEqual({ ...result.feasibility }, {
    baselineWithinCalorieCeiling: false,
    proposalWithinCalorieCeiling: false,
    feasiblePlanFound: false,
    proteinShortfallsNonworsening: true,
  });
  assert.equal(result.goalReached, false);
});

test("locked positions remain on their current candidate while an unlocked slot can improve", () => {
  const input = baseInput({ positions: [
    { id: "breakfast", currentCandidateId: "base-1", candidateIds: ["base-1", "a-boost"], locked: true, kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
    { id: "lunch", currentCandidateId: "base-2", candidateIds: ["base-2", "b-boost"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } },
  ] });
  const result = balance.optimizeDailyProteinBalance(input);
  assert.deepEqual(result.changedPositionIds, ["lunch"]);
  assert.equal(result.selectionByPosition.breakfast, "base-1");
  assert.equal(result.after.A.proteinShortfall, 20);
  assert.equal(result.after.B.proteinShortfall, 0);
});

test("hard-filters partial coverage, NaN, negatives, duplicate ids, and repeated recipes", () => {
  const valid = candidate("valid", [100, 10], [100, 10]);
  const invalids = [
    { ...candidate("partial", [100, 20], [100, 20]), macrosByPerson: { A: macros(100, 20) } },
    candidate("nan", [100, Number.NaN], [100, 20]),
    candidate("negative", [100, -1], [100, 20]),
    { ...candidate("repeated-recipe", [100, 20], [100, 20]), recipeIds: ["same", "same"] },
    candidate("duplicate", [100, 20], [100, 20]),
    candidate("duplicate", [100, 20], [100, 20]),
  ];
  const result = balance.optimizeDailyProteinBalance({
    people: [{ id: "A", calorieCeiling: 120, proteinTarget: 10 }, { id: "B", calorieCeiling: 120, proteinTarget: 10 }],
    positions: [{ id: "only", currentCandidateId: "valid", candidateIds: ["valid", "partial", "nan", "negative", "repeated-recipe", "duplicate"], kcalRangesByPerson: { A: { min: 80, max: 120 }, B: { min: 80, max: 120 } } }],
    candidateGroups: [valid, ...invalids],
  });
  assert.equal(result.selectionByPosition.only, "valid");
  assert.deepEqual(new Set(result.invalidCandidates.map((issue) => issue.reason)), new Set([
    "incomplete-person-coverage", "invalid-macros", "recipe-ids-must-be-present-and-unique", "duplicate-candidate-id",
  ]));
});

test("a slot may cover only its explicit eaters, while extra person macros are rejected", () => {
  const solo = {
    id: "solo", recipeIds: ["recipe-solo"], macrosByPerson: { A: macros(100, 15, 2, 8) },
  };
  const extra = {
    id: "extra", recipeIds: ["recipe-extra"], macrosByPerson: { A: macros(100, 20), B: macros(100, 20) },
  };
  const result = balance.optimizeDailyProteinBalance({
    people: [{ id: "A", calorieCeiling: 120, proteinTarget: 15 }, { id: "B", calorieCeiling: 0, proteinTarget: 0 }],
    positions: [{ id: "breakfast", currentCandidateId: "solo", candidateIds: ["solo", "extra"], kcalRangesByPerson: { A: { min: 80, max: 120 } } }],
    candidateGroups: [solo, extra],
  });
  assert.equal(result.after.A.protein, 15);
  assert.equal(result.after.B.kcal, 0);
  assert.ok(result.invalidCandidates.some((issue) => issue.candidateId === "extra" && issue.reason === "incomplete-person-coverage"));
});

test("result is deterministic, preserves payload, leaves input untouched, and labels allocated targets", () => {
  const input = baseInput({ proteinTargetScope: "allocated" });
  const before = structuredClone(input);
  const first = balance.optimizeDailyProteinBalance(input);
  const second = balance.optimizeDailyProteinBalance(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(first.objective.proteinTargetScope, "allocated");
  assert.equal(first.selectedCandidatesByPosition.breakfast.payload, input.candidateGroups.find((item) => item.id === "a-boost").payload);
});
