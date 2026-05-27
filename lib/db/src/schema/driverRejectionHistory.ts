import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const driverRejectionHistoryTable = pgTable(
  "driver_rejection_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reason: text("reason"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("driver_rejection_history_driver_id_idx").on(table.driverId)],
);

export type DriverRejectionHistory = typeof driverRejectionHistoryTable.$inferSelect;
export type InsertDriverRejectionHistory = typeof driverRejectionHistoryTable.$inferInsert;
