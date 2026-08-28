export const analyticsEventNames = [
  "first_open",
  "onboarding_completed",
  "plan_create_started",
  "plan_created",
  "blocking_error",
  "shopping_opened",
  "shopping_item_checked",
  "cooking_instructions_opened",
  "cooking_confirmed",
  "reminders_enabled",
  "saved_plan_reopened",
  "next_plan_created",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];
export const analyticsErrorCodes = [
  "plan_load",
  "plan_save",
  "shopping_save",
  "reminder_enable",
] as const;
export type AnalyticsErrorCode = (typeof analyticsErrorCodes)[number];

export type AnalyticsEventInput = {
  eventId: string;
  eventName: AnalyticsEventName;
  flowId?: string;
  durationMs?: number;
  errorCode?: AnalyticsErrorCode;
  pilotEligible?: boolean;
  occurredAt?: number;
};

export type AnalyticsEventRow = AnalyticsEventInput & {
  actorId: string;
  actorKind: "sites" | "device";
  recordedAt: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inputKeys = new Set([
  "eventId",
  "eventName",
  "flowId",
  "durationMs",
  "errorCode",
  "pilotEligible",
  "occurredAt",
]);

export function parseAnalyticsEvent(
  value: unknown,
  now = Date.now(),
): { event: AnalyticsEventInput } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { error: "event must be an object" };
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !inputKeys.has(key)))
    return { error: "event contains unsupported fields" };
  if (typeof raw.eventId !== "string" || !uuidPattern.test(raw.eventId))
    return { error: "eventId must be a UUID" };
  if (
    typeof raw.eventName !== "string" ||
    !analyticsEventNames.includes(raw.eventName as AnalyticsEventName)
  )
    return { error: "eventName is not allowed" };
  if (
    raw.flowId !== undefined &&
    (typeof raw.flowId !== "string" || !uuidPattern.test(raw.flowId))
  )
    return { error: "flowId must be a UUID" };
  if (
    raw.durationMs !== undefined &&
    (!Number.isInteger(raw.durationMs) ||
      (raw.durationMs as number) < 0 ||
      (raw.durationMs as number) > 86_400_000)
  )
    return { error: "durationMs is out of range" };
  if (
    raw.errorCode !== undefined &&
    (typeof raw.errorCode !== "string" ||
      !analyticsErrorCodes.includes(raw.errorCode as AnalyticsErrorCode))
  )
    return { error: "errorCode is not allowed" };
  if (
    raw.pilotEligible !== undefined &&
    typeof raw.pilotEligible !== "boolean"
  )
    return { error: "pilotEligible must be boolean" };
  if (
    raw.occurredAt !== undefined &&
    (!Number.isInteger(raw.occurredAt) ||
      (raw.occurredAt as number) < now - 7 * 86_400_000 ||
      (raw.occurredAt as number) > now + 5 * 60_000)
  )
    return { error: "occurredAt is out of range" };

  const eventName = raw.eventName as AnalyticsEventName;
  if (
    ["plan_create_started", "plan_created", "next_plan_created"].includes(
      eventName,
    ) &&
    raw.flowId === undefined
  )
    return { error: "flowId is required for plan events" };
  if (
    eventName === "plan_created" &&
    (raw.durationMs === undefined || raw.pilotEligible === undefined)
  )
    return {
      error: "durationMs and pilotEligible are required for plan_created",
    };
  if (
    eventName !== "plan_created" &&
    (raw.durationMs !== undefined || raw.pilotEligible !== undefined)
  )
    return { error: "plan result fields are only allowed for plan_created" };
  if (eventName === "blocking_error" && raw.errorCode === undefined)
    return { error: "errorCode is required for blocking_error" };
  if (eventName !== "blocking_error" && raw.errorCode !== undefined)
    return { error: "errorCode is only allowed for blocking_error" };

  return {
    event: {
      eventId: raw.eventId,
      eventName,
      ...(raw.flowId ? { flowId: raw.flowId } : {}),
      ...(raw.durationMs !== undefined
        ? { durationMs: raw.durationMs as number }
        : {}),
      ...(raw.errorCode
        ? { errorCode: raw.errorCode as AnalyticsErrorCode }
        : {}),
      ...(raw.pilotEligible !== undefined
        ? { pilotEligible: raw.pilotEligible as boolean }
        : {}),
      ...(raw.occurredAt !== undefined
        ? { occurredAt: raw.occurredAt as number }
        : {}),
    },
  };
}

export type PilotParticipant = {
  label: string;
  firstSeenAt: number | null;
  onboardingCompleted: boolean;
  firstEligiblePlanDurationMs: number | null;
  createdPlanUnderTenMinutes: boolean;
  blockingErrors: number;
  shoppingOpened: boolean;
  shoppingConfirmed: boolean;
  cookingInstructionsOpened: boolean;
  cookingConfirmed: boolean;
  completedPurchaseAndCooking: boolean;
  remindersEnabled: boolean;
  savedPlanReopened: boolean;
  nextPlanCreated: boolean;
};

