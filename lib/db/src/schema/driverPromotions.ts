import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { ridesTable } from "./rides";
import { adminsTable } from "./admins";
import { vehicleTypesTable } from "./vehicleTypes";
import { serviceAreasTable } from "./serviceAreas";

export const driverPromotionsTable = pgTable(
  "driver_promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    bonusAmount: doublePrecision("bonus_amount").notNull(),
    requiredTrips: integer("required_trips").notNull().default(1),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    repeatType: text("repeat_type", {
      enum: ["none", "daily", "weekly"],
    })
      .notNull()
      .default("none"),
    serviceAreaId: uuid("service_area_id").references(
      () => serviceAreasTable.id,
      { onDelete: "set null" },
    ),
    vehicleTypeId: uuid("vehicle_type_id").references(
      () => vehicleTypesTable.id,
      { onDelete: "set null" },
    ),
    driverScope: text("driver_scope", { enum: ["all", "selected"] })
      .notNull()
      .default("all"),
    eligibleDriverIds: uuid("eligible_driver_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    activeIdx: index("driver_promotions_active_idx").on(t.isActive),
    windowIdx: index("driver_promotions_window_idx").on(t.startAt, t.endAt),
  }),
);

export const driverPromotionProgressTable = pgTable(
  "driver_promotion_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => driverPromotionsTable.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    cycleStart: timestamp("cycle_start", { withTimezone: true }).notNull(),
    cycleEnd: timestamp("cycle_end", { withTimezone: true }).notNull(),
    completedTrips: integer("completed_trips").notNull().default(0),
    rewardCredited: boolean("reward_credited").notNull().default(false),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
    nearCompletionNotifiedAt: timestamp("near_completion_notified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("driver_promotion_progress_uniq").on(
      t.promotionId,
      t.driverId,
      t.cycleStart,
    ),
    driverIdx: index("driver_promotion_progress_driver_idx").on(t.driverId),
  }),
);

export const driverPromotionTripLogsTable = pgTable(
  "driver_promotion_trip_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => driverPromotionsTable.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    cycleStart: timestamp("cycle_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("driver_promotion_trip_logs_uniq").on(
      t.promotionId,
      t.rideId,
      t.cycleStart,
    ),
    driverCycleIdx: index("driver_promotion_trip_logs_driver_cycle_idx").on(
      t.driverId,
      t.cycleStart,
    ),
  }),
);

export type DriverPromotion = typeof driverPromotionsTable.$inferSelect;
export type InsertDriverPromotion = typeof driverPromotionsTable.$inferInsert;
export type DriverPromotionProgress =
  typeof driverPromotionProgressTable.$inferSelect;
export type InsertDriverPromotionProgress =
  typeof driverPromotionProgressTable.$inferInsert;
export type DriverPromotionTripLog =
  typeof driverPromotionTripLogsTable.$inferSelect;
export type InsertDriverPromotionTripLog =
  typeof driverPromotionTripLogsTable.$inferInsert;
