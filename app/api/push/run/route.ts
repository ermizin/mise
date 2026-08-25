import { env } from "cloudflare:workers";
import { processDueNotifications } from "../../../../lib/push-server";

type CronEnv = { PUSH_CRON_SECRET?: string };

export async function POST(request: Request) {
  const secret = (env as unknown as CronEnv).PUSH_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await processDueNotifications());
}
