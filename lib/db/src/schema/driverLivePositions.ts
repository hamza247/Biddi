import { pgTable, uuid, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const driverLivePositionsTable = pgTable(
  "driver_live_positions",
  {
    driverId: uuid("driver_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    heading: doublePrecision("heading"),
    speed: doublePrecision("speed"),
    accuracy: doublePrecision("accuracy"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("driver_live_positions_updated_at_idx").on(t.updatedAt)],
);

export type DriverLivePosition = typeof driverLivePositionsTable.$inferSelect;
