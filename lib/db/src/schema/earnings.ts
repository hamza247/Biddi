import {
  pgTable,
  uuid,
  timestamp,
  doublePrecision,
  text,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const earningsTable = pgTable("earnings", {
  id: uuid("id").defaultRandom().primaryKey(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  rideId: uuid("ride_id")
    .notNull()
    .references(() => ridesTable.id, { onDelete: "cascade" }),
  amount: doublePrecision("amount").notNull(),
  riderName: text("rider_name").notNull(),
  pickupAddress: text("pickup_address").notNull(),
  dropoffAddress: text("dropoff_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type EarningsEntry = typeof earningsTable.$inferSelect;
