import { env } from "cloudflare:workers";
import { analyticsOwnerId } from "./analytics-owner";
import { buildAnalyticsDashboard, type DashboardOptions, type FirstSeen } from "./analytics-dashboard";
import type { AnalyticsEventRow } from "./analytics";
import catalog from "../data/recipe-runtime-catalog.json";

export class AnalyticsCapacityError extends Error {}
export async function loadAnalyticsDashboard(options: DashboardOptions, now = Date.now()) {
  const ownerId = analyticsOwnerId();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sites:${ownerId}`));
  const ownerActor = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
  const start = options.start - (options.end - options.start);
  const conditions = "recorded_at >= ? AND recorded_at < ? AND (? = 'all' OR actor_kind = ?) AND (? = 0 OR actor_id <> ?)";
  const args = [start, now, options.actorKind, options.actorKind, Number(options.excludeOwner), ownerActor];
  const [events, identities] = await env.DB.batch([
    env.DB.prepare(`SELECT event_id AS eventId, actor_id AS actorId, actor_kind AS actorKind,
      event_name AS eventName, flow_id AS flowId, duration_ms AS durationMs, error_code AS errorCode,
      pilot_eligible AS pilotEligible, from_section AS "from", to_section AS "to", step, recipe_id AS recipeId,
      occurred_at AS occurredAt, recorded_at AS recordedAt
      FROM analytics_events WHERE ${conditions} ORDER BY recorded_at, event_id LIMIT 50001`).bind(...args),
    env.DB.prepare(`SELECT actor_id AS actorId, actor_kind AS actorKind, MIN(recorded_at) AS firstSeenAt
      FROM analytics_events WHERE actor_id IN (SELECT DISTINCT actor_id FROM analytics_events WHERE ${conditions})
      GROUP BY actor_id, actor_kind LIMIT 20001`).bind(...args),
  ]);
  if (events.results.length > 50000 || identities.results.length > 20000)
    throw new AnalyticsCapacityError("За период слишком много событий. Сократите период: отчёт не будет показывать усечённые цифры.");
  const rows = events.results.map((raw: Record<string, unknown>) => Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null)) as AnalyticsEventRow);
  const result = buildAnalyticsDashboard(rows, identities.results as FirstSeen[], options, now, ownerActor);
  const titles = new Map(catalog.recipes.map((r) => [r.id, r.title]));
  return { ...result, recipes: result.recipes.map((r) => ({ ...r, title: titles.get(r.id) ?? r.id })) };
}
export type DashboardReport = Awaited<ReturnType<typeof loadAnalyticsDashboard>>;
