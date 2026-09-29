import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { mealPlans, pushJobs, pushPreferences, pushSubscriptions } from "../../../db/schema";
import {
  validatePlanForPersistence,
} from "../../../lib/plan-validation";
import { normalizeAutomaticNutritionTargets } from "../../../domain/nutrition";

const maximumPlanBytes = 1_500_000;

/**
 * The reason stays in the server log. A database message names tables,
 * columns and bound values, none of which belongs in a public response.
 */
function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("plans api failed:", message);
  if (message.includes("no such table") || message.includes("meal_plans")) {
    return "Хранилище планов ещё не подготовлено.";
  }
  return "Не удалось выполнить запрос. Попробуйте ещё раз.";
}

function declaredLength(request: Request) {
  const value = Number(request.headers.get("content-length"));
  return Number.isFinite(value) ? value : 0;
}

function clientIdFor(request: Request) {
  const clientId = request.headers.get("x-mise-client") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientId) ? clientId : null;
}

export async function GET(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  try {
    const [row] = await getDb().select().from(mealPlans).where(eq(mealPlans.clientId, clientId)).orderBy(desc(mealPlans.updatedAt)).limit(1);
    return Response.json({ plan: row ? JSON.parse(row.payload) : null });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  // `{"plan":…}` wraps the stored payload, so a declared size above the
  // limit cannot hold an acceptable plan and is not worth parsing.
  if (declaredLength(request) > maximumPlanBytes + 64) {
    return Response.json({ error: "plan is too large" }, { status: 413 });
  }
  try {
    let body: { plan?: unknown };
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as { plan?: unknown }) : {};
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    const normalizedPlan = normalizeAutomaticNutritionTargets(body.plan);
    const validation = validatePlanForPersistence(normalizedPlan);
    if (!validation.valid) return Response.json({ error: validation.error }, { status: validation.status });
    const plan = normalizedPlan as { id: string };

    const payload = JSON.stringify(plan);
    // Stored as UTF-8: Russian text takes two bytes per character, so the
    // string length alone would admit a row twice the intended size.
    if (new TextEncoder().encode(payload).length > maximumPlanBytes) {
      return Response.json({ error: "plan is too large" }, { status: 413 });
    }

    const now = Date.now();
    await getDb().insert(mealPlans).values({
      id: `${clientId}:${plan.id}`,
      clientId,
      payload,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: mealPlans.id,
      set: { payload, updatedAt: now },
    });

    return Response.json({ saved: true, plan });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const clientId = clientIdFor(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  try {
    const db = getDb();
    const plans = await db.select({ payload: mealPlans.payload }).from(mealPlans).where(eq(mealPlans.clientId, clientId));
    const planIds = plans.flatMap(({ payload }) => {
      try {
        const plan = JSON.parse(payload) as { id?: unknown };
        return typeof plan.id === "string" ? [plan.id] : [];
      } catch {
        return [];
      }
    });
    const subscriptions = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.clientId, clientId));

    // Remove reminders first. If this cleanup fails, the plan remains present
    // and DELETE can be retried safely; deleting the plan first would lose the
    // plan id needed to find and cancel orphaned push jobs on the next retry.
    for (const { id: subscriptionId } of subscriptions) {
      for (const planId of planIds) {
        await db.delete(pushJobs).where(and(eq(pushJobs.subscriptionId, subscriptionId), eq(pushJobs.planId, planId)));
        await db.delete(pushPreferences).where(and(eq(pushPreferences.subscriptionId, subscriptionId), eq(pushPreferences.planId, planId)));
      }
    }
    await db.delete(mealPlans).where(eq(mealPlans.clientId, clientId));
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}
