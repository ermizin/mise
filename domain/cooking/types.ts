export type ResourceKind = "cook" | "burner" | "pot" | "pan" | "oven" | "tray" | "baking_dish" | "board" | "knife" | "sink" | "blender" | "microwave" | "multicooker" | "air_fryer" | "waffle_iron" | "pressure_cooker" | "fridge" | "bowl";
export type OperationKind = "instruction" | "prep" | "start_heat" | "heat" | "intervention" | "unload" | "wash" | "portion" | "store";
export type OperationStatus = "pending" | "active" | "needs_check" | "completed" | "blocked";

export type CookingAmount = { amount: number; unit: string; canonicalId: string; state?: string; cut?: string; allergenGroup?: string };
export type QuantityAllocation = CookingAmount & { ingredientId: string; recipeId: string; dishKey: string; state: string };
export type ResourceUse = { resourceId: string; kind: ResourceKind };
export type CookingOperation = {
  id: string; recipeId: string; methodId: string; dishKey?: string; kind: OperationKind; title: string;
  sourceText?: string; sourceOperationIds?: string[]; dependsOn: string[]; durationSeconds: number;
  estimatedActive?: boolean; attention: "required" | "background"; resources: ResourceUse[];
  resourceHolds?: (ResourceUse & { releaseAfterOpId: string })[]; checkDeadlineSeconds?: number;
  allocations: QuantityAllocation[]; rawMeat?: boolean; unknownDuration?: boolean; timeInputBeforeCreate?: boolean; requiresCheckAtEnd?: boolean; sourceStepIndexes: number[];
};
export type KitchenResource = { id: string; kind: ResourceKind; capacity?: number; capacityUnit?: string; capacities?: Record<string, number> };
export type SelectedCookingRecipe = {
  dishKey: string; recipeId: string; methodId: string; personIds: string[];
  cookingAmounts: Record<string, CookingAmount>; sourceStepsChecksum: string;
};
export type GuidedActionConfig = { durationSeconds: number; resourceIds: string[]; allBatchFits: true };
/**
 * Generic source actions are always hands-on at this explicit pace.  An entry
 * in `actions` is an opt-in promotion of a source-marked background candidate.
 */
export type GuidedCookingConfig = { schemaVersion: 1; activeStepSeconds: number; actions: Record<string, GuidedActionConfig> };
export type CookingSessionInput = {
  sessionId: string; planId: string; recipes: SelectedCookingRecipe[];
  kitchen: { resources: KitchenResource[]; ovenCompatibility?: { resourceIds: string[]; reviewedKey: string }[] };
  durationOverrides?: Record<string, number>;
  guidedConfig?: GuidedCookingConfig;
  pace: "speed" | "comfortable";
};
export type CompileDiagnostic = { code: string; message: string; recipeId?: string };
export type CompiledSession = { id: string; input: CookingSessionInput; operations: CookingOperation[]; diagnostics: CompileDiagnostic[]; fallbackReason?: string };
export type ScheduleEntry = { opId: string; startAt: number; endAt: number };
export type CookingSchedule = { mode: "optimized" | "sequential"; entries: ScheduleEntry[]; baselineMakespan: number; optimizedMakespan: number; usedFallback: boolean; diagnostics: CompileDiagnostic[] };
export type CookingEvent = { id: string; type: "started" | "completed" | "needs_check" | "extended" | "paused" | "resumed" | "suspended" | "continued"; opId?: string; occurredAt: number; endsAt?: number };
export type CookingExecutionState = { revision: number; statusByOperation: Record<string, OperationStatus>; events: CookingEvent[]; startedAtByOperation?: Record<string, number>; endsAtByOperation?: Record<string, number>; pausedAt?: number; remainingSecondsByOperation?: Record<string, number> };
export type ReplanResult = { execution: CookingExecutionState; schedule: CookingSchedule; diagnostics: CompileDiagnostic[] };
