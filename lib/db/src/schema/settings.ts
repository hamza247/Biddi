import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AppSetting = typeof settingsTable.$inferSelect;
