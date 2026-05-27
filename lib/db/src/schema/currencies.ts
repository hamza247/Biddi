import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Per-currency exchange rate snapshot. All internal money math is done in
 * USD; the display layer reads `rateFromUsd` to convert to whatever the
 * rider/driver/admin chose to see (settings.displayCurrency).
 *
 * USD is the canonical base — its row is always present with rateFromUsd=1
 * and isActive=true. Operators cannot disable USD; the admin endpoint
 * enforces that constraint.
 */
export const currenciesTable = pgTable("currencies", {
  /** ISO-4217 alphabetic code, e.g. "USD", "MAD", "EUR". Primary key. */
  code: text("code").primaryKey(),
  /** Display name shown in the admin UI ("US Dollar"). */
  name: text("name").notNull(),
  /** Symbol shown next to amounts in apps ($, MAD, €). */
  symbol: text("symbol").notNull(),
  /** Multiplier such that `amountInThisCurrency = amountUsd * rateFromUsd`.
   * USD is pinned at 1. Other currencies start NULL until the first
   * successful refresh from open.er-api.com. */
  rateFromUsd: doublePrecision("rate_from_usd"),
  /** When the rate was last successfully refreshed. NULL when never set
   * (e.g. a freshly seeded MAD/EUR row before the first poll). */
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
  /** Active currencies are eligible to be chosen as the platform's
   * `displayCurrency` and shown in the admin selector. USD is always
   * active. */
  isActive: boolean("is_active").notNull().default(true),
  /** Number of decimal places to render (0–4). Default 2 (USD-style). */
  decimalPlaces: integer("decimal_places").notNull().default(2),
  /** Whether the symbol appears before or after the amount when rendering. */
  symbolPosition: text("symbol_position", { enum: ["before", "after"] })
    .notNull()
    .default("before"),
  /** Character used to group thousands when formatting. */
  thousandsSeparator: text("thousands_separator", {
    enum: ["comma", "dot", "space"],
  })
    .notNull()
    .default("comma"),
  /** Character used to separate the integer and fractional parts. */
  decimalSeparator: text("decimal_separator", { enum: ["dot", "comma"] })
    .notNull()
    .default("dot"),
  /** Operator-controlled position in selectors and the admin list.
   * Lower numbers appear first; ties fall back to USD-first then
   * alphabetical by code. Defaults to 0 so newly-seeded rows land at
   * the top of the list and can be reshuffled from the admin UI. */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Currency = typeof currenciesTable.$inferSelect;
export type InsertCurrency = typeof currenciesTable.$inferInsert;
