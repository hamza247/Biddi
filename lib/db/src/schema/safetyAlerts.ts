import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { adminsTable } from "./admins";
import { ridesTable } from "./rides";

export const safetyAlertsTable = pgTable("safety_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  rideId: uuid("ride_id")
    .notNull()
    .references(() => ridesTable.id, { onDelete: "cascade" }),
  triggeredById: uuid("triggered_by_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "resolved"] })
    .notNull()
    .default("active"),
  resolvedById: uuid("resolved_by_id").references(() => adminsTable.id, {
    onDelete: "set null",
  }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type SafetyAlert = typeof safetyAlertsTable.$inferSelect;
export type InsertSafetyAlert = typeof safetyAlertsTable.$inferInsert;
