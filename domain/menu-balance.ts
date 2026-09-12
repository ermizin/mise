export type DailyMenuMacros = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

function compareCalorieRecoveryPlans<TPayload>(
  left: SearchPlan<TPayload>,
  right: SearchPlan<TPayload>,
  baseline: Record<string, Pick<DailyMenuMacros, "protein">>,
  people: readonly DailyMenuPerson[],
) {
  const maxIncrease = maxShortfallIncrease(left, baseline, people) - maxShortfallIncrease(right, baseline, people);
  if (maxIncrease) return maxIncrease;
  const totalIncrease = totalShortfallIncrease(left, baseline, people) - totalShortfallIncrease(right, baseline, people);
  if (totalIncrease) return totalIncrease;
  return comparePlans(left, right, people);
}

function maxShortfallIncrease<TPayload>(
  plan: SearchPlan<TPayload>,
  baseline: Record<string, Pick<DailyMenuMacros, "protein">>,
  people: readonly DailyMenuPerson[],
) {
  return Math.max(...people.map((person) => Math.max(
    0,
    Math.max(0, person.proteinTarget - plan.totals[person.id].protein) -
      Math.max(0, person.proteinTarget - baseline[person.id].protein),
  )));
}

function totalShortfallIncrease<TPayload>(
  plan: SearchPlan<TPayload>,
  baseline: Record<string, Pick<DailyMenuMacros, "protein">>,
  people: readonly DailyMenuPerson[],
) {
  return people.reduce((sum, person) => sum + Math.max(
    0,
    Math.max(0, person.proteinTarget - plan.totals[person.id].protein) -
      Math.max(0, person.proteinTarget - baseline[person.id].protein),
  ), 0);
};

export type DailyMenuPerson = {
  id: string;
  calorieCeiling: number;
  /** The caller supplies either the full-day target or its allocated share. */
  proteinTarget: number;
};

export type KcalRange = {
  min: number;
  max: number;
};

export type DailyMenuPosition = {
  id: string;
  currentCandidateId: string;
  /** Candidate ids available for this exact slot. */
  candidateIds: readonly string[];
  /** A cooked, manually pinned, or user-chosen position cannot be replaced. */
  locked?: boolean;
  /** Its keys are the people eating this slot and must match candidate macros exactly. */
  kcalRangesByPerson: Readonly<Record<string, KcalRange>>;
};

/** One complete per-person assignment for one menu position. */
export type DailyMenuCandidate<TPayload = unknown> = {
  id: string;
  recipeIds: readonly string[];
  macrosByPerson: Readonly<Record<string, DailyMenuMacros>>;
  rank?: number;
  cost?: number;
  payload?: TPayload;
};

export type DailyProteinBalanceInput<TPayload = unknown> = {
  people: readonly DailyMenuPerson[];
  positions: readonly DailyMenuPosition[];
  /** Complete per-person slot assignments, referenced by position.candidateIds. */
  candidateGroups: readonly DailyMenuCandidate<TPayload>[];
  /** Labels the target supplied by the caller; it does not rescale it. */
  proteinTargetScope?: "daily" | "allocated";
  /** Per-position catalog cap before searching. Defaults to 20. */
  maxCandidatesPerPosition?: number;
  /** Maximum retained partial plans at each position. Defaults to 48. */
  beamWidth?: number;
};

export type PersonBalanceTotals = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  proteinShortfall: number;
};

export type DailyProteinBalanceResult<TPayload = unknown> = {
  objective: {
    proteinTargetScope: "daily" | "allocated";
    /** Preserve each shortfall when possible; otherwise restore calorie feasibility with the least personal regression. */
    kind: "calorie-feasible-personal-shortfalls";
  };
  improved: boolean;
  /** True means caps/pruning limited the search; it never means a goal is unreachable. */
  searchExhausted: boolean;
  feasibility: {
    baselineWithinCalorieCeiling: boolean;
    proposalWithinCalorieCeiling: boolean;
    /** A strict-calorie candidate combination was found by this bounded search. */
    feasiblePlanFound: boolean;
    /** The selected proposal did not increase any individual protein shortfall. */
    proteinShortfallsNonworsening: boolean;
  };
  goalReached: boolean;
  changedPositionIds: string[];
  selectionByPosition: Record<string, string>;
  selectedCandidatesByPosition: Record<string, DailyMenuCandidate<TPayload>>;
  before: Record<string, PersonBalanceTotals>;
  after: Record<string, PersonBalanceTotals>;
  invalidCandidates: Array<{ positionId: string; candidateId: string; reason: string }>;
};

