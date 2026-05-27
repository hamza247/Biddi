import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { serviceAreasTable } from "./serviceAreas";
import { appClassesTable } from "./appClasses";

export interface PeakSurchargeWindow {
  days: number[];
  startTime: string;
  endTime: string;
  multiplier: number;
}

export const vehicleTypesTable = pgTable("vehicle_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  vehicleCategory: text("vehicle_category", { enum: ["car", "moto"] })
    .notNull()
    .default("car"),
  poolEnabled: boolean("pool_enabled").notNull().default(false),
  wheelchairAccess: boolean("wheelchair_access").notNull().default(false),
  assistAvailable: boolean("assist_available").notNull().default(false),
  petFriendly: boolean("pet_friendly").notNull().default(false),
  fareModelStrategy: text("fare_model_strategy", {
    enum: ["incremental", "fixed"],
  })
    .notNull()
    .default("incremental"),
  pricePerKm: doublePrecision("price_per_km").notNull().default(3.5),
  pricePerMin: doublePrecision("price_per_min").notNull().default(0.5),
  baseFare: doublePrecision("base_fare").notNull().default(10),
  minimumFare: doublePrecision("minimum_fare").notNull().default(15),
  commissionPercent: doublePrecision("commission_percent").notNull().default(15),
  cancellationTimeLimitMin: integer("cancellation_time_limit_min")
    .notNull()
    .default(0),
  cancellationCharge: doublePrecision("cancellation_charge")
    .notNull()
    .default(0),
  waitingTimeLimitMin: integer("waiting_time_limit_min").notNull().default(0),
  waitingCharge: doublePrecision("waiting_charge").notNull().default(0),
  inTransitWaitingFeePerMin: doublePrecision("in_transit_waiting_fee_per_min")
    .notNull()
    .default(0),
  personCapacity: integer("person_capacity").notNull().default(4),
  peakSurchargeEnabled: boolean("peak_surcharge_enabled")
    .notNull()
    .default(false),
  peakSurchargeWindows: jsonb("peak_surcharge_windows")
    .$type<PeakSurchargeWindow[]>()
    .notNull()
    .default([]),
  nightChargeEnabled: boolean("night_charge_enabled").notNull().default(false),
  nightChargeStart: text("night_charge_start"),
  nightChargeEnd: text("night_charge_end"),
  nightChargeMultiplier: doublePrecision("night_charge_multiplier")
    .notNull()
    .default(1),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  iconUrl: text("icon_url"),
  classKey: text("class_key").references(() => appClassesTable.slug, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vehicleTypeServiceAreasTable = pgTable(
  "vehicle_type_service_areas",
  {
    vehicleTypeId: uuid("vehicle_type_id")
      .notNull()
      .references(() => vehicleTypesTable.id, { onDelete: "cascade" }),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreasTable.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vehicleTypeId, table.serviceAreaId] }),
  }),
);

export type VehicleType = typeof vehicleTypesTable.$inferSelect;
export type InsertVehicleType = typeof vehicleTypesTable.$inferInsert;
export type VehicleTypeServiceArea =
  typeof vehicleTypeServiceAreasTable.$inferSelect;
export type InsertVehicleTypeServiceArea =
  typeof vehicleTypeServiceAreasTable.$inferInsert;
