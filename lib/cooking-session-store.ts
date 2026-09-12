export const cookingSessionLimits = {
  sessionBytes: 300_000,
  operationCount: 300,
  eventCount: 1_000,
  eventAgeMs: 31 * 24 * 60 * 60 * 1_000,
} as const;

type RecordValue = Record<string, unknown>;

export type CookingGraphManifest = {
  operationIds: string[];
  recipeIds: string[];
};

export type CookingSessionCreate = {
  sessionId: string;
  planId: string;
  batchId: string;
  signature: string;
  planSnapshotSignature: string;
  graph: CookingGraphManifest;
  session: RecordValue;
};

export type CookingExecutionEvent = {
  type: "started" | "completed" | "needs_check" | "extended" | "paused" | "resumed" | "suspended" | "continued";
  opId?: string;
  occurredAt: number;
  /** Absolute anchor. It is persisted verbatim and never reconstructed from a relative duration. */
  endsAt?: number;
};

export type CookingSessionMutation = {
  sessionId: string;
  planId: string;
  batchId: string;
  expectedRevision: number;
  mutationId: string;
  event: CookingExecutionEvent;
};

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown, max = 120): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]+$/u.test(value) && value.length > 0 && value.length <= max;
}

function boundedJson(value: unknown, maximum: number = cookingSessionLimits.sessionBytes) {
  try {
    const json = JSON.stringify(value);
    return json.length <= maximum ? json : null;
  } catch {
    return null;
  }
}

function operationIdsFrom(session: RecordValue) {
  const direct = session.operations;
  const compiled = record(session.compiled) ? session.compiled.operations : undefined;
  const operations = Array.isArray(direct) ? direct : Array.isArray(compiled) ? compiled : [];
  return operations.flatMap((operation) => record(operation) && identifier(operation.id, 400) ? [operation.id] : []);
}

function recipeIdsFrom(session: RecordValue) {
  const input = record(session.input) ? session.input : session;
  return Array.isArray(input.recipes)
    ? input.recipes.flatMap((recipe) => record(recipe) && identifier(recipe.recipeId) ? [recipe.recipeId] : [])
    : [];
}

function sessionIdFrom(session: RecordValue) {
  const compiled = record(session.compiled) ? session.compiled : session;
  return identifier(compiled.id) ? compiled.id : null;
}

export function validateCookingSessionCreate(value: unknown): CookingSessionCreate | null {
  if (!record(value) || !identifier(value.sessionId) || !identifier(value.planId) || !identifier(value.batchId) || !identifier(value.signature, 240) || typeof value.planSnapshotSignature !== "string" || value.planSnapshotSignature.length < 2 || value.planSnapshotSignature.length > 100_000 || !record(value.session) || !record(value.graph)) return null;
  const operationIds = Array.isArray(value.graph.operationIds) && value.graph.operationIds.every((id) => identifier(id, 400))
    ? [...value.graph.operationIds] as string[] : null;
  const recipeIds = Array.isArray(value.graph.recipeIds) && value.graph.recipeIds.every((id) => identifier(id))
    ? [...value.graph.recipeIds] as string[] : null;
  if (!operationIds || !recipeIds || !operationIds.length || operationIds.length > cookingSessionLimits.operationCount || new Set(operationIds).size !== operationIds.length || new Set(recipeIds).size !== recipeIds.length) return null;
  if (sessionIdFrom(value.session) !== value.sessionId) return null;
  const actualOperations = operationIdsFrom(value.session);
  const actualRecipes = recipeIdsFrom(value.session);
  if (new Set(actualOperations).size !== actualOperations.length || new Set(actualOperations).size !== operationIds.length || actualOperations.some((id) => !operationIds.includes(id))) return null;
  if (new Set(actualRecipes).size !== recipeIds.length || actualRecipes.some((id) => !recipeIds.includes(id))) return null;
  const input = value.session.input;
  if (!record(input) || input.sessionId !== value.sessionId || input.planId !== value.planId ||
    !Array.isArray(input.recipes) || !input.recipes.length || input.recipes.length > 20 ||
    !record(input.kitchen) || !Array.isArray(input.kitchen.resources) || !input.kitchen.resources.length || input.kitchen.resources.length > 40 ||
    !["speed", "comfortable"].includes(input.pace as string) ||
    input.kitchen.resources.some(resource => !record(resource) || !identifier(resource.id) || typeof resource.kind !== "string" ||
      (resource.capacity !== undefined && (typeof resource.capacity !== "number" || !Number.isFinite(resource.capacity) || resource.capacity <= 0))) ||
    input.recipes.some(recipe => !record(recipe) || !identifier(recipe.dishKey, 240) || !identifier(recipe.recipeId) || !identifier(recipe.methodId) ||
      !Array.isArray(recipe.personIds) || !recipe.personIds.length || !recipe.personIds.every(id => identifier(id)) ||
      !record(recipe.cookingAmounts) || typeof recipe.sourceStepsChecksum !== "string")) return null;
  if (!boundedJson(value.session) || !boundedJson(value.graph, 20_000)) return null;
  return { sessionId: value.sessionId, planId: value.planId, batchId: value.batchId, signature: value.signature, planSnapshotSignature: value.planSnapshotSignature, graph: { operationIds, recipeIds }, session: value.session };
}

export function validateCookingSessionMutation(value: unknown): CookingSessionMutation | null {
  if (!record(value) || !identifier(value.sessionId) || !identifier(value.planId) || !identifier(value.batchId) || !identifier(value.mutationId, 160) || !Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || !record(value.event)) return null;
  const type = value.event.type;
  const opId = value.event.opId;
  const occurredAt = value.event.occurredAt;
  const endsAt = value.event.endsAt;
  if (!(["started", "completed", "needs_check", "extended", "paused", "resumed", "suspended", "continued"] as const).includes(type as never) || !Number.isFinite(occurredAt) || Math.abs(Date.now() - (occurredAt as number)) > cookingSessionLimits.eventAgeMs || (endsAt !== undefined && !Number.isFinite(endsAt))) return null;
  const operationEvent = type === "started" || type === "completed" || type === "needs_check" || type === "extended" || type === "suspended" || type === "continued";
  if (operationEvent !== (opId !== undefined) || (opId !== undefined && !identifier(opId, 400))) return null;
  return { sessionId: value.sessionId, planId: value.planId, batchId: value.batchId, expectedRevision: value.expectedRevision as number, mutationId: value.mutationId, event: { type: type as CookingExecutionEvent["type"], ...(typeof opId === "string" ? { opId } : {}), occurredAt: occurredAt as number, ...(endsAt === undefined ? {} : { endsAt: endsAt as number }) } };
}

export function cookingSessionStorageId(clientId: string, planId: string, batchId: string) {
  return `${clientId}:${planId}:${batchId}`;
}
