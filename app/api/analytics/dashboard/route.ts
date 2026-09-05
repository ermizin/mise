import { isAnalyticsOwner } from "../../../../lib/analytics-owner";
import { dashboardCsv, parseDashboardOptions } from "../../../../lib/analytics-dashboard";
import { AnalyticsCapacityError, loadAnalyticsDashboard } from "../../../../lib/analytics-dashboard-report";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store", "vary": "oai-authenticated-user-id" };
  if (!isAnalyticsOwner(request.headers.get("oai-authenticated-user-id")))
    return Response.json({ error: "owner access required" }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const now = Date.now();
  let options;
  try { options = parseDashboardOptions(params, now); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try {
    const report = await loadAnalyticsDashboard(options, now);
    if (params.get("format") === "csv") return new Response(`\uFEFF${dashboardCsv(report)}`, {
      headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="mise-analytics.csv"' },
    });
    return Response.json(report, { headers });
  } catch (error) {
    if (error instanceof AnalyticsCapacityError) return Response.json({ error: error.message }, { status: 422, headers });
    console.error("Mise analytics dashboard unavailable");
    return Response.json({ error: "Не удалось загрузить аналитику. Попробуйте обновить отчёт позже." }, { status: 503, headers });
  }
}
