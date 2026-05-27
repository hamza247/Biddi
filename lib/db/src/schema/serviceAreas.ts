import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";

export const GEO_FENCE_TYPES = [
  "service_area",
  "restricted_area",
  "pricing_zone",
  "location_wise_fare",
  "airport_surcharge",
  "vehicle_service_type",
] as const;

export type GeoFenceType = (typeof GEO_FENCE_TYPES)[number];

export const serviceAreasTable = pgTable("service_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull().default("Morocco"),
  type: text("type", {
    enum: GEO_FENCE_TYPES,
  })
    .notNull()
    .default("service_area"),
  polygonJson: text("polygon_json"),
  // Optional center point + radius used when type = "airport_surcharge". The
  // airport surcharge feature uses a haversine check around (centerLat,
  // centerLng) within radiusM meters instead of a polygon.
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusM: integer("radius_m"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ServiceArea = typeof serviceAreasTable.$inferSelect;
export type InsertServiceArea = typeof serviceAreasTable.$inferInsert;

export const countriesTable = pgTable("countries", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  isoCode: text("iso_code").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Country = typeof countriesTable.$inferSelect;
export type InsertCountry = typeof countriesTable.$inferInsert;

// Tombstone table for ISO country codes the admin has explicitly deleted.
// `ensureGeoFenceDefaults` consults this list so the seed step does not
// silently re-create rows the operator removed on purpose.
export const deletedCountryCodesTable = pgTable("deleted_country_codes", {
  isoCode: text("iso_code").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DeletedCountryCode = typeof deletedCountryCodesTable.$inferSelect;
export type InsertDeletedCountryCode = typeof deletedCountryCodesTable.$inferInsert;

export const RESTRICT_AREA_VALUES = ["pickup", "dropoff"] as const;
export const RESTRICT_TYPE_VALUES = ["disallowed"] as const;

export type RestrictArea = (typeof RESTRICT_AREA_VALUES)[number];
export type RestrictType = (typeof RESTRICT_TYPE_VALUES)[number];

export const restrictedAreasTable = pgTable("restricted_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceAreaId: uuid("service_area_id")
    .notNull()
    .references(() => serviceAreasTable.id, { onDelete: "cascade" }),
  restrictArea: text("restrict_area", { enum: RESTRICT_AREA_VALUES })
    .notNull()
    .default("pickup"),
  restrictType: text("restrict_type", { enum: RESTRICT_TYPE_VALUES })
    .notNull()
    .default("disallowed"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RestrictedArea = typeof restrictedAreasTable.$inferSelect;
export type InsertRestrictedArea = typeof restrictedAreasTable.$inferInsert;