type SearchPlan<TPayload> = {
  candidates: DailyMenuCandidate<TPayload>[];
  totals: Record<string, DailyMenuMacros>;
  rank: number;
  cost: number;
  stableKey: string;
};

const DEFAULT_BEAM_WIDTH = 48;
const DEFAULT_CANDIDATE_CAP = 20;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertInput<TPayload>(input: DailyProteinBalanceInput<TPayload>) {
  if (!input.people.length) throw new Error("At least one person is required.");
  if (!input.positions.length) throw new Error("At least one menu position is required.");
  if (new Set(input.people.map((person) => person.id)).size !== input.people.length)
    throw new Error("Person ids must be unique.");
  if (new Set(input.positions.map((position) => position.id)).size !== input.positions.length)
    throw new Error("Position ids must be unique.");

  for (const person of input.people) {
    if (!person.id) throw new Error("Person ids must be non-empty.");
    if (!finiteNonNegative(person.calorieCeiling) || !finiteNonNegative(person.proteinTarget))
      throw new Error("Person calorie ceilings and protein targets must be finite non-negative numbers.");
  }
  for (const position of input.positions) {
    if (!position.id || !position.currentCandidateId)
      throw new Error("Position ids and current candidate ids must be non-empty.");
    if (!position.candidateIds.length || new Set(position.candidateIds).size !== position.candidateIds.length)
      throw new Error("Position candidate ids must be present and unique.");
    if (!position.candidateIds.includes(position.currentCandidateId))
      throw new Error("The current candidate must be available for its position.");
    if (!Object.keys(position.kcalRangesByPerson).length)
      throw new Error("Every position must name at least one eater through calorie ranges.");
    for (const [personId, range] of Object.entries(position.kcalRangesByPerson)) {
      if (!input.people.some((person) => person.id === personId))
        throw new Error(`Unknown person ${personId} in a calorie range.`);
      if (!finiteNonNegative(range.min) || !finiteNonNegative(range.max) || range.min > range.max)
        throw new Error("Calorie ranges must be finite, non-negative, and ordered.");
    }
  }
}

function candidateIssue<TPayload>(
  candidate: DailyMenuCandidate<TPayload>,
  position: DailyMenuPosition,
): string | null {
  if (!candidate.id) return "missing-id";
  if (!Array.isArray(candidate.recipeIds) || !candidate.recipeIds.length || new Set(candidate.recipeIds).size !== candidate.recipeIds.length)
    return "recipe-ids-must-be-present-and-unique";
  if (candidate.rank !== undefined && !finiteNonNegative(candidate.rank)) return "invalid-rank";
  if (candidate.cost !== undefined && !finiteNonNegative(candidate.cost)) return "invalid-cost";
  if (!candidate.macrosByPerson || typeof candidate.macrosByPerson !== "object") return "incomplete-person-coverage";
  const eaterIds = Object.keys(position.kcalRangesByPerson);
  const macroPeople = Object.keys(candidate.macrosByPerson);
  if (macroPeople.length !== eaterIds.length || eaterIds.some((personId) => !(personId in candidate.macrosByPerson)))
    return "incomplete-person-coverage";
  for (const personId of eaterIds) {
    const macros = candidate.macrosByPerson[personId];
    if (!macros || !finiteNonNegative(macros.kcal) || !finiteNonNegative(macros.protein) || !finiteNonNegative(macros.fat) || !finiteNonNegative(macros.carbs))
      return "invalid-macros";
    const range = position.kcalRangesByPerson[personId];
    if (macros.kcal < range.min || macros.kcal > range.max) return "outside-kcal-range";
  }
  return null;
}

function emptyTotals(people: readonly DailyMenuPerson[]) {
  return Object.fromEntries(people.map((person) => [person.id, { kcal: 0, protein: 0, fat: 0, carbs: 0 }])) as Record<string, DailyMenuMacros>;
}

function totalsWithCandidate<TPayload>(
  totals: Record<string, DailyMenuMacros>,
  candidate: DailyMenuCandidate<TPayload>,
  people: readonly DailyMenuPerson[],
) {
  const next: Record<string, DailyMenuMacros> = {};
  for (const person of people) {
    const macros = candidate.macrosByPerson[person.id];
    next[person.id] = {
      kcal: totals[person.id].kcal + (macros?.kcal ?? 0),
      protein: totals[person.id].protein + (macros?.protein ?? 0),
      fat: totals[person.id].fat + (macros?.fat ?? 0),
      carbs: totals[person.id].carbs + (macros?.carbs ?? 0),
    };
  }
  return next;
}

function withinCeilings(totals: Record<string, Pick<DailyMenuMacros, "kcal">>, people: readonly DailyMenuPerson[]) {
  return people.every((person) => totals[person.id].kcal <= person.calorieCeiling);
}

