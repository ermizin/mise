import { asc } from "drizzle-orm";
import { getDb } from "../db";
import { analyticsEvents } from "../db/schema";
import { buildPilotSummary, type AnalyticsEventRow } from "./analytics";

export async function loadPilotSummary() {
  const rows = await getDb()
    .select()
    .from(analyticsEvents)
    .orderBy(asc(analyticsEvents.recordedAt))
    .limit(10_000);
  return buildPilotSummary(
    rows.map(
      (row): AnalyticsEventRow => ({
        eventId: row.eventId,
        actorId: row.actorId,
        actorKind: row.actorKind === "sites" ? "sites" : "device",
        eventName: row.eventName as AnalyticsEventRow["eventName"],
        ...(row.flowId ? { flowId: row.flowId } : {}),
        ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
        ...(row.errorCode
          ? {
              errorCode: row.errorCode as AnalyticsEventRow["errorCode"],
            }
          : {}),
        ...(row.pilotEligible !== null
          ? { pilotEligible: row.pilotEligible }
          : {}),
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
      }),
    ),
  );
}
