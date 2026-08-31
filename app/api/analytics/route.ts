import { getDb } from "../../../db";
import { analyticsEvents } from "../../../db/schema";
import { parseAnalyticsEvent } from "../../../lib/analytics";

const deviceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function actorFor(request: Request) {
  const sitesUserId = request.headers
    .get("oai-authenticated-user-id")
    ?.trim();
  const deviceId = request.headers.get("x-mise-client")?.trim();
  if (
    sitesUserId &&
    sitesUserId.length <= 200 &&
    /^[a-z0-9_-]+$/i.test(sitesUserId)
  ) {
    return {
      actorId: await hashIdentifier(`sites:${sitesUserId}`),
      actorKind: "sites" as const,
    };
  }
  if (deviceId && deviceIdPattern.test(deviceId)) {
    return {
      actorId: await hashIdentifier(`device:${deviceId}`),
      actorKind: "device" as const,
    };
  }
  return null;
}

async function hashIdentifier(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 2_048)
    return Response.json({ error: "event is too large" }, { status: 413 });
  const actor = await actorFor(request);
  if (!actor)
    return Response.json(
      { error: "device identity is required" },
      { status: 400 },
    );

  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json(
      { error: "event body is unreadable" },
      { status: 400 },
    );
  }
  if (text.length > 2_048)
    return Response.json({ error: "event is too large" }, { status: 413 });

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "event body must be JSON" },
      { status: 400 },
    );
  }
  const parsed = parseAnalyticsEvent(value);
  if ("error" in parsed)
    return Response.json({ error: parsed.error }, { status: 400 });

  const now = Date.now();
  const result = await getDb()
    .insert(analyticsEvents)
    .values({
      eventId: parsed.event.eventId,
      ...actor,
      eventName: parsed.event.eventName,
      flowId: parsed.event.flowId ?? null,
      durationMs: parsed.event.durationMs ?? null,
      errorCode: parsed.event.errorCode ?? null,
      pilotEligible: parsed.event.pilotEligible ?? null,
      from: parsed.event.from ?? null,
      to: parsed.event.to ?? null,
      occurredAt: parsed.event.occurredAt ?? now,
      recordedAt: now,
    })
    .onConflictDoNothing({ target: analyticsEvents.eventId });

  return Response.json(
    { accepted: true, duplicate: (result.meta.changes ?? 0) === 0 },
    { status: 202 },
  );
}