function describeTotals(
  totals: Record<string, DailyMenuMacros>,
  people: readonly DailyMenuPerson[],
) {
  return Object.fromEntries(people.map((person) => {
    const value = totals[person.id];
    return [person.id, {
      kcal: value.kcal,
      protein: value.protein,
      fat: value.fat,
      carbs: value.carbs,
      proteinShortfall: Math.max(0, person.proteinTarget - value.protein),
    }];
  })) as Record<string, PersonBalanceTotals>;
}

function shortfallSum(totals: Record<string, Pick<DailyMenuMacros, "protein">>, people: readonly DailyMenuPerson[]) {
  return people.reduce((sum, person) => sum + Math.max(0, person.proteinTarget - totals[person.id].protein), 0);
}

function doesNotWorsen(
  candidate: Record<string, Pick<DailyMenuMacros, "protein">>,
  baseline: Record<string, Pick<DailyMenuMacros, "protein">>,
  people: readonly DailyMenuPerson[],
) {
  return people.every((person) =>
    Math.max(0, person.proteinTarget - candidate[person.id].protein) <=
    Math.max(0, person.proteinTarget - baseline[person.id].protein),
  );
}

function comparePlans<TPayload>(left: SearchPlan<TPayload>, right: SearchPlan<TPayload>, people: readonly DailyMenuPerson[]) {
  const shortfallDifference = shortfallSum(left.totals, people) - shortfallSum(right.totals, people);
  if (shortfallDifference) return shortfallDifference;
  for (const person of people) {
    const difference = Math.max(0, person.proteinTarget - left.totals[person.id].protein) - Math.max(0, person.proteinTarget - right.totals[person.id].protein);
    if (difference) return difference;
  }
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.cost !== right.cost) return left.cost - right.cost;
  return compareText(left.stableKey, right.stableKey);
}

function candidateOrder<TPayload>(left: DailyMenuCandidate<TPayload>, right: DailyMenuCandidate<TPayload>) {
  const rankDifference = (left.rank ?? 0) - (right.rank ?? 0);
  if (rankDifference) return rankDifference;
  const costDifference = (left.cost ?? 0) - (right.cost ?? 0);
  if (costDifference) return costDifference;
  return compareText(left.id, right.id);
}

/**
 * Finds a bounded, deterministic replacement plan. Protein surplus belongs only
 * to the same person; it never reduces another person's shortfall.
 */
