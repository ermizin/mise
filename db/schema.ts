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
