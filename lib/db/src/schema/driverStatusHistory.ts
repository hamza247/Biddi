import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { adminsTable } from "./admins";

export const driverStatusHistoryTable = pgTable("driver_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["not_applied", "pending", "approved", "rejected", "suspended"],
  }).notNull(),
  action: text("action"),
  reason: text("reason"),
  changedByAdminId: uuid("changed_by_admin_id").references(
    () => adminsTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DriverStatusHistory =
  typeof driverStatusHistoryTable.$inferSelect;
export type InsertDriverStatusHistory =
  typeof driverStatusHistoryTable.$inferInsert;