export function optimizeDailyProteinBalance<TPayload = unknown>(
  input: DailyProteinBalanceInput<TPayload>,
): DailyProteinBalanceResult<TPayload> {
  assertInput(input);
  const beamWidth = Math.max(1, Math.floor(input.beamWidth ?? DEFAULT_BEAM_WIDTH));
  const candidateCap = Math.max(1, Math.floor(input.maxCandidatesPerPosition ?? DEFAULT_CANDIDATE_CAP));
  if (!Number.isFinite(beamWidth) || !Number.isFinite(candidateCap))
    throw new Error("Search limits must be finite positive numbers.");

  const candidateById = new Map<string, DailyMenuCandidate<TPayload>>();
  const duplicateCandidateIds = new Set<string>();
  for (const candidate of input.candidateGroups) {
    if (candidateById.has(candidate.id)) duplicateCandidateIds.add(candidate.id);
    else candidateById.set(candidate.id, candidate);
  }
  const invalidCandidates: DailyProteinBalanceResult<TPayload>["invalidCandidates"] = [];
  let searchExhausted = false;
  const optionsByPosition = new Map<string, DailyMenuCandidate<TPayload>[]>();

  for (const position of input.positions) {
    const seenIds = new Set<string>();
    const valid: DailyMenuCandidate<TPayload>[] = [];
    for (const candidateId of position.candidateIds) {
      const candidate = candidateById.get(candidateId);
      if (!candidate) {
        invalidCandidates.push({ positionId: position.id, candidateId, reason: "unknown-candidate-id" });
        continue;
      }
      const duplicate = duplicateCandidateIds.has(candidate.id) || seenIds.has(candidate.id);
      seenIds.add(candidate.id);
      const issue = duplicate ? "duplicate-candidate-id" : candidateIssue(candidate, position);
      if (issue) invalidCandidates.push({ positionId: position.id, candidateId: candidate.id, reason: issue });
      else valid.push(candidate);
    }
    const current = valid.find((candidate) => candidate.id === position.currentCandidateId);
    if (!current) throw new Error(`Current candidate ${position.currentCandidateId} for ${position.id} is unavailable or invalid.`);
    const ordered = valid.slice().sort(candidateOrder);
    const limited = position.locked
      ? [current]
      : [current, ...ordered.filter((candidate) => candidate.id !== current.id).slice(0, Math.max(0, candidateCap - 1))];
    if (!position.locked && valid.length > limited.length) searchExhausted = true;
    optionsByPosition.set(position.id, limited);
  }

  let baselineTotals = emptyTotals(input.people);
  const baselineCandidates: DailyMenuCandidate<TPayload>[] = [];
  for (const position of input.positions) {
    const candidate = optionsByPosition.get(position.id)!.find((option) => option.id === position.currentCandidateId)!;
    baselineTotals = totalsWithCandidate(baselineTotals, candidate, input.people);
    baselineCandidates.push(candidate);
  }
  const baselineWithinCalorieCeiling = withinCeilings(baselineTotals, input.people);

  let beam: SearchPlan<TPayload>[] = [{ candidates: [], totals: emptyTotals(input.people), rank: 0, cost: 0, stableKey: "" }];
  for (const position of input.positions) {
    const next: SearchPlan<TPayload>[] = [];
    for (const plan of beam) for (const candidate of optionsByPosition.get(position.id)!) {
      const totals = totalsWithCandidate(plan.totals, candidate, input.people);
      if (!withinCeilings(totals, input.people)) continue;
      next.push({
        candidates: [...plan.candidates, candidate],
        totals,
        rank: plan.rank + (candidate.rank ?? 0),
        cost: plan.cost + (candidate.cost ?? 0),
        stableKey: plan.stableKey ? `${plan.stableKey}\u0000${candidate.id}` : candidate.id,
      });
    }
    next.sort((left, right) => comparePlans(left, right, input.people));
    if (next.length > beamWidth) searchExhausted = true;
    beam = next.slice(0, beamWidth);
  }

  const proteinSafe = beam.filter((plan) => doesNotWorsen(plan.totals, baselineTotals, input.people));
  proteinSafe.sort((left, right) => comparePlans(left, right, input.people));
  const proteinImprovement = proteinSafe.find((plan) =>
    shortfallSum(plan.totals, input.people) < shortfallSum(baselineTotals, input.people),
  );
  let selected: Pick<SearchPlan<TPayload>, "candidates" | "totals"> = { candidates: baselineCandidates, totals: baselineTotals };
  if (baselineWithinCalorieCeiling) {
    if (proteinImprovement) selected = proteinImprovement;
  } else if (proteinSafe.length) {
    // Returning within the hard calorie ceiling comes first. A no-worse-protein
    // option is preferred whenever one exists.
    selected = proteinSafe[0];
  } else if (beam.length) {
    // No strict-calorie plan preserves every shortfall. Recover calorie
    // feasibility while minimizing the largest individual protein regression,
    // then the combined regression; surplus for one person is never a credit.
    const recovery = beam.slice().sort((left, right) =>
      compareCalorieRecoveryPlans(left, right, baselineTotals, input.people),
    )[0];
    selected = recovery;
  }
  const proposalWithinCalorieCeiling = withinCeilings(selected.totals, input.people);
  const proteinShortfallsNonworsening = doesNotWorsen(selected.totals, baselineTotals, input.people);
  const improved = !baselineWithinCalorieCeiling
    ? proposalWithinCalorieCeiling && selected.candidates.some((candidate, index) => candidate.id !== baselineCandidates[index].id)
    : shortfallSum(selected.totals, input.people) < shortfallSum(baselineTotals, input.people);
  const selectionByPosition: Record<string, string> = {};
  const selectedCandidatesByPosition: Record<string, DailyMenuCandidate<TPayload>> = {};
  input.positions.forEach((position, index) => {
    selectionByPosition[position.id] = selected.candidates[index].id;
    selectedCandidatesByPosition[position.id] = selected.candidates[index];
  });
  const before = describeTotals(baselineTotals, input.people);
  const after = describeTotals(selected.totals, input.people);
  return {
    objective: { proteinTargetScope: input.proteinTargetScope ?? "daily", kind: "calorie-feasible-personal-shortfalls" },
    improved,
    searchExhausted,
    feasibility: {
      baselineWithinCalorieCeiling,
      proposalWithinCalorieCeiling,
      feasiblePlanFound: beam.length > 0,
      proteinShortfallsNonworsening,
    },
    goalReached: proposalWithinCalorieCeiling && input.people.every((person) => after[person.id].proteinShortfall === 0),
    changedPositionIds: input.positions.filter((position) => selectionByPosition[position.id] !== position.currentCandidateId).map((position) => position.id),
    selectionByPosition,
    selectedCandidatesByPosition,
    before,
    after,
    invalidCandidates,
  };
}
