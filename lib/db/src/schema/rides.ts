import {
  pgTable,
  text,
  uuid,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { vehicleTypesTable } from "./vehicleTypes";

export interface FareBreakdown {
  currency: string;
  base: number;
  distance: number;
  distanceKm: number;
  pricePerKm: number;
  time: number;
  durationMin: number;
  pricePerMin: number;
  peakMultiplier: number;
  peakSurcharge: number;
  nightMultiplier: number;
  nightSurcharge: number;
  subtotal: number;
  minimumFare: number;
  minimumApplied: boolean;
  waitingMin: number;
  waitingFee: number;
  fareModel: "incremental" | "fixed";
  pool: boolean;
  total: number;
  /** The bid amount the driver and rider agreed to. Recorded for audit;
   * the metered `total` is what the rider actually pays. */
  agreedBid?: number;
  /** Weather surcharge added (in fare currency). 0 or undefined when no rule
   * matched or the weather feature is unavailable. */
  weatherSurcharge?: number;
  /** Multiplier applied to the (base+distance+time+peak+night) subtotal.
   * 1.0 means no multiplier (or a fixed-amount rule was used). */
  weatherMultiplier?: number;
  /** Short i18n key explaining why the surcharge applied (e.g. "heavyRain"). */
  weatherReason?: string;
  /** Human-readable rule name for receipts/invoices. */
  weatherRuleName?: string;
  /** Airport pickup surcharge applied (in fare currency). 0 or undefined when
   * no airport rule matched the pickup point. */
  airportPickupSurcharge?: number;
  /** Airport dropoff surcharge applied (in fare currency). 0 or undefined when
   * no airport rule matched the dropoff point. */
  airportDropoffSurcharge?: number;
  /** Human-readable airport name for the pickup zone (for receipts). */
  airportPickupName?: string;
  /** Human-readable airport name for the dropoff zone (for receipts). */
  airportDropoffName?: string;
  /** Coupon discount applied at completion, in fare currency.
   * Subtracted from the metered subtotal before the minimum-fare floor. */
  couponDiscount?: number;
  /** Coupon code applied at completion. Snapshotted onto the breakdown so
   * the receipt remains stable even if the underlying code is later edited. */
  couponCode?: string;
}

export const ridesTable = pgTable("rides", {
  id: uuid("id").defaultRandom().primaryKey(),
  riderId: uuid("rider_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  pickupLabel: text("pickup_label").notNull(),
  pickupAddress: text("pickup_address").notNull(),
  dropoffLabel: text("dropoff_label").notNull(),
  dropoffAddress: text("dropoff_address").notNull(),
  estimatedDistanceKm: doublePrecision("estimated_distance_km").notNull(),
  estimatedDurationMin: integer("estimated_duration_min").notNull(),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropoffLat: doublePrecision("dropoff_lat"),
  dropoffLng: doublePrecision("dropoff_lng"),
  routePolyline: text("route_polyline"),
  status: text("status", {
    enum: [
      "bidding",
      "driver_arriving",
      "in_progress",
      "completed",
      "cancelled",
      "queued",
      "assigned_next",
    ],
  })
    .notNull()
    .default("bidding"),
  // Driver who has queued this ride as their next trip while completing
  // another trip. Set when a queued ride is accepted; cleared on release.
  queuedDriverId: uuid("queued_driver_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  // Current state in the queue lifecycle for this ride. NULL for rides not
  // participating in the queue feature.
  queueStatus: text("queue_status", {
    enum: ["pending", "accepted", "cancelled", "expired", "activated"],
  }),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  // The driver's previous (completed) trip that this ride was queued behind.
  previousTripId: uuid("previous_trip_id"),
  acceptedBidId: uuid("accepted_bid_id"),
  acceptedDriverId: uuid("accepted_driver_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  finalAmount: doublePrecision("final_amount"),
  // Fare the rider initially offered when requesting (inDrive-style flow).
  // Drivers see this as the rider's offer; they can accept or counter-bid.
  initialFare: doublePrecision("initial_fare"),
  // Vehicle class chosen by the rider at request time: "ride" | "comfort" | "moto".
  // Stored as free-form text to keep the column flexible for future tiers.
  vehicleClass: text("vehicle_class"),
  // Canonical reference to the chosen service category. classKey/vehicleClass
  // is kept for back-compat but vehicleTypeId is the source of truth for
  // capabilities (pool/wheelchair/pet/assist) at request time.
  vehicleTypeId: uuid("vehicle_type_id").references(() => vehicleTypesTable.id, {
    onDelete: "set null",
  }),
  // Rider opted into a shared/pool ride. Only meaningful when the chosen
  // vehicle type has poolEnabled = true on the backend.
  isShared: boolean("is_shared").notNull().default(false),
  // Number of seats the rider needs (1 by default, up to category capacity).
  seatsRequested: integer("seats_requested").notNull().default(1),
  // Optional accessibility / handling flags the rider asked for.
  wheelchairRequested: boolean("wheelchair_requested").notNull().default(false),
  petRequested: boolean("pet_requested").notNull().default(false),
  assistRequested: boolean("assist_requested").notNull().default(false),
  // Driver-reported in-transit waiting time (e.g., curbside delays). Used
  // to compute waiting fees on completion. Defaults to 0 = no waiting.
  inTransitWaitingMin: integer("in_transit_waiting_min").notNull().default(0),
  // Cancellation fee charged to the rider when cancelling after grace.
  cancellationFee: doublePrecision("cancellation_fee"),
  // Who initiated the cancellation. NULL on non-cancelled rides.
  // 'rider'  — rider tapped cancel from the app.
  // 'driver' — driver cancelled (no driver-side endpoint exists yet; reserved
  //            for upcoming flows so cancellation rate can attribute to drivers).
  // 'system' — automatic cancellation (e.g. rider requested a new ride which
  //            superseded an active one, bid expiry, admin force).
  cancelledBy: text("cancelled_by", { enum: ["rider", "driver", "system"] }),
  // Free-form reason text captured at cancellation time. May be a label
  // pulled from cancellation_reasons (admin-managed) or a custom string
  // submitted by the canceller. NULL on non-cancelled rides or when the
  // canceller skipped reason selection.
  cancellationReason: text("cancellation_reason"),
  // Snapshot of the fare breakdown shown on the rider's receipt. Pinned at
  // completion so subsequent pricing changes don't rewrite history.
  fareBreakdown: jsonb("fare_breakdown").$type<FareBreakdown>(),
  // Coupon attached to this ride at request time. Cleared if the rider
  // removes it before completion. The coupon is only consumed (recorded in
  // coupon_redemptions and counted against the global/per-user caps) when
  // the trip actually completes, so cancellations don't burn a redemption.
  couponId: uuid("coupon_id"),
  // Discount amount actually applied at completion, in fare currency.
  // Mirrors coupon_redemptions.discount_amount for fast invoice rendering
  // without an extra join. NULL until the trip completes with a coupon.
  couponDiscount: doublePrecision("coupon_discount"),
  paymentMethod: text("payment_method", { enum: ["cash", "card"] })
    .notNull()
    .default("cash"),
  ratingScore: integer("rating_score"),
  ratingComment: text("rating_comment"),
  customerRatingScore: integer("customer_rating_score"),
  customerRatingComment: text("customer_rating_comment"),
  // When two or more shared (pool) ride requests are matched together, they
  // all share the same sharedGroupId so the server can treat them as a single
  // multi-rider trip. NULL means the ride is solo or not yet matched.
  sharedGroupId: uuid("shared_group_id"),
  // Opaque token the rider can share with friends/family so they can view
  // a sanitized live tracking page (status + driver location + ETA) at
  // /api/track/<token>. Generated lazily on first share request and is
  // unique across all rides. NULL until the rider has shared the trip.
  shareToken: text("share_token").unique(),
  // Deadline for accepting driver offers on a bidding ride. After this point
  // the expiry job flips the ride to cancelled (cancelledBy='system'). NULL
  // on non-bidding rides. Defaults to +5 min from creation when the rider
  // posts a bidding request.
  biddingExpiresAt: timestamp("bidding_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Ride = typeof ridesTable.$inferSelect;
export type InsertRide = typeof ridesTable.$inferInsert;
