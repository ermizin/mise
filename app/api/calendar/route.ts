import { buildPlanCalendar, parsePlanCalendarQuery } from "../../../lib/plan-calendar";

const publicOrigin = "https://mise.ermizinm.ru";

export function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parsePlanCalendarQuery(url.searchParams);
  if ("error" in parsed)
    return Response.json({ error: parsed.error }, { status: 400 });
  const calendar = buildPlanCalendar(parsed.input, {
    origin: url.protocol === "https:" ? url.origin : publicOrigin,
    now: Date.now(),
  });
  return new Response(calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="mise-plan.ics"',
      "Cache-Control": "no-store",
    },
  });
}
