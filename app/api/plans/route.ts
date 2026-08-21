import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { mealPlans } from "../../../db/schema";

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
    const body = (await request.json()) as { plan?: { id?: string } };
    if (!body.plan?.id || typeof body.plan.id !== "string") {
      return Response.json({ error: "plan.id is required" }, { status: 400 });
    }

    const payload = JSON.stringify(body.plan);
    if (payload.length > 1_500_000) {
      return Response.json({ error: "plan is too large" }, { status: 413 });
    }

    const now = Date.now();
    await getDb().insert(mealPlans).values({
      id: `${clientId}:${body.plan.id}`,
      clientId,
      payload,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: mealPlans.id,
      set: { payload, updatedAt: now },
    });

    return Response.json({ saved: true, plan: body.plan });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}
