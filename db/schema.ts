import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mealPlans = sqliteTable("meal_plans", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_meal_plans_updated_at").on(table.updatedAt),
  index("idx_meal_plans_client_updated_at").on(table.clientId, table.updatedAt),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  deviceId: text("device_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_push_subscriptions_client_device").on(table.clientId, table.deviceId),
]);

export const pushPreferences = sqliteTable("push_preferences", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull(),
  planId: text("plan_id").notNull(),
  payload: text("payload").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_push_preferences_subscription_plan").on(table.subscriptionId, table.planId),
]);

export const pushJobs = sqliteTable("push_jobs", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull(),
  planId: text("plan_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull().default("/"),
  dueAt: integer("due_at").notNull(),
  sentAt: integer("sent_at"),
  leaseUntil: integer("lease_until"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_push_jobs_due_at").on(table.dueAt),
  index("idx_push_jobs_lease_until").on(table.leaseUntil),
  index("idx_push_jobs_subscription_plan").on(table.subscriptionId, table.planId),
]);

export const analyticsEvents = sqliteTable("analytics_events", {
  eventId: text("event_id").primaryKey(),
  actorId: text("actor_id").notNull(),
  actorKind: text("actor_kind").notNull(),
  eventName: text("event_name").notNull(),
  flowId: text("flow_id"),
  durationMs: integer("duration_ms"),
  errorCode: text("error_code"),
  pilotEligible: integer("pilot_eligible", { mode: "boolean" }),
  occurredAt: integer("occurred_at").notNull(),
  recordedAt: integer("recorded_at").notNull(),
}, (table) => [
  index("idx_analytics_events_actor_name_time").on(table.actorId, table.eventName, table.occurredAt),
  index("idx_analytics_events_name_time").on(table.eventName, table.occurredAt),
  index("idx_analytics_events_flow").on(table.flowId),
]);
