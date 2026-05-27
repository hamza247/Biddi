import { pgTable, uuid, doublePrecision, timestamp, index, text } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Stores GPS trail points for drivers during active rides.
// Each GPS update during an active ride inserts a row here (throttled to
// at most one row per TRAIL_PERSIST_INTERVAL_MS to cap write throughput).
// The in-memory buffer in io.ts still accumulates every fix for smooth
// real-time polyline extension; this table is the durable backing store
// so trails survive server restarts.
// Points are retained for TRAIL_RETENTION_DAYS days then pruned.
export const driverTrailPointsTable = pgTable(
  "driver_trail_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rideId: text("ride_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    heading: doublePrecision("heading"),
    speed: doublePrecision("speed"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("driver_trail_points_driver_ride_idx").on(t.driverId, t.rideId),
    index("driver_trail_points_recorded_at_idx").on(t.recordedAt),
  ],
);

export type DriverTrailPoint = typeof driverTrailPointsTable.$inferSelect;
