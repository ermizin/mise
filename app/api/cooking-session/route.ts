import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { cookingSessions, mealPlans } from "../../../db/schema";
import {
  cookingSessionStorageId,
  type CookingGraphManifest,
  validateCookingSessionCreate,
  validateCookingSessionMutation,
} from "../../../lib/cooking-session-store";
import {
  cookingDishContext,
  cookingPlanSnapshotSignature,
  plannedCookingDishes,
} from "../../../lib/cooking-session-context";
import { applyCookingEvent, initialCookingExecution } from "../../../domain/cooking/replan";
import { scheduleCookingSession } from "../../../domain/cooking/schedule";
import { compileCookingSession } from "../../../domain/cooking/compile";
import { cookingSourceSignature } from "../../../domain/cooking/source";
import { cookingMutationReplay } from "../../../lib/cooking-session-protocol";
import { syncCookingStepNotifications, type CookingNotificationEnvelope } from "../../../lib/cooking-notifications";
import type { CookingExecutionState, CompiledSession } from "../../../domain/cooking/types";

type StoredSession = {
  id: string;
  signature: string;
  graph: string;
  payload: string;
  revision: number;
  planSnapshotSignature: string;
  lastMutationId: string | null;
};

function clientIdFor(request: Request) {
  const clientId = request.headers.get("x-mise-client") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientId) ? clientId : null;
}

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return message.includes("no such table") || message.includes("cooking_sessions")
    ? "Хранилище готовки ещё не подготовлено."
    : message;
}

function jsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function responseFor(row: StoredSession) {
  const session = jsonRecord(row.payload);
  return session ? { session, revision: row.revision, signature: row.signature, planSnapshotSignature: row.planSnapshotSignature } : null;
}

function submittedDishes(session: Record<string, unknown>) {
  const input = session.input;
  if (!input || typeof input !== "object" || !Array.isArray((input as { recipes?: unknown }).recipes)) return null;
  const raw = (input as { recipes: unknown[] }).recipes;
  const dishes = raw.flatMap((recipe) => {
    const dish = cookingDishContext(recipe);
    return dish ? [dish] : [];
  });
  return dishes.length === raw.length ? dishes : null;
}

function sameDishes(expected: NonNullable<ReturnType<typeof plannedCookingDishes>>, submitted: NonNullable<ReturnType<typeof submittedDishes>>) {
  if (expected.length !== submitted.length) return false;
  const received = new Map(submitted.map((dish) => [dish.dishKey, dish]));
  return received.size === submitted.length && expected.every((dish) => {
    const actual = received.get(dish.dishKey);
    return actual && actual.recipeId === dish.recipeId && actual.methodId === dish.methodId &&
      actual.personIds.length === dish.personIds.length && actual.personIds.every((id, index) => id === dish.personIds[index]);
  });
}

function planContainsBatch(plan: Record<string, unknown>, batchId: string) {
  return Array.isArray(plan.batches) && plan.batches.some((batch) =>
    batch && typeof batch === "object" && (batch as { id?: unknown }).id === batchId,
  );
}

async function ownedPlan(clientId: string, planId: string, batchId: string) {
  const [row] = await getDb().select({ payload: mealPlans.payload }).from(mealPlans).where(and(
    eq(mealPlans.id, `${clientId}:${planId}`),
    eq(mealPlans.clientId, clientId),
  )).limit(1);
  const plan = row ? jsonRecord(row.payload) : null;
  return plan && planContainsBatch(plan, batchId) ? plan : null;
}

async function storedSession(clientId: string, planId: string, batchId: string) {
  const id = cookingSessionStorageId(clientId, planId, batchId);
  const [row] = await getDb().select().from(cookingSessions).where(and(
    eq(cookingSessions.id, id),
    eq(cookingSessions.clientId, clientId),
  )).limit(1);
  return row as StoredSession | undefined;
}

