import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const dispatchMethodEnum = pgEnum("dispatch_method", ["socket", "push"]);
export const dispatchStatusEnum = pgEnum("dispatch_status", ["queued", "delivered", "failed"]);

export const rideDispatchLogsTable = pgTable(
  "ride_dispatch_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rideId: uuid("ride_id").notNull(),
    driverId: uuid("driver_id").notNull(),
    method: dispatchMethodEnum("method").notNull(),
    status: dispatchStatusEnum("status").notNull().default("queued"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ride_dispatch_logs_ride_id_idx").on(table.rideId),
    index("ride_dispatch_logs_driver_id_idx").on(table.driverId),
  ],
);

export type RideDispatchLog = typeof rideDispatchLogsTable.$inferSelect;
export type InsertRideDispatchLog = typeof rideDispatchLogsTable.$inferInsert;
