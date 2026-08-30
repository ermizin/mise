import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { mealPlans, pushJobs, pushPreferences, pushSubscriptions } from "../../../db/schema";
import { validatePlanForPersistence } from "../../../lib/plan-validation";

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (message.includes("no such table") || message.includes("meal_plans")) {
    return "Хранилище планов ещё не подготовлено.";
  }
  return message;
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
  try {
    let body: { plan?: unknown };
    try {
      body = (await request.json()) as { plan?: unknown };
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    const validation = validatePlanForPersistence(body.plan);
    if (!validation.valid) return Response.json({ error: validation.error }, { status: validation.status });
    const plan = body.plan as { id: string };

    const payload = JSON.stringify(plan);
    if (payload.length > 1_500_000) {
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