async function bodyFor(request: Request) {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 320_000) return null;
  try {
    const text = await request.text();
    return text.length <= 320_000 ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId") ?? "";
  const batchId = url.searchParams.get("batchId") ?? "";
  if (!/^[A-Za-z0-9:_-]{1,120}$/u.test(planId) || !/^[A-Za-z0-9:_-]{1,120}$/u.test(batchId))
    return Response.json({ error: "planId and batchId are required" }, { status: 400 });
  try {
    if (!await ownedPlan(clientId, planId, batchId)) return Response.json({ error: "plan or batch not found" }, { status: 404 });
    const row = await storedSession(clientId, planId, batchId);
    const state = row && responseFor(row);
    return Response.json(state ?? { session: null, revision: null });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

/** Creates a graph-bound session. It cannot replace an active session for a different source signature. */
export async function PUT(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  const create = validateCookingSessionCreate(await bodyFor(request));
  if (!create) return Response.json({ error: "invalid cooking session" }, { status: 400 });
  try {
    const plan = await ownedPlan(clientId, create.planId, create.batchId);
    if (!plan) return Response.json({ error: "plan or batch not found" }, { status: 404 });
    const expectedDishes = plannedCookingDishes(plan, create.batchId);
    const dishes = submittedDishes(create.session);
    if (!expectedDishes || !dishes || !sameDishes(expectedDishes, dishes) ||
      create.graph.recipeIds.length !== new Set(dishes.map((dish) => dish.recipeId)).size ||
      create.graph.recipeIds.some((id) => !dishes.some((dish) => dish.recipeId === id)) ||
      create.planSnapshotSignature !== cookingPlanSnapshotSignature(plan, create.batchId, dishes))
      return Response.json({ error: "session graph does not match this plan batch" }, { status: 422 });
    const id = cookingSessionStorageId(clientId, create.planId, create.batchId);
    const existing = await storedSession(clientId, create.planId, create.batchId);
    if (existing) {
      const current = responseFor(existing);
      if (!current) return Response.json({ error: "stored cooking session is invalid" }, { status: 500 });
      if (existing.signature !== create.signature || existing.planSnapshotSignature !== create.planSnapshotSignature) return Response.json({ error: "cooking session source changed", current }, { status: 409 });
      return Response.json(current);
    }
    const envelope = create.session as { input?: unknown };
    if (!envelope.input || typeof envelope.input !== "object")
      return Response.json({ error: "cooking session is missing its input" }, { status: 400 });
    // The server compiles from the submitted input; client compiled/schedule
    // fields are never trusted as authority for persisted graph execution.
    const compiled = compileCookingSession(envelope.input as never);
    if (compiled.diagnostics.length || compiled.id !== create.sessionId)
      return Response.json({ error: "cooking session input cannot be compiled" }, { status: 422 });
    const serverGraph = { operationIds: compiled.operations.map((operation) => operation.id), recipeIds: [...new Set(compiled.input.recipes.map((recipe) => recipe.recipeId))] };
    if (JSON.stringify(serverGraph.operationIds) !== JSON.stringify(create.graph.operationIds) || JSON.stringify(serverGraph.recipeIds) !== JSON.stringify(create.graph.recipeIds))
      return Response.json({ error: "submitted graph differs from server compilation" }, { status: 422 });
    const schedule = scheduleCookingSession(compiled);
    if (schedule.diagnostics.some(item => item.code !== "optimized_schedule_unavailable") || !schedule.entries.length || await cookingSourceSignature(compiled.input) !== create.signature)
      return Response.json({ error: "source or schedule validation failed" }, { status: 422 });
    const initialSession = {
      ...create.session, compiled,
      execution: initialCookingExecution(compiled),
      schedule,
    };
    const now = Date.now();
    await getDb().insert(cookingSessions).values({
      id,
      clientId,
      planId: create.planId,
      batchId: create.batchId,
      signature: create.signature,
      planSnapshotSignature: create.planSnapshotSignature,
      graph: JSON.stringify(create.graph),
      payload: JSON.stringify(initialSession),
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ session: initialSession, revision: 0, signature: create.signature, planSnapshotSignature: create.planSnapshotSignature }, { status: 201 });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

/** Applies one execution event with CAS. Replays return the latest state containing that exact event. */
export async function POST(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  const mutation = validateCookingSessionMutation(await bodyFor(request));
  if (!mutation) return Response.json({ error: "invalid cooking session event" }, { status: 400 });
  try {
    const currentPlan = await ownedPlan(clientId, mutation.planId, mutation.batchId);
    if (!currentPlan) return Response.json({ error: "plan or batch not found" }, { status: 404 });
    const row = await storedSession(clientId, mutation.planId, mutation.batchId);
    if (!row) return Response.json({ error: "cooking session not found" }, { status: 404 });
    const current = responseFor(row);
    const graph = jsonRecord(row.graph) as CookingGraphManifest | null;
    if (!current || !graph || !Array.isArray(graph.operationIds) || !Array.isArray(graph.recipeIds))
      return Response.json({ error: "stored cooking session is invalid" }, { status: 500 });
    const currentExecution = current.session.execution as CookingExecutionState | undefined;
    const event = { ...mutation.event, id: mutation.mutationId };
    if (!currentExecution || !Array.isArray(currentExecution.events))
      return Response.json({ error: "stored execution is invalid" }, { status: 500 });
    const replay = cookingMutationReplay(currentExecution, event);
    if (replay === "conflict") return Response.json({ error: "mutation id was used for a different action", current }, { status: 409 });
    if (replay === "accepted") {
      await syncCookingStepNotifications(clientId, mutation.planId, mutation.batchId, current.session as CookingNotificationEnvelope);
      return Response.json(current);
    }
    if (currentExecution.events.length >= 1000)
      return Response.json({ error: "cooking event limit reached", current }, { status: 422 });
    const currentDishes = submittedDishes(current.session);
    if (!currentDishes || cookingPlanSnapshotSignature(currentPlan, mutation.batchId, currentDishes) !== row.planSnapshotSignature)
      return Response.json({ error: "cooking session source changed", current }, { status: 409 });
    const compiled = current.session.compiled;
    if (!compiled || typeof compiled !== "object" || (compiled as { id?: unknown }).id !== mutation.sessionId)
      return Response.json({ error: "cooking session does not match this request" }, { status: 409 });
    if (row.revision !== mutation.expectedRevision) return Response.json({ error: "cooking session changed", current }, { status: 409 });
    const envelope = current.session as { compiled?: unknown; execution?: unknown };
    if (!envelope.compiled || !envelope.execution || typeof envelope.compiled !== "object" || typeof envelope.execution !== "object")
      return Response.json({ error: "stored cooking session is invalid" }, { status: 500 });
    const applied = applyCookingEvent(envelope.compiled as never, envelope.execution as never, {
      ...mutation.event, id: mutation.mutationId,
    });
    if (applied.diagnostics.length) return Response.json({ error: "event is not valid for this cooking graph", diagnostics: applied.diagnostics }, { status: 422 });
    const nextSession = { ...current.session, execution: applied.execution, schedule: applied.schedule };
    const next = { session: nextSession, revision: row.revision + 1, signature: row.signature, planSnapshotSignature: row.planSnapshotSignature };
    const now = Date.now();
    const result = await getDb().update(cookingSessions).set({
      payload: JSON.stringify(nextSession),
      revision: next.revision,
      lastMutationId: mutation.mutationId,
      updatedAt: now,
    }).where(and(eq(cookingSessions.id, row.id), eq(cookingSessions.revision, mutation.expectedRevision)));
    if ((result.meta.changes ?? 0) !== 1) {
      const newest = await storedSession(clientId, mutation.planId, mutation.batchId);
      return Response.json({ error: "cooking session changed", current: newest ? responseFor(newest) : null }, { status: 409 });
    }
    // If notification creation fails after CAS, the client retries this same event.
    // The accepted-event branch repairs the job without applying the action twice.
    await syncCookingStepNotifications(clientId, mutation.planId, mutation.batchId, { compiled: envelope.compiled as CompiledSession, execution: applied.execution });
    return Response.json(next);
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}
