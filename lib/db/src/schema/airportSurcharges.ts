import {
  pgTable,
  uuid,
  doublePrecision,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { serviceAreasTable } from "./serviceAreas";
import { vehicleTypesTable } from "./vehicleTypes";

export const AIRPORT_SURCHARGE_TYPES = ["multiplier", "fixed"] as const;
export type AirportSurchargeType = (typeof AIRPORT_SURCHARGE_TYPES)[number];

export const airportSurchargesTable = pgTable(
  "airport_surcharges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    airportLocationId: uuid("airport_location_id")
      .notNull()
      .references(() => serviceAreasTable.id, { onDelete: "cascade" }),
    vehicleTypeId: uuid("vehicle_type_id")
      .notNull()
      .references(() => vehicleTypesTable.id, { onDelete: "cascade" }),
    surchargeType: text("surcharge_type", { enum: AIRPORT_SURCHARGE_TYPES })
      .notNull()
      .default("multiplier"),
    pickupSurchargeValue: doublePrecision("pickup_surcharge_value")
      .notNull()
      .default(1),
    dropoffSurchargeValue: doublePrecision("dropoff_surcharge_value")
      .notNull()
      .default(1),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqAirportVehicle: uniqueIndex("airport_surcharges_airport_vehicle_uniq").on(
      t.airportLocationId,
      t.vehicleTypeId,
    ),
  }),
);

export type AirportSurcharge = typeof airportSurchargesTable.$inferSelect;
export type InsertAirportSurcharge = typeof airportSurchargesTable.$inferInsert;
