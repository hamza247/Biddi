import {
  pgTable,
  text,
  uuid,
  timestamp,
  doublePrecision,
  boolean,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

/**
 * Conditions that trigger a weather surcharge. Any condition that is set
 * acts as an OR — when ANY threshold is crossed in the latest reading the
 * rule applies. Unset (null) thresholds are ignored.
 */
export interface WeatherConditions {
  /** Rain mm in the last hour. >= triggers. */
  rainMmGte?: number | null;
  /** Snow mm in the last hour. >= triggers. */
  snowMmGte?: number | null;
  /** Temperature in Celsius. <= triggers (cold extreme). */
  tempCLte?: number | null;
  /** Temperature in Celsius. >= triggers (hot extreme). */
  tempCGte?: number | null;
  /** Wind speed in m/s. >= triggers. */
  windMsGte?: number | null;
  /** OpenWeather "main" condition id matches (e.g. "Thunderstorm", "Snow"). */
  weatherMain?: string[] | null;
}

/**
 * A single OpenWeather observation snapshot for a (lat, lng) point.
 * Stored so rule evaluation never blocks a rider request on a network call
 * to OpenWeather. Updated by the polling job every ~15 minutes.
 */
export const weatherReadingsCacheTable = pgTable("weather_readings_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Origin of the reading: "country:MA" or "service_area:<uuid>". */
  scope: text("scope").notNull(),
  /** Sampling latitude. Polled at the centroid of the scope. */
  lat: doublePrecision("lat").notNull(),
  /** Sampling longitude. */
  lng: doublePrecision("lng").notNull(),
  rainMm: doublePrecision("rain_mm").notNull().default(0),
  snowMm: doublePrecision("snow_mm").notNull().default(0),
  tempC: doublePrecision("temp_c").notNull().default(0),
  windMs: doublePrecision("wind_ms").notNull().default(0),
  weatherMain: text("weather_main"),
  weatherDescription: text("weather_description"),
  /** When the OpenWeather observation was made (provider's `dt`). */
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  /** When this row was written. Used for staleness checks. */
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WeatherReading = typeof weatherReadingsCacheTable.$inferSelect;

/**
 * Admin-defined surcharge rule. Scope is one of:
 *  - "country"      → applies to every ride whose pickup country matches `countryIso`.
 *  - "service_area" → applies when pickup falls inside the polygon of `serviceAreaId`.
 *
 * When more than one rule matches, the highest effective surcharge wins.
 *
 * Surcharge model:
 *  - kind = "multiplier" → multiply the (base+distance+time+peak+night) subtotal by `value`.
 *  - kind = "fixed"      → add a fixed amount to the subtotal (in the fare currency).
 */
export const weatherSurchargeRulesTable = pgTable("weather_surcharge_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  scope: text("scope", { enum: ["country", "service_area"] }).notNull(),
  /** ISO code (e.g. "MA"). Required when scope = "country". */
  countryIso: text("country_iso"),
  /** Service area uuid. Required when scope = "service_area". */
  serviceAreaId: uuid("service_area_id"),
  conditions: jsonb("conditions").$type<WeatherConditions>().notNull().default({}),
  kind: text("kind", { enum: ["multiplier", "fixed"] }).notNull().default("multiplier"),
  /** Multiplier (>=1) or fixed amount in fare currency. */
  value: doublePrecision("value").notNull().default(1),
  /** Optional time window — HH:MM, 24h, server-local. */
  startTime: text("start_time"),
  endTime: text("end_time"),
  /** Days of week the rule applies (0=Sun..6=Sat). NULL/empty = every day. */
  daysOfWeek: integer("days_of_week").array(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WeatherSurchargeRule = typeof weatherSurchargeRulesTable.$inferSelect;
export type InsertWeatherSurchargeRule = typeof weatherSurchargeRulesTable.$inferInsert;
