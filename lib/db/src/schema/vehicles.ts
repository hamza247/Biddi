import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { vehicleTypesTable } from "./vehicleTypes";
import { serviceAreasTable } from "./serviceAreas";

export const vehiclesTable = pgTable("vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: text("year").notNull(),
  color: text("color").notNull(),
  plate: text("plate").notNull(),
  vehicleTypeId: uuid("vehicle_type_id").references(() => vehicleTypesTable.id, {
    onDelete: "set null",
  }),
  zoneId: uuid("zone_id").references(() => serviceAreasTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Vehicle = typeof vehiclesTable.$inferSelect;
export type InsertVehicle = typeof vehiclesTable.$inferInsert;
