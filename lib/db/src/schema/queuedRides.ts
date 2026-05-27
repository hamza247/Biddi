import {
  pgTable,
  text,
  uuid,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const driverQueuedRidesTable = pgTable(
  "driver_queued_rides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    currentTripId: uuid("current_trip_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    nextTripId: uuid("next_trip_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "accepted", "cancelled", "expired", "activated"],
    })
      .notNull()
      .default("pending"),
    pickupLat: doublePrecision("pickup_lat"),
    pickupLng: doublePrecision("pickup_lng"),
    dropoffLat: doublePrecision("dropoff_lat"),
    dropoffLng: doublePrecision("dropoff_lng"),
    estimatedPickupAfterMinutes: integer("estimated_pickup_after_minutes"),
    queuePosition: integer("queue_position").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byDriverStatus: index("driver_queued_rides_driver_status_idx").on(
      t.driverId,
      t.status,
    ),
    byNextTrip: index("driver_queued_rides_next_trip_idx").on(t.nextTripId),
    byCurrentTrip: index("driver_queued_rides_current_trip_idx").on(
      t.currentTripId,
    ),
  }),
);

export type DriverQueuedRide = typeof driverQueuedRidesTable.$inferSelect;
export type InsertDriverQueuedRide = typeof driverQueuedRidesTable.$inferInsert;