export type PilotSummary = {
  generatedAt: number;
  observedParticipants: number;
  expectedParticipants: 5;
  extraParticipantsExcluded: number;
  planUnderTenMinutes: number;
  purchaseAndCooking: number;
  returnedAndCreatedNextPlan: number;
  thresholds: { plan: boolean; action: boolean; return: boolean };
  participants: PilotParticipant[];
};

export function buildPilotSummary(
  rows: AnalyticsEventRow[],
  now = Date.now(),
): PilotSummary {
  const ordered = [...rows].sort(
    (a, b) =>
      a.recordedAt - b.recordedAt || a.eventId.localeCompare(b.eventId),
  );
  const actorIds = [...new Set(ordered.map((row) => row.actorId))];
  const includedActorIds = actorIds.slice(0, 5);
  const participants = Array.from(
    { length: 5 },
    (_, index): PilotParticipant => {
      const actorId = includedActorIds[index];
      if (!actorId) return emptyParticipant(index + 1);
      const events = ordered.filter((row) => row.actorId === actorId);
      const has = (name: AnalyticsEventName) =>
        events.some((row) => row.eventName === name);
      const eligiblePlans = events.filter(
        (row) =>
          row.eventName === "plan_created" &&
          row.pilotEligible &&
          row.durationMs !== undefined,
      );
      const duration = eligiblePlans[0]?.durationMs ?? null;
      const shoppingConfirmed = has("shopping_item_checked");
      const cookingConfirmed = has("cooking_confirmed");
      return {
        label: `Участник ${index + 1}`,
        firstSeenAt: events[0]?.recordedAt ?? null,
        onboardingCompleted: has("onboarding_completed"),
        firstEligiblePlanDurationMs: duration,
        createdPlanUnderTenMinutes: duration !== null && duration <= 600_000,
        blockingErrors: events.filter(
          (row) => row.eventName === "blocking_error",
        ).length,
        shoppingOpened: has("shopping_opened"),
        shoppingConfirmed,
        cookingInstructionsOpened: has("cooking_instructions_opened"),
        cookingConfirmed,
        completedPurchaseAndCooking: shoppingConfirmed && cookingConfirmed,
        remindersEnabled: has("reminders_enabled"),
        savedPlanReopened: has("saved_plan_reopened"),
        nextPlanCreated: has("next_plan_created"),
      };
    },
  );
  const planUnderTenMinutes = participants.filter(
    (item) => item.createdPlanUnderTenMinutes,
  ).length;
  const purchaseAndCooking = participants.filter(
    (item) => item.completedPurchaseAndCooking,
  ).length;
  const returnedAndCreatedNextPlan = participants.filter(
    (item) => item.nextPlanCreated,
  ).length;
  return {
    generatedAt: now,
    observedParticipants: includedActorIds.length,
    expectedParticipants: 5,
    extraParticipantsExcluded: Math.max(0, actorIds.length - 5),
    planUnderTenMinutes,
    purchaseAndCooking,
    returnedAndCreatedNextPlan,
    thresholds: {
      plan: planUnderTenMinutes >= 4,
      action: purchaseAndCooking >= 3,
      return: returnedAndCreatedNextPlan >= 3,
    },
    participants,
  };
}

function emptyParticipant(index: number): PilotParticipant {
  return {
    label: `Участник ${index}`,
    firstSeenAt: null,
    onboardingCompleted: false,
    firstEligiblePlanDurationMs: null,
    createdPlanUnderTenMinutes: false,
    blockingErrors: 0,
    shoppingOpened: false,
    shoppingConfirmed: false,
    cookingInstructionsOpened: false,
    cookingConfirmed: false,
    completedPurchaseAndCooking: false,
    remindersEnabled: false,
    savedPlanReopened: false,
    nextPlanCreated: false,
  };
}

export function pilotSummaryCsv(summary: PilotSummary): string {
  const columns = [
    "participant",
    "first_seen",
    "onboarding",
    "eligible_plan_minutes",
    "plan_under_10m",
    "blocking_errors",
    "shopping_opened",
    "purchase_confirmed",
    "instructions_opened",
    "cooking_confirmed",
    "purchase_and_cooking",
    "reminders_enabled",
    "saved_plan_reopened",
    "next_plan_created",
  ];
  const rows = summary.participants.map((item) => [
    item.label,
    item.firstSeenAt ? new Date(item.firstSeenAt).toISOString() : "",
    item.onboardingCompleted,
    item.firstEligiblePlanDurationMs === null
      ? ""
      : Math.round(item.firstEligiblePlanDurationMs / 600) / 100,
    item.createdPlanUnderTenMinutes,
    item.blockingErrors,
    item.shoppingOpened,
    item.shoppingConfirmed,
    item.cookingInstructionsOpened,
    item.cookingConfirmed,
    item.completedPurchaseAndCooking,
    item.remindersEnabled,
    item.savedPlanReopened,
    item.nextPlanCreated,
  ]);
  return [columns, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value: string | number | boolean) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
