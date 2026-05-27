import {
  pgTable,
  text,
  uuid,
  timestamp,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const driverDestinationModesTable = pgTable(
  "driver_destination_modes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    destinationLabel: text("destination_label").notNull().default(""),
    destinationAddress: text("destination_address").notNull(),
    destLat: doublePrecision("dest_lat").notNull(),
    destLng: doublePrecision("dest_lng").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedTripId: uuid("completed_trip_id").references(() => ridesTable.id, {
      onDelete: "set null",
    }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedReason: text("deactivated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byDriverActive: index("driver_destination_modes_driver_active_idx").on(
      t.driverId,
      t.isActive,
    ),
    byDriverCreated: index("driver_destination_modes_driver_created_idx").on(
      t.driverId,
      t.createdAt,
    ),
  }),
);

export type DriverDestinationMode =
  typeof driverDestinationModesTable.$inferSelect;
export type InsertDriverDestinationMode =
  typeof driverDestinationModesTable.$inferInsert;

export const driverSavedPlacesTable = pgTable(
  "driver_saved_places",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["home", "work", "recent"] }).notNull(),
    label: text("label").notNull().default(""),
    address: text("address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    googlePlaceId: text("google_place_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byDriverKind: index("driver_saved_places_driver_kind_idx").on(
      t.driverId,
      t.kind,
    ),
  }),
);

export type DriverSavedPlace = typeof driverSavedPlacesTable.$inferSelect;
export type InsertDriverSavedPlace =
  typeof driverSavedPlacesTable.$inferInsert;
