import { env } from "cloudflare:workers";

export function analyticsOwnerId() {
  return (
    env as unknown as { MISE_ANALYTICS_OWNER_ID?: string }
  ).MISE_ANALYTICS_OWNER_ID?.trim() ?? "";
}

export function isAnalyticsOwner(userId: string | null) {
  const ownerId = analyticsOwnerId();
  return Boolean(ownerId && userId && ownerId === userId);
}
