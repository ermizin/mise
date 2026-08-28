import { pilotSummaryCsv } from "../../../../lib/analytics";
import { isAnalyticsOwner } from "../../../../lib/analytics-owner";
import { loadPilotSummary } from "../../../../lib/pilot-report";

export async function GET(request: Request) {
  if (
    !isAnalyticsOwner(request.headers.get("oai-authenticated-user-id"))
  ) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  const summary = await loadPilotSummary();
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    return new Response(`\uFEFF${pilotSummaryCsv(summary)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mise-pilot-${new Date(summary.generatedAt).toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(summary, {
    headers: { "cache-control": "no-store" },
  });
}
