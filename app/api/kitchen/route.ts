import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { kitchens } from "../../../db/schema";
import { isKitchenProfile, kitchenEquipment } from "../../../domain/kitchen";

function owner(request: Request) {
  const value = request.headers.get("x-mise-client") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}
export async function GET(request: Request) {
  const clientId = owner(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  try {
    const [row] = await getDb().select().from(kitchens).where(eq(kitchens.clientId, clientId)).limit(1);
    return Response.json({ kitchen: row ? JSON.parse(row.payload) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось загрузить кухню. Попробуйте ещё раз." }, { status: 500 });
  }
}
export async function PATCH(request: Request) {
  const clientId = owner(request);
  if (!clientId) return Response.json({ error: "client id is required" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!isKitchenProfile(body) || JSON.stringify(body).length > 16_000) {
    return Response.json({ error: "Проверьте количество и название предметов." }, { status: 422 });
  }
  try {
    await getDb().insert(kitchens).values({ clientId, payload: JSON.stringify(body), updatedAt: Date.now() })
      .onConflictDoUpdate({ target: kitchens.clientId, set: { payload: JSON.stringify(body), updatedAt: Date.now() } });
    return Response.json({ kitchen: body, equipment: kitchenEquipment(body) });
  } catch {
    return Response.json({ error: "Не удалось сохранить кухню. Изменение отменено." }, { status: 500 });
  }
}
