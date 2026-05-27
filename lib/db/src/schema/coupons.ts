import {
  pgTable,
  text,
  uuid,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

/**
 * Promotional codes redeemable by riders against a single trip's fare.
 * One coupon per trip; redemption is recorded only on trip completion so
 * cancellations never consume the rider's per-user allowance or the global
 * total. Codes are stored as-entered but matched case-insensitively via the
 * unique index on lower(code).
 */
export const couponsTable = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    description: text("description"),
    // "percentage" applies discountValue% (capped by maxDiscount when set).
    // "fixed" subtracts a flat amount from the trip subtotal.
    discountType: text("discount_type", { enum: ["percentage", "fixed"] }).notNull(),
    discountValue: doublePrecision("discount_value").notNull(),
    /** Cap (in fare currency) for percentage coupons. NULL = no cap. */
    maxDiscount: doublePrecision("max_discount"),
    /** Minimum trip subtotal (in fare currency) required to redeem. NULL = none. */
    minTripAmount: doublePrecision("min_trip_amount"),
    /** Global redemption cap. NULL = unlimited. */
    usageLimitTotal: integer("usage_limit_total"),
    /** Per-user redemption cap. NULL = unlimited. */
    usageLimitPerUser: integer("usage_limit_per_user"),
    /** Running counter incremented atomically on completion. */
    totalUsed: integer("total_used").notNull().default(0),
    /** Inclusive validity window. NULL bounds mean open-ended. */
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /** Restrict to riders with no completed rides yet. */
    firstRideOnly: boolean("first_ride_only").notNull().default(false),
    /** Eligible rider country codes (e.g. "+212"). NULL/empty = all. */
    countryCodes: text("country_codes").array(),
    /** Eligible vehicle type ids. NULL/empty = all categories. */
    vehicleTypeIds: uuid("vehicle_type_ids").array(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    codeUniqueLower: uniqueIndex("coupons_code_lower_unique").on(
      sql`lower(${t.code})`,
    ),
    activeIdx: index("coupons_active_idx").on(t.active),
  }),
);

export type Coupon = typeof couponsTable.$inferSelect;
export type InsertCoupon = typeof couponsTable.$inferInsert;

/**
 * One row per successful coupon application against a completed ride.
 * Inserted atomically inside the trip-completion transaction together with
 * the coupons.total_used increment, keeping per-user and global caps honest
 * even under concurrent completions. The unique constraint on rideId enforces
 * "one coupon per trip"; the unique on (couponId, userId, rideId) prevents
 * duplicate inserts during retries.
 */
export const couponRedemptionsTable = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => couponsTable.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    /** Discount amount actually applied, in fare currency. */
    discountAmount: doublePrecision("discount_amount").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    rideUnique: uniqueIndex("coupon_redemptions_ride_unique").on(t.rideId),
    couponUserIdx: index("coupon_redemptions_coupon_user_idx").on(
      t.couponId,
      t.userId,
    ),
  }),
);

export type CouponRedemption = typeof couponRedemptionsTable.$inferSelect;
export type InsertCouponRedemption = typeof couponRedemptionsTable.$inferInsert;
