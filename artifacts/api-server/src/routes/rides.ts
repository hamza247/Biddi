import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  ridesTable,
  bidsTable,
  usersTable,
  vehiclesTable,
  earningsTable,
  vehicleTypesTable,
  restrictedAreasTable,
  serviceAreasTable,
  rideDispatchLogsTable,
  walletTransactionsTable,
  commissionExemptionsTable,
  tripMessagesTable,
  cancellationReasonsTable,
  couponsTable,
  couponRedemptionsTable,
  referralEarningsTable,
  type FareBreakdown,
} from "@workspace/db";
import { and, eq, desc, inArray, isNull, isNotNull, ne, or, lte, gte, sql } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";
import { emitToRide, emitToUser, isUserSocketConnected, getDriverLivePosition } from "../lib/io";
import { sendPushFromTemplate } from "../lib/push";
import { recordTripForPromotions } from "../services/driverPromotions";
import { logger } from "../lib/logger";
import { initialOf } from "../lib/serializers";
import { enrichAmount, enrichFareBreakdown, resolveDisplayCurrency, type DisplayAmount } from "../lib/currency";
import { getConfig } from "../lib/settings";
import { recomputeAndStoreDriverRating } from "../lib/driverRating";
import { recomputeAndStoreCustomerRating } from "../lib/customerRating";
import { invalidateDriverRates } from "../lib/driverStats";
import { acceptBid } from "../lib/bidding";
import { osrmRoute } from "../lib/maps";
import { recordRecentPlace } from "./places";
import { randomUUID } from "crypto";
import {
  FARE_CURRENCY,
  buildFinalFareBreakdown,
  computeCancellationFee,
  computeFareBreakdown,
  loadVehicleType,
  pickVehicleType,
} from "../lib/pricing";
import {
  computeCouponDiscount,
  loadRiderCountryCode,
  validateCoupon,
} from "../lib/coupons";
import { pointInPolygon } from "../lib/geo";
import { ObjectStorageService } from "../lib/objectStorage";
import { resolveWeatherSurcharge } from "../lib/weather";
import { resolveAirportSurcharge } from "../lib/airportSurcharge";
import { buildDriverTripPayload } from "./driver";
import { distributeReferralRewards } from "../services/referrals";
import {
  activateQueuedRideAfterCompletionTx,
  releaseQueuedRideForRider,
  releaseQueuedRidesForDriver,
} from "../lib/queuedRides";

// Rollout cutoff for the 3-level referral rewards feature. Mirrors the
// timestamp on migration 0017_marvelous_spyke (when referral payouts went
// live in production). The /complete retry path uses this as a hard floor
// so historical pre-feature rides cannot be retroactively credited.
const REFERRALS_FEATURE_CUTOFF_MS = 1777771972139;

const router: IRouter = Router();

const objectStorageService = new ObjectStorageService();

/**
 * Only paths that match this pattern are eligible for storage deletion.
 * This is intentionally identical to OBJECT_PATH_RE in messages.ts — any
 * content that does not match a well-formed chat upload path is skipped to
 * prevent arbitrary object deletion via a crafted message content value.
 */
const CHAT_ATTACHMENT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._-]{1,128}$/;

/**
 * Deletes all trip_messages rows for a given trip and removes any associated
 * object-storage attachments (images, voice notes). Only paths that conform to
 * the chat-upload namespace are eligible for deletion; anything else is skipped
 * and logged. Errors during file deletion are logged but do not prevent the DB
 * rows from being removed.
 */
async function cleanupTripMessages(tripId: string): Promise<void> {
  let messages: Array<{ id: string; type: string; content: string }> = [];
  try {
    messages = await db
      .select({ id: tripMessagesTable.id, type: tripMessagesTable.type, content: tripMessagesTable.content })
      .from(tripMessagesTable)
      .where(eq(tripMessagesTable.tripId, tripId));
  } catch (err) {
    logger.error({ err, tripId }, "[chat-cleanup] Failed to fetch trip messages for cleanup");
    return;
  }

  for (const msg of messages) {
    if (msg.type !== "text") {
      if (!CHAT_ATTACHMENT_PATH_RE.test(msg.content)) {
        logger.warn(
          { tripId, messageId: msg.id, content: msg.content },
          "[chat-cleanup] Skipping attachment deletion — path does not match chat upload namespace",
        );
        continue;
      }
      try {
        const file = await objectStorageService.getObjectEntityFile(msg.content);
        await file.delete();
      } catch (err) {
        logger.warn({ err, tripId, messageId: msg.id }, "[chat-cleanup] Could not delete chat attachment");
      }
    }
  }

  try {
    await db.delete(tripMessagesTable).where(eq(tripMessagesTable.tripId, tripId));
    logger.info({ tripId, count: messages.length }, "[chat-cleanup] Deleted trip messages after trip ended");
  } catch (err) {
    logger.error({ err, tripId }, "[chat-cleanup] Failed to delete trip messages");
  }
}

/**
 * GET /api/fare-estimate
 * Returns a full FareBreakdown for the given (vehicleTypeId?, km, min).
 * No authentication required — this is a public pricing preview.
 */
router.get("/fare-estimate", async (req, res) => {
  const vehicleTypeId =
    typeof req.query.vehicleTypeId === "string" ? req.query.vehicleTypeId : null;
  const km = parseFloat(req.query.km as string);
  const min = parseFloat(req.query.min as string);
  // Pickup coordinates are optional. When supplied the server resolves the
  // weather surcharge for that location so the rider sees the same total
  // they'll be charged at completion. Missing/invalid coords skip the lookup.
  const lat = typeof req.query.lat === "string" ? parseFloat(req.query.lat) : NaN;
  const lng = typeof req.query.lng === "string" ? parseFloat(req.query.lng) : NaN;

  if (!Number.isFinite(km) || !Number.isFinite(min) || km < 0 || min < 0) {
    return res.status(400).json({ error: "km and min must be non-negative numbers" });
  }

  let vt = null;
  if (vehicleTypeId) {
    try {
      vt = await loadVehicleType(vehicleTypeId);
    } catch {
      return res.status(400).json({ error: "Invalid vehicleTypeId" });
    }
    if (!vt) {
      return res.status(404).json({ error: "Vehicle type not found" });
    }
  }

  const weather =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? await resolveWeatherSurcharge(lat, lng).catch(() => null)
      : null;

  // Resolve airport surcharge for the pickup point. Without a dropoff in the
  // estimate query we only consider the pickup side here; the request flow
  // re-resolves both sides once the dropoff is known.
  const airport = vehicleTypeId
    ? await resolveAirportSurcharge(
        vehicleTypeId,
        Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
        null,
      ).catch(() => null)
    : null;

  const breakdown = computeFareBreakdown({
    vehicleType: vt,
    distanceKm: km,
    durationMin: min,
    weather,
    airport,
  });

  // Internal math is in USD. Enrich with the platform's configured display
  // currency so clients can render the right symbol without knowing the
  // current exchange rates.
  const { enrichWithPlatformCurrency } = await import("../lib/displayAmount");
  const totalDisplay = await enrichWithPlatformCurrency(breakdown.total);
  return res.json({ breakdown, totalDisplay });
});

interface SerializedBid {
  id: string;
  driverName: string;
  driverInitial: string;
  driverPhotoUrl: string | null;
  rating: number;
  trips: number;
  vehicle: string;
  plate: string;
  etaMin: number;
  amount: number;
  currency: string;
  status: string;
  /** Server-converted display envelope so clients render the right
   * symbol+number without doing any FX math themselves. */
  amountDisplay: DisplayAmount;
}

export async function getRideWithBids(rideId: string) {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) return null;
  const bids = await db
    .select({
      bid: bidsTable,
      driver: usersTable,
      vehicle: vehiclesTable,
    })
    .from(bidsTable)
    .leftJoin(usersTable, eq(usersTable.id, bidsTable.driverId))
    .leftJoin(vehiclesTable, eq(vehiclesTable.userId, bidsTable.driverId))
    .where(eq(bidsTable.rideId, rideId))
    .orderBy(desc(bidsTable.createdAt));

  // Resolve the platform's effective display currency once per request
  // and attach server-converted envelopes so clients render the
  // displayed amount/symbol without doing any FX math themselves.
  const cfg = await getConfig(false);
  const displayCurrency = await resolveDisplayCurrency(cfg.displayCurrency ?? "USD");

  const serialized: SerializedBid[] = await Promise.all(
    bids.map(async ({ bid, driver, vehicle }) => ({
      id: bid.id,
      driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || "Driver" : "Driver",
      driverInitial: initialOf(driver?.firstName ?? "D"),
      driverPhotoUrl: bid.id === ride.acceptedBidId ? (driver?.photoUrl ?? null) : null,
      rating: driver ? parseFloat(driver.rating) : 4.9,
      trips: driver ? parseInt(driver.trips, 10) || 0 : 0,
      vehicle: vehicle ? `${vehicle.color} ${vehicle.make} ${vehicle.model}` : "Vehicle",
      plate: vehicle?.plate ?? "—",
      etaMin: bid.etaMin,
      amount: bid.amount,
      currency: FARE_CURRENCY,
      status: bid.status,
      amountDisplay: await enrichAmount(bid.amount, displayCurrency),
    })),
  );

  const finalAmountDisplay =
    ride.finalAmount != null ? await enrichAmount(ride.finalAmount, displayCurrency) : null;
  const fareBreakdownDisplay = await enrichFareBreakdown(
    ride.fareBreakdown as Record<string, unknown> | null,
    displayCurrency,
  );

  const enrichedRide = {
    ...ride,
    finalAmountDisplay,
    fareBreakdownDisplay,
  };

  return { ride: enrichedRide, bids: serialized };
}

/** Haversine distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * After a new shared ride is created, attempt to find a compatible bidding
 * shared ride and link them together under a sharedGroupId.
 *
 * Compatibility criteria (all must pass):
 *  1. Other ride is also isShared = true, status = 'bidding'
 *  2. Same vehicleTypeId (so pool capacity rules are consistent)
 *  3. No existing sharedGroupId (not already matched)
 *  4. Different rider (can't pool with yourself)
 *  5. Pickup coordinates within 10 km of each other
 *  6. Combined seatsRequested <= vehicle personCapacity
 */
async function tryPoolMatch(
  newRide: typeof ridesTable.$inferSelect,
  vehicleCapacity: number,
): Promise<string | null> {
  if (!newRide.vehicleTypeId) return null;

  const candidates = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.isShared, true),
        eq(ridesTable.status, "bidding"),
        eq(ridesTable.vehicleTypeId, newRide.vehicleTypeId),
        isNull(ridesTable.sharedGroupId),
        ne(ridesTable.riderId, newRide.riderId),
        ne(ridesTable.id, newRide.id),
      ),
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(20);

  for (const candidate of candidates) {
    const totalSeats = newRide.seatsRequested + candidate.seatsRequested;
    if (totalSeats > vehicleCapacity) continue;

    if (
      newRide.pickupLat != null &&
      newRide.pickupLng != null &&
      candidate.pickupLat != null &&
      candidate.pickupLng != null
    ) {
      const dist = haversineKm(
        newRide.pickupLat,
        newRide.pickupLng,
        candidate.pickupLat,
        candidate.pickupLng,
      );
      if (dist > 10) continue;
    }

    const groupId = randomUUID();
    await db
      .update(ridesTable)
      .set({ sharedGroupId: groupId, updatedAt: new Date() })
      .where(eq(ridesTable.id, candidate.id));
    await db
      .update(ridesTable)
      .set({ sharedGroupId: groupId, updatedAt: new Date() })
      .where(eq(ridesTable.id, newRide.id));

    emitToUser(candidate.riderId, "ride:matched", {
      rideId: candidate.id,
      sharedGroupId: groupId,
      coRidersCount: 2,
    });

    return groupId;
  }

  return null;
}

/** Fetch all sibling rides that share the same sharedGroupId, excluding the given rideId. */
async function getGroupSiblings(sharedGroupId: string, excludeRideId: string) {
  return db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.sharedGroupId, sharedGroupId),
        ne(ridesTable.id, excludeRideId),
      ),
    );
}

router.post("/rides", requireUser, async (req, res) => {
  const parsed = z
    .object({
      pickupLabel: z.string().min(1),
      pickupAddress: z.string().min(1),
      dropoffLabel: z.string().min(1),
      dropoffAddress: z.string().min(1),
      pickupLat: z.number().min(-90).max(90).optional(),
      pickupLng: z.number().min(-180).max(180).optional(),
      dropoffLat: z.number().min(-90).max(90).optional(),
      dropoffLng: z.number().min(-180).max(180).optional(),
      estimatedDistanceKm: z.number().positive().optional(),
      estimatedDurationMin: z.number().int().positive().optional(),
      routePolyline: z.string().max(20000).optional(),
      dropoffGooglePlaceId: z.string().max(200).optional(),
      initialFare: z.number().positive().max(100000).optional(),
      vehicleClass: z.string().min(1).max(40).optional(),
      vehicleTypeId: z.string().uuid().optional(),
      isShared: z.boolean().optional(),
      seatsRequested: z.number().int().min(1).max(8).optional(),
      wheelchairRequested: z.boolean().optional(),
      petRequested: z.boolean().optional(),
      assistRequested: z.boolean().optional(),
      paymentMethod: z.enum(["cash", "card"]).optional().default("cash"),
      // Optional coupon attached at request time. Re-validated at completion
      // before any redemption is recorded so a stale or revoked coupon never
      // discounts the actual fare.
      couponId: z.string().uuid().optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  // Check whether the pickup or dropoff falls inside any active restricted area.
  // Load all active restricted-area polygons in one query and partition in memory.
  const pickupLat = parsed.data.pickupLat;
  const pickupLng = parsed.data.pickupLng;
  const dropoffLat = parsed.data.dropoffLat;
  const dropoffLng = parsed.data.dropoffLng;
  if (
    (pickupLat !== undefined && pickupLng !== undefined) ||
    (dropoffLat !== undefined && dropoffLng !== undefined)
  ) {
    const allRestrictions = await db
      .select({ polygonJson: serviceAreasTable.polygonJson, restrictArea: restrictedAreasTable.restrictArea })
      .from(restrictedAreasTable)
      .innerJoin(serviceAreasTable, eq(serviceAreasTable.id, restrictedAreasTable.serviceAreaId))
      .where(and(eq(restrictedAreasTable.active, true), eq(serviceAreasTable.active, true)));

    if (pickupLat !== undefined && pickupLng !== undefined) {
      for (const { polygonJson, restrictArea } of allRestrictions) {
        if (restrictArea === "pickup" && pointInPolygon(pickupLat, pickupLng, polygonJson)) {
          return res.status(422).json({ error: "pickup_restricted", message: "Pickups are not allowed in this area. Please choose a different pickup location." });
        }
      }
    }
    if (dropoffLat !== undefined && dropoffLng !== undefined) {
      for (const { polygonJson, restrictArea } of allRestrictions) {
        if (restrictArea === "dropoff" && pointInPolygon(dropoffLat, dropoffLng, polygonJson)) {
          return res.status(422).json({ error: "dropoff_restricted", message: "Drop-offs are not allowed in this area. Please choose a different drop-off location." });
        }
      }
    }
  }

  // Cancel any active rides for this user
  const activeRidesForUser = await db
    .select({ id: ridesTable.id, acceptedDriverId: ridesTable.acceptedDriverId })
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.riderId, req.userId!),
        inArray(ridesTable.status, ["bidding", "driver_arriving", "in_progress"]),
      ),
    );
  await db
    .update(ridesTable)
    .set({ status: "cancelled", cancelledBy: "system", updatedAt: new Date() })
    .where(
      and(
        eq(ridesTable.riderId, req.userId!),
        inArray(ridesTable.status, ["bidding", "driver_arriving", "in_progress"]),
      ),
    );
  for (const { id, acceptedDriverId } of activeRidesForUser) {
    void cleanupTripMessages(id);
    // System-cancelled rides that already had an accepted driver shift the
    // driver's cancellation denominator (acceptedRidesCount). Drop the cache.
    invalidateDriverRates(acceptedDriverId);
  }

  let distance = parsed.data.estimatedDistanceKm;
  let duration = parsed.data.estimatedDurationMin;
  let polyline = parsed.data.routePolyline ?? null;

  if (
    parsed.data.pickupLat !== undefined &&
    parsed.data.pickupLng !== undefined &&
    parsed.data.dropoffLat !== undefined &&
    parsed.data.dropoffLng !== undefined &&
    (!distance || !duration || !polyline)
  ) {
    const r = await osrmRoute(
      { lat: parsed.data.pickupLat, lng: parsed.data.pickupLng },
      { lat: parsed.data.dropoffLat, lng: parsed.data.dropoffLng },
    );
    if (r) {
      distance = distance ?? r.distanceKm;
      duration = duration ?? r.durationMin;
      polyline = polyline ?? r.polyline;
    }
  }

  if (!distance) {
    if (
      parsed.data.pickupLat !== undefined &&
      parsed.data.pickupLng !== undefined &&
      parsed.data.dropoffLat !== undefined &&
      parsed.data.dropoffLng !== undefined
    ) {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(parsed.data.dropoffLat - parsed.data.pickupLat);
      const dLng = toRad(parsed.data.dropoffLng - parsed.data.pickupLng);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(parsed.data.pickupLat)) *
          Math.cos(toRad(parsed.data.dropoffLat)) *
          Math.sin(dLng / 2) ** 2;
      distance = Math.round(2 * R * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10;
    } else {
      distance = 5;
    }
  }
  if (!duration) duration = Math.max(6, Math.round(distance * 3));

  // Resolve the chosen service category so we can both stamp capability
  // flags onto the ride AND apply admin-configured pricing rules. The
  // category drives whether pool / accessibility / pet / assist requests
  // are valid in the first place — anything the rider asked for that the
  // category doesn't offer is silently dropped to avoid misleading drivers.
  // We also pin the vehicleTypeId on the ride so subsequent admin edits to
  // the type's pricing can't retroactively alter completed rides.
  let vehicleTypeRow: typeof vehicleTypesTable.$inferSelect | null = null;
  if (parsed.data.vehicleTypeId) {
    const [vt] = await db
      .select()
      .from(vehicleTypesTable)
      .where(eq(vehicleTypesTable.id, parsed.data.vehicleTypeId))
      .limit(1);
    if (vt) vehicleTypeRow = vt;
  }
  // Fall back to picking by classKey (or the active default) so older
  // clients that don't send a vehicleTypeId still get pricing applied.
  if (!vehicleTypeRow) {
    vehicleTypeRow = await pickVehicleType(parsed.data.vehicleClass ?? null);
  }

  const isShared = !!parsed.data.isShared && !!vehicleTypeRow?.poolEnabled;
  const wheelchairRequested =
    !!parsed.data.wheelchairRequested && !!vehicleTypeRow?.wheelchairAccess;
  const petRequested =
    !!parsed.data.petRequested && !!vehicleTypeRow?.petFriendly;
  const assistRequested =
    !!parsed.data.assistRequested && !!vehicleTypeRow?.assistAvailable;
  const seatsRequested = Math.max(
    1,
    Math.min(
      vehicleTypeRow?.personCapacity ?? 4,
      parsed.data.seatsRequested ?? 1,
    ),
  );

  const vehicleClass =
    vehicleTypeRow?.classKey ?? parsed.data.vehicleClass ?? null;

  // Resolve any active weather surcharge for the pickup point. Failures
  // (no key, network error, no rules) silently return null so pricing
  // proceeds without a surcharge.
  const weatherAtPickup = await resolveWeatherSurcharge(
    pickupLat ?? null,
    pickupLng ?? null,
  ).catch(() => null);

  // Pin the fare estimate so the rider's quote is preserved on the request
  // and so the receipt has a baseline if pricing config changes later.
  const airportAtRequest = await resolveAirportSurcharge(
    vehicleTypeRow?.id ?? null,
    pickupLat != null && pickupLng != null ? { lat: pickupLat, lng: pickupLng } : null,
    dropoffLat != null && dropoffLng != null
      ? { lat: dropoffLat, lng: dropoffLng }
      : null,
  ).catch(() => null);

  const fareEstimate = computeFareBreakdown({
    vehicleType: vehicleTypeRow,
    distanceKm: distance,
    durationMin: duration,
    seats: isShared ? seatsRequested : 1,
    weather: weatherAtPickup,
    airport: airportAtRequest,
  });

  // Validate the coupon (if any) and bake the projected discount into the
  // pinned fareBreakdown. Authoritative redemption still happens at /complete.
  let attachedCouponId: string | null = null;
  if (parsed.data.couponId) {
    const [coupon] = await db
      .select()
      .from(couponsTable)
      .where(eq(couponsTable.id, parsed.data.couponId))
      .limit(1);
    const riderCountryCode = await loadRiderCountryCode(req.userId!);
    const result = await validateCoupon({
      coupon: coupon ?? null,
      riderId: req.userId!,
      riderCountryCode,
      vehicleTypeId: vehicleTypeRow?.id ?? null,
      estimatedSubtotal: fareEstimate.total,
    });
    if (!result.ok) {
      return res.status(422).json({ error: "coupon_invalid", reason: result.code });
    }
    attachedCouponId = result.coupon.id;
    fareEstimate.couponCode = result.coupon.code;
    fareEstimate.couponDiscount = result.discount;
    const newTotal = Math.max(0, Math.round((fareEstimate.total - result.discount) * 100) / 100);
    fareEstimate.total = newTotal;
  }

  const [ride] = await db
    .insert(ridesTable)
    .values({
      riderId: req.userId!,
      pickupLabel: parsed.data.pickupLabel,
      pickupAddress: parsed.data.pickupAddress,
      dropoffLabel: parsed.data.dropoffLabel,
      dropoffAddress: parsed.data.dropoffAddress,
      pickupLat: parsed.data.pickupLat ?? null,
      pickupLng: parsed.data.pickupLng ?? null,
      dropoffLat: parsed.data.dropoffLat ?? null,
      dropoffLng: parsed.data.dropoffLng ?? null,
      routePolyline: polyline,
      estimatedDistanceKm: distance,
      estimatedDurationMin: duration,
      initialFare: parsed.data.initialFare ?? null,
      vehicleClass,
      vehicleTypeId: vehicleTypeRow?.id ?? null,
      isShared,
      seatsRequested,
      wheelchairRequested,
      petRequested,
      assistRequested,
      paymentMethod: parsed.data.paymentMethod,
      // Pin the estimate so the rider's quote is preserved on the request.
      fareBreakdown: fareEstimate,
      couponId: attachedCouponId,
      // Bidding posts auto-expire 30 seconds after creation if no offer is
      // accepted — matches the rider's countdown bar so client and server
      // agree on the deadline. The bidding-expiry job flips the ride to
      // cancelled past this point.
      biddingExpiresAt: new Date(Date.now() + 30 * 1000),
    })
    .returning();

  // Try to match this ride with another compatible pool request.
  let sharedGroupId: string | null = null;
  if (isShared) {
    const vehicleCapacity = vehicleTypeRow?.personCapacity ?? 4;
    sharedGroupId = await tryPoolMatch(ride, vehicleCapacity);
  }

  // Record dropoff as a recent place for this user (best-effort).
  if (parsed.data.dropoffLat !== undefined && parsed.data.dropoffLng !== undefined) {
    recordRecentPlace(req.userId!, {
      address: parsed.data.dropoffAddress,
      lat: parsed.data.dropoffLat,
      lng: parsed.data.dropoffLng,
      label: parsed.data.dropoffLabel === parsed.data.dropoffAddress ? "" : parsed.data.dropoffLabel,
      googlePlaceId: parsed.data.dropoffGooglePlaceId ?? null,
    }).catch(() => {});
  }

  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  // Re-fetch the ride to get the latest sharedGroupId (may have been set by tryPoolMatch).
  const [freshRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, ride.id)).limit(1);
  const finalRide = freshRide ?? ride;

  const ridePayload = {
    id: finalRide.id,
    riderName: rider?.firstName ?? "Rider",
    riderRating: rider ? parseFloat(rider.rating) : 4.9,
    pickup: { label: finalRide.pickupLabel, address: finalRide.pickupAddress },
    dropoff: { label: finalRide.dropoffLabel, address: finalRide.dropoffAddress },
    pickupLat: finalRide.pickupLat,
    pickupLng: finalRide.pickupLng,
    dropoffLat: finalRide.dropoffLat,
    dropoffLng: finalRide.dropoffLng,
    routePolyline: finalRide.routePolyline,
    distanceKm: finalRide.estimatedDistanceKm,
    durationMin: finalRide.estimatedDurationMin,
    suggestedFare: fareEstimate.total,
    fareModel: fareEstimate.fareModel,
    pool: fareEstimate.pool,
    // Rider's offered fare (inDrive-style). When present drivers see it as
    // the rider's offer instead of the algorithmic suggestion. Falls back
    // to suggestedFare when the rider didn't customize.
    initialFare: finalRide.initialFare,
    vehicleClass: finalRide.vehicleClass,
    vehicleTypeId: finalRide.vehicleTypeId,
    vehicleTypeName: vehicleTypeRow?.name ?? null,
    isShared: finalRide.isShared,
    seatsRequested: finalRide.seatsRequested,
    sharedGroupId: finalRide.sharedGroupId,
    wheelchairRequested: finalRide.wheelchairRequested,
    petRequested: finalRide.petRequested,
    assistRequested: finalRide.assistRequested,
    receivedAt: finalRide.createdAt.getTime(),
  };

  const rawRadius = parseFloat(process.env.DISPATCH_RADIUS_KM ?? "");
  const dispatchRadiusKm = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 15;

  // One row per driver — GROUP BY aggregates capabilities across all of a
  // driver's vehicles so each driver is evaluated exactly once and is not
  // incorrectly excluded because DISTINCT ON happened to pick a non-matching
  // vehicle row. BOOL_OR means "at least one vehicle supports this feature".
  const onlineDrivers = await db
    .select({
      userId: usersTable.id,
      expoPushToken: usersTable.expoPushToken,
      anyWheelchair: sql<boolean>`bool_or(${vehicleTypesTable.wheelchairAccess})`,
      anyPetFriendly: sql<boolean>`bool_or(${vehicleTypesTable.petFriendly})`,
      anyAssist: sql<boolean>`bool_or(${vehicleTypesTable.assistAvailable})`,
      anyPool: sql<boolean>`bool_or(${vehicleTypesTable.poolEnabled})`,
      maxPersonCapacity: sql<number | null>`max(${vehicleTypesTable.personCapacity})`,
      vehicleCategories: sql<string[]>`array_remove(array_agg(distinct ${vehicleTypesTable.vehicleCategory}), null)`,
    })
    .from(usersTable)
    .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
    .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
    .where(and(eq(usersTable.driverOnline, true), eq(usersTable.driverStatus, "approved")))
    .groupBy(usersTable.id, usersTable.expoPushToken);

  let dispatchTotal = onlineDrivers.length;
  let dispatchPassedCapability = 0;
  let dispatchMissingLocation = 0;
  let dispatchOutsideRadius = 0;
  let dispatchWithinRadius = 0;
  let dispatchReachedSocket = 0;
  let dispatchPushAttempted = 0;
  let dispatchUnreachable = 0;

  for (const { userId: driverId, expoPushToken, anyWheelchair, anyPetFriendly, anyAssist, anyPool, maxPersonCapacity, vehicleCategories } of onlineDrivers) {
    if (finalRide.vehicleTypeId && vehicleTypeRow) {
      if (!vehicleCategories.includes(vehicleTypeRow.vehicleCategory)) continue;
    }
    if (finalRide.wheelchairRequested && !anyWheelchair) continue;
    if (finalRide.petRequested && !anyPetFriendly) continue;
    if (finalRide.assistRequested && !anyAssist) continue;
    if (finalRide.isShared) {
      if (!anyPool) continue;
      if ((maxPersonCapacity ?? 0) < finalRide.seatsRequested) continue;
    }
    dispatchPassedCapability++;

    // Require a known live position — drivers with no recorded location are
    // excluded from this broadcast rather than assumed to be nearby.
    const driverPos = getDriverLivePosition(driverId);
    if (driverPos == null) {
      dispatchMissingLocation++;
      continue;
    }
    if (finalRide.pickupLat == null || finalRide.pickupLng == null) {
      dispatchMissingLocation++;
      continue;
    }
    const distKm = haversineKm(finalRide.pickupLat, finalRide.pickupLng, driverPos.lat, driverPos.lng);
    if (distKm > dispatchRadiusKm) {
      dispatchOutsideRadius++;
      continue;
    }
    dispatchWithinRadius++;

    if (isUserSocketConnected(driverId)) {
      emitToUser(driverId, "ride:new", ridePayload);
      // Named event for the bidding flow so the driver app can pop a
      // dedicated "name-your-price" modal instead of the standard
      // accept/decline sheet.
      if (finalRide.status === "bidding") {
        emitToUser(driverId, "bidding:request", ridePayload);
      }
      // Socket delivery is synchronous — the event either reaches the driver's
      // connected socket or it doesn't. Mark as delivered immediately.
      db.insert(rideDispatchLogsTable)
        .values({ rideId: finalRide.id, driverId, method: "socket", status: "delivered" })
        .then(() => invalidateDriverRates(driverId))
        .catch((err) => logger.warn({ err, driverId, rideId: finalRide.id }, "[rides] failed to log socket dispatch"));
      dispatchReachedSocket++;
    } else if (expoPushToken) {
      // Push delivery is async — Expo returns a receipt ID now and the actual
      // delivery is confirmed later via pollPushReceipts. Log as "queued" until
      // the receipt poll updates the status to "delivered" or "failed".
      sendPushFromTemplate(
        driverId,
        "driver_ride_request",
        "New ride request",
        `Pickup: ${finalRide.pickupLabel}`,
        { pickup: finalRide.pickupLabel, dropoff: finalRide.dropoffLabel },
        { type: "ride_request", rideId: finalRide.id },
        finalRide.id,
        "newTripRequest",
      ).then((result) => {
        const logStatus = result.status === "ok" ? "queued" : "failed";
        const failureReason = result.status !== "ok" ? (result.errorCode ?? "send_error") : null;
        db.insert(rideDispatchLogsTable)
          .values({ rideId: finalRide.id, driverId, method: "push", status: logStatus, failureReason })
          .catch((err) => logger.warn({ err, driverId, rideId: finalRide.id }, "[rides] failed to log push dispatch"));
      }).catch((err) => {
        logger.warn({ err, driverId, rideId: finalRide.id }, "[rides] push fallback failed for offline driver");
        db.insert(rideDispatchLogsTable)
          .values({ rideId: finalRide.id, driverId, method: "push", status: "failed", failureReason: String(err?.message ?? err) })
          .catch(() => {});
      });
      dispatchPushAttempted++;
    } else {
      logger.warn({ rideId: finalRide.id, driverId }, "[dispatch] driver unreachable — no socket connection and no push token");
      dispatchUnreachable++;
    }
  }

  logger.info(
    {
      rideId: finalRide.id,
      dispatchRadiusKm,
      total: dispatchTotal,
      passedCapability: dispatchPassedCapability,
      missingLocation: dispatchMissingLocation,
      outsideRadius: dispatchOutsideRadius,
      withinRadius: dispatchWithinRadius,
      reachedSocket: dispatchReachedSocket,
      pushAttempted: dispatchPushAttempted,
      unreachable: dispatchUnreachable,
    },
    "[dispatch] broadcast summary",
  );

  // Queued-ride socket broadcast: in addition to the standard ride:new
  // broadcast (sent to drivers WITHOUT an active trip), notify drivers
  // who currently HAVE an active trip whose dropoff is near this new
  // ride's pickup. They use the event to refresh their queued-rides
  // candidate list without waiting for the next 10s poll. Eligibility is
  // re-validated server-side at /driver/queued-requests time, so this is
  // purely a hint event — no state changes, no race conditions.
  if (finalRide.pickupLat != null && finalRide.pickupLng != null) {
    try {
      const cfg = await getConfig();
      if (cfg.queuedRidesEnabled !== false) {
        const radiusKm = cfg.queuedRidesRadiusKm ?? 3;
        const activeDrivers = await db
          .select({
            driverId: ridesTable.acceptedDriverId,
            dropoffLat: ridesTable.dropoffLat,
            dropoffLng: ridesTable.dropoffLng,
          })
          .from(ridesTable)
          .where(
            and(
              inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
              isNotNull(ridesTable.acceptedDriverId),
              isNotNull(ridesTable.dropoffLat),
              isNotNull(ridesTable.dropoffLng),
            ),
          );
        for (const d of activeDrivers) {
          if (!d.driverId || d.dropoffLat == null || d.dropoffLng == null) continue;
          const dist = haversineKm(
            d.dropoffLat,
            d.dropoffLng,
            finalRide.pickupLat,
            finalRide.pickupLng,
          );
          if (dist > radiusKm) continue;
          emitToUser(d.driverId, "queuedRideRequest", {
            rideId: finalRide.id,
            pickupAddress: finalRide.pickupAddress,
            distanceFromCurrentDropoffKm: Math.round(dist * 10) / 10,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, rideId: finalRide.id }, "[rides] queuedRideRequest broadcast failed");
    }
  }

  return res.status(201).json({ ride: { ...finalRide, bids: [], sharedGroupId: finalRide.sharedGroupId } });
});

router.get("/rides/active", requireUser, async (req, res) => {
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.riderId, req.userId!),
        inArray(ridesTable.status, [
          "bidding",
          "driver_arriving",
          "in_progress",
          "completed",
          "queued",
          "assigned_next",
        ]),
        or(ne(ridesTable.status, "completed"), isNull(ridesTable.ratingScore)),
      ),
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(1);
  if (!ride) return res.json({ ride: null });
  const data = await getRideWithBids(ride.id);

  // Compute co-riders count for shared rides so the rider sees context.
  let sharedRidersCount = 1;
  if (ride.sharedGroupId) {
    const siblings = await db
      .select({ id: ridesTable.id })
      .from(ridesTable)
      .where(eq(ridesTable.sharedGroupId, ride.sharedGroupId));
    sharedRidersCount = siblings.length;
  }

  return res.json({
    ride: data
      ? { ...data.ride, bids: data.bids, sharedGroupId: ride.sharedGroupId, sharedRidersCount }
      : null,
  });
});

router.get("/rides/:id", requireUser, async (req, res) => {
  const data = await getRideWithBids((req.params.id as string));
  if (!data) return res.status(404).json({ error: "not_found" });
  if (data.ride.riderId !== req.userId && data.ride.acceptedDriverId !== req.userId)
    return res.status(403).json({ error: "forbidden" });

  let sharedRidersCount = 1;
  if (data.ride.sharedGroupId) {
    const siblings = await db
      .select({ id: ridesTable.id })
      .from(ridesTable)
      .where(eq(ridesTable.sharedGroupId, data.ride.sharedGroupId));
    sharedRidersCount = siblings.length;
  }

  // For queued/assigned_next rides, surface a wait-time ETA equal to the
  // matched driver's CURRENT trip's remaining estimated duration. This lets
  // the rider UI display "Estimated pickup in ~N min" without a second call.
  let queuedEtaMin: number | undefined;
  if (
    (data.ride.status === "queued" || data.ride.status === "assigned_next") &&
    data.ride.previousTripId
  ) {
    const [prev] = await db
      .select({
        estimatedDurationMin: ridesTable.estimatedDurationMin,
        updatedAt: ridesTable.updatedAt,
        status: ridesTable.status,
      })
      .from(ridesTable)
      .where(eq(ridesTable.id, data.ride.previousTripId))
      .limit(1);
    if (prev && prev.status !== "completed") {
      const elapsedMin = prev.updatedAt
        ? (Date.now() - prev.updatedAt.getTime()) / 60_000
        : 0;
      queuedEtaMin = Math.max(
        1,
        Math.round((prev.estimatedDurationMin ?? 5) - elapsedMin),
      );
    }
  }

  return res.json({
    ride: { ...data.ride, bids: data.bids, sharedRidersCount, queuedEtaMin },
  });
});

/**
 * GET /rides/:id/contact
 * Returns the other party's phone number for a matched, active trip.
 * Only available to the ride's rider and accepted driver while the trip
 * is in driver_arriving or in_progress status.
 */
router.get("/rides/:id/contact", requireUser, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });

  const isRider = ride.riderId === req.userId;
  const isDriver = ride.acceptedDriverId === req.userId;
  if (!isRider && !isDriver) return res.status(403).json({ error: "forbidden" });

  if (!["driver_arriving", "in_progress"].includes(ride.status))
    return res.status(409).json({ error: "trip_not_active" });

  const otherUserId = isRider ? ride.acceptedDriverId : ride.riderId;
  if (!otherUserId) return res.status(404).json({ error: "contact_not_available" });

  const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherUserId)).limit(1);
  if (!other) return res.status(404).json({ error: "contact_not_available" });

  return res.json({ phone: other.phone });
});

router.post("/rides/:id/cancel", requireUser, async (req, res) => {
  // Allow a queued rider to cancel their own queued/assigned_next ride.
  // This path runs first so it covers the queue lifecycle before the
  // standard bidding/driver_arriving cancellation logic below.
  {
    const [pre] = await db
      .select()
      .from(ridesTable)
      .where(eq(ridesTable.id, (req.params.id as string)))
      .limit(1);
    if (
      pre &&
      pre.riderId === req.userId &&
      (pre.status === "queued" || pre.status === "assigned_next")
    ) {
      await releaseQueuedRideForRider(pre.id);
      const [updated] = await db
        .update(ridesTable)
        .set({
          status: "cancelled",
          cancelledBy: "rider",
          updatedAt: new Date(),
        })
        .where(eq(ridesTable.id, pre.id))
        .returning();
      emitToRide(pre.id, "ride:cancelled", { id: pre.id });
      return res.json({ ride: updated, cancellationFee: 0 });
    }
  }

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.riderId !== req.userId) return res.status(403).json({ error: "forbidden" });
  if (!["bidding", "driver_arriving"].includes(ride.status))
    return res.status(409).json({ error: "cannot_cancel" });
  // Compute cancellation fee against the pinned category. Rides cancelled
  // inside the grace window are free; outside it the configured charge sticks.
  const vt = await loadVehicleType(ride.vehicleTypeId);
  const cancellationFee = computeCancellationFee(vt, ride.createdAt, new Date());

  // Atomic conditional update — prevents racing with /accept or /start.
  const [updated] = await db
    .update(ridesTable)
    .set({
      status: "cancelled",
      cancelledBy: "rider",
      cancellationFee: cancellationFee > 0 ? cancellationFee : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ridesTable.id, (req.params.id as string)),
        inArray(ridesTable.status, ["bidding", "driver_arriving"]),
      ),
    )
    .returning();
  if (!updated) return res.status(409).json({ error: "cannot_cancel" });
  emitToRide(ride.id, "ride:cancelled", { id: ride.id, cancellationFee });
  if (ride.acceptedDriverId) {
    emitToUser(ride.acceptedDriverId, "ride:cancelled", { id: ride.id, cancellationFee });
    // The cancellation denominator (acceptedRidesCount) for this driver
    // is unchanged in count but the cancelled-by-driver numerator is not
    // affected by rider cancels. We still invalidate so the next read
    // recomputes against the latest data without taking any chances.
    invalidateDriverRates(ride.acceptedDriverId);
  }
  void cleanupTripMessages(ride.id);
  return res.json({ ride: updated, cancellationFee });
});

/**
 * GET /cancellation-reasons?role=driver|rider
 * Returns the active, admin-managed cancellation reasons that apply to the
 * requested role. Driver and rider apps fetch this when prompting the user
 * to pick a reason at cancel time.
 */
router.get("/cancellation-reasons", requireUser, async (req, res) => {
  const role = req.query.role === "driver" ? "driver" : "rider";
  const reasons = await db
    .select({
      id: cancellationReasonsTable.id,
      text: cancellationReasonsTable.text,
    })
    .from(cancellationReasonsTable)
    .where(
      and(
        eq(cancellationReasonsTable.active, true),
        inArray(cancellationReasonsTable.appliesTo, [role, "both"]),
      ),
    )
    .orderBy(cancellationReasonsTable.createdAt);
  return res.json({ reasons });
});

/**
 * POST /rides/:id/cancel-driver
 * Driver-initiated cancellation of an accepted ride. Stamps cancelled_by
 * = 'driver' and the supplied reason, emits ride:cancelled to the rider,
 * and sends a push notification. Allowed while the ride is in
 * driver_arriving status (i.e. the driver has accepted but not started
 * the trip). For shared/pool trips the cancellation cascades to all
 * sibling rides in the group.
 */
router.post("/rides/:id/cancel-driver", requireUser, async (req, res) => {
  const parsed = z
    .object({
      reasonId: z.string().uuid().optional(),
      reasonText: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, (req.params.id as string)))
    .limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.acceptedDriverId !== req.userId)
    return res.status(403).json({ error: "forbidden" });
  if (ride.status !== "driver_arriving")
    return res.status(409).json({ error: "cannot_cancel" });

  // Resolve the reason text: prefer the admin-managed reason label when an
  // id is supplied (validates that it exists and applies to drivers); fall
  // back to the free-form text the driver typed; null if neither was sent.
  let reasonText: string | null = parsed.data.reasonText ?? null;
  if (parsed.data.reasonId) {
    const [r] = await db
      .select()
      .from(cancellationReasonsTable)
      .where(eq(cancellationReasonsTable.id, parsed.data.reasonId))
      .limit(1);
    if (
      !r ||
      !r.active ||
      (r.appliesTo !== "driver" && r.appliesTo !== "both")
    ) {
      return res.status(400).json({ error: "invalid_reason" });
    }
    reasonText = r.text;
  }

  // Atomic conditional update — prevents racing with /start or rider /cancel.
  const [updated] = await db
    .update(ridesTable)
    .set({
      status: "cancelled",
      cancelledBy: "driver",
      cancellationReason: reasonText,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ridesTable.id, ride.id),
        eq(ridesTable.status, "driver_arriving"),
        eq(ridesTable.acceptedDriverId, req.userId!),
      ),
    )
    .returning();
  if (!updated) return res.status(409).json({ error: "cannot_cancel" });

  // Driver cancelled their current trip — release any queued next-ride so
  // it can be re-bid by other drivers. Fire-and-forget; failure is logged
  // inside the helper and shouldn't block the cancel response.
  void releaseQueuedRidesForDriver(req.userId!, "current_cancelled");

  // Notify the rider over socket and push.
  emitToRide(ride.id, "ride:cancelled", {
    id: ride.id,
    cancelledBy: "driver",
    reason: reasonText,
  });
  void sendPushFromTemplate(
    ride.riderId,
    "rider_ride_cancelled_by_driver",
    "Your driver cancelled",
    reasonText
      ? `Your driver cancelled the ride: ${reasonText}. Please request a new ride.`
      : "Your driver cancelled the ride. Please request a new ride.",
    { reason: reasonText ?? "" },
    { type: "ride_cancelled", rideId: ride.id, cancelledBy: "driver" },
    ride.id,
    "userApp",
  );

  // Cascade cancellation to sibling rides in a shared/pool group.
  if (ride.sharedGroupId) {
    const siblings = await getGroupSiblings(ride.sharedGroupId, ride.id);
    for (const sibling of siblings) {
      if (sibling.status !== "driver_arriving") continue;
      const [sibUpdated] = await db
        .update(ridesTable)
        .set({
          status: "cancelled",
          cancelledBy: "driver",
          cancellationReason: reasonText,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ridesTable.id, sibling.id),
            eq(ridesTable.status, "driver_arriving"),
          ),
        )
        .returning();
      if (!sibUpdated) continue;
      emitToRide(sibling.id, "ride:cancelled", {
        id: sibling.id,
        cancelledBy: "driver",
        reason: reasonText,
      });
      void sendPushFromTemplate(
        sibling.riderId,
        "rider_ride_cancelled_by_driver",
        "Your driver cancelled",
        reasonText
          ? `Your driver cancelled the ride: ${reasonText}. Please request a new ride.`
          : "Your driver cancelled the ride. Please request a new ride.",
        { reason: reasonText ?? "" },
        { type: "ride_cancelled", rideId: sibling.id, cancelledBy: "driver" },
        sibling.id,
        "userApp",
      );
      void cleanupTripMessages(sibling.id);
    }
  }

  void cleanupTripMessages(ride.id);
  // Bust the cached driverStats so the cancellation rate displayed in the
  // admin dashboard and the driver's profile reflects this cancel right
  // away instead of waiting for the 5-minute cache to expire.
  invalidateDriverRates(req.userId!);
  return res.json({ ride: updated });
});

router.post("/rides/:id/accept", requireUser, async (req, res) => {
  const parsed = z.object({ bidId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const result = await acceptBid({
    rideId: req.params.id as string,
    bidId: parsed.data.bidId,
    expectedRiderId: req.userId!,
  });
  if (!result.ok) {
    const statusCode =
      result.error === "not_found" || result.error === "bid_not_found"
        ? 404
        : result.error === "forbidden"
          ? 403
          : 409;
    return res.status(statusCode).json({ error: result.error });
  }

  const { ride: updated, bid, siblings } = result;
  for (const sibling of siblings) {
    emitToRide(sibling.id, "ride:accepted", { ride: sibling, bidId: bid.id });
    emitToUser(sibling.riderId, "ride:accepted", { rideId: sibling.id, bidId: bid.id });
  }
  const data = await getRideWithBids(updated.id);
  emitToRide(updated.id, "ride:accepted", { ride: updated, bidId: bid.id });
  emitToUser(bid.driverId, "ride:accepted", { rideId: updated.id, bidId: bid.id });
  return res.json({ ride: data ? { ...data.ride, bids: data.bids } : updated });
});

router.post("/rides/:id/start", requireUser, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.acceptedDriverId !== req.userId) return res.status(403).json({ error: "forbidden" });
  const [updated] = await db
    .update(ridesTable)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.status, "driver_arriving")))
    .returning();
  if (!updated) return res.status(409).json({ error: "invalid_state" });

  // Cascade start to sibling rides in the shared group.
  if (ride.sharedGroupId) {
    const siblings = await getGroupSiblings(ride.sharedGroupId, ride.id);
    for (const sibling of siblings) {
      if (sibling.status !== "driver_arriving") continue;
      await db
        .update(ridesTable)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(ridesTable.id, sibling.id));
      emitToRide(sibling.id, "ride:status", { id: sibling.id, status: "in_progress" });
    }
  }

  emitToRide(ride.id, "ride:status", { id: ride.id, status: "in_progress" });
  // Return the trip in the same shape `/driver/trip` returns so the driver
  // app can apply the new state to its UI immediately without a refetch.
  return res.json({ ride: updated, trip: await buildDriverTripPayload(updated) });
});

router.post("/rides/:id/complete", requireUser, async (req, res) => {
  const parsed = z
    .object({
      // Optional in-transit waiting reported by the driver. Billed per-min
      // (rounded up) at the configured in_transit_waiting_fee_per_min.
      waitingMinutes: z.number().min(0).max(240).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.acceptedDriverId !== req.userId && ride.riderId !== req.userId)
    return res.status(403).json({ error: "forbidden" });

  // Status guard: only an in-progress ride can transition to completed.
  // Idempotent for already-completed rides — but we still re-run referral
  // distribution so a transient earlier failure can heal on retry. The
  // unique (ride_id, level, from_user_id) index makes this a no-op when
  // everything was already credited.
  // Critically, this runs BEFORE the coupon redemption transaction below so
  // a /complete call against a cancelled ride can never insert a redemption
  // row or bump coupons.totalUsed.
  if (ride.status === "completed") {
    // Retry-heal a transient earlier failure on a ride that completed AFTER
    // the referrals feature rolled out. The cutoff is the timestamp the
    // referrals migration was created, so historical pre-feature rides can
    // never be retroactively credited even if the initial distribution
    // failed entirely (zero rows). The unique
    // (ride_id, level, from_user_id) index makes a successful prior
    // distribution a no-op on retry.
    const retryAmount = ride.finalAmount ?? null;
    const completedAt = ride.updatedAt ? ride.updatedAt.getTime() : 0;
    if (
      retryAmount &&
      retryAmount > 0 &&
      completedAt >= REFERRALS_FEATURE_CUTOFF_MS
    ) {
      try {
        await distributeReferralRewards({
          rideId: ride.id,
          payerUserId: ride.riderId,
          rideAmount: retryAmount,
        });
        if (ride.acceptedDriverId) {
          await distributeReferralRewards({
            rideId: ride.id,
            payerUserId: ride.acceptedDriverId,
            rideAmount: retryAmount,
          });
        }
      } catch (err) {
        req.log.warn(
          { err, rideId: ride.id },
          "[referrals] retry distribution on already-completed ride failed",
        );
      }
    }
    if (ride.acceptedDriverId) {
      try {
        await recordTripForPromotions({
          ride: {
            id: ride.id,
            acceptedDriverId: ride.acceptedDriverId,
            vehicleTypeId: ride.vehicleTypeId,
            pickupLat: ride.pickupLat ?? null,
            pickupLng: ride.pickupLng ?? null,
          },
          completedAt: ride.updatedAt ?? new Date(),
        });
      } catch (err) {
        req.log.warn(
          { err, rideId: ride.id },
          "[promotions] retry promotion record on already-completed ride failed",
        );
      }
    }
    return res.json({ ride });
  }
  if (ride.status !== "in_progress")
    return res.status(409).json({ error: "invalid_state" });

  // Resolve the agreed bid amount (the inDrive-style negotiated price).
  let bidAmount = ride.finalAmount ?? null;
  if (bidAmount == null && ride.acceptedBidId) {
    const [b] = await db.select().from(bidsTable).where(eq(bidsTable.id, ride.acceptedBidId)).limit(1);
    if (b) bidAmount = b.amount;
  }

  const vt = await loadVehicleType(ride.vehicleTypeId);
  const waitingMin = Math.max(
    0,
    parsed.data.waitingMinutes ?? ride.inTransitWaitingMin ?? 0,
  );

  // Re-resolve weather at completion so a rider who started during a storm
  // doesn't get billed extra after it cleared (and vice-versa). Pickup-side
  // — weather is keyed off the place where the trip began.
  const completionWeather = await resolveWeatherSurcharge(
    ride.pickupLat ?? null,
    ride.pickupLng ?? null,
  ).catch(() => null);
  const completionAirport = await resolveAirportSurcharge(
    ride.vehicleTypeId,
    ride.pickupLat != null && ride.pickupLng != null
      ? { lat: ride.pickupLat, lng: ride.pickupLng }
      : null,
    ride.dropoffLat != null && ride.dropoffLng != null
      ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
      : null,
  ).catch(() => null);

  let breakdown: FareBreakdown | null = null;
  let amount: number | null = ride.finalAmount;
  if (bidAmount != null) {
    breakdown = buildFinalFareBreakdown(
      vt,
      bidAmount,
      ride.estimatedDistanceKm,
      ride.estimatedDurationMin,
      waitingMin,
      new Date(),
      1,
      completionWeather,
      completionAirport,
    );
    amount = breakdown.total;
  }

  // Apply the rider's coupon (if any) atomically: re-validate caps, insert
  // a redemption row, increment the global counter, and discount the metered
  // fare — all in a single transaction so concurrent completions can't
  // exceed usageLimitTotal or usageLimitPerUser. If validation fails (coupon
  // disabled, expired, cap reached) we complete the trip without a discount
  // and log a warning rather than blocking the driver.
  let appliedCouponDiscount: number | null = null;
  let appliedCouponId: string | null = null;
  if (ride.couponId && breakdown != null) {
    try {
      await db.transaction(async (tx) => {
        const [coupon] = await tx
          .select()
          .from(couponsTable)
          .where(eq(couponsTable.id, ride.couponId!))
          .for("update")
          .limit(1);
        if (!coupon || !coupon.active) {
          throw new Error("coupon_not_redeemable");
        }
        const now = new Date();
        if (coupon.validFrom && now < coupon.validFrom) throw new Error("coupon_not_redeemable");
        if (coupon.validUntil && now > coupon.validUntil) throw new Error("coupon_not_redeemable");
        if (coupon.usageLimitTotal != null && coupon.totalUsed >= coupon.usageLimitTotal) {
          throw new Error("coupon_not_redeemable");
        }
        if (coupon.usageLimitPerUser != null) {
          const [{ value } = { value: 0 }] = await tx
            .select({ value: sql<number>`count(*)::int` })
            .from(couponRedemptionsTable)
            .where(
              and(
                eq(couponRedemptionsTable.couponId, coupon.id),
                eq(couponRedemptionsTable.userId, ride.riderId),
              ),
            );
          if (Number(value) >= coupon.usageLimitPerUser) {
            throw new Error("coupon_not_redeemable");
          }
        }
        if (coupon.minTripAmount != null && breakdown!.total < coupon.minTripAmount) {
          throw new Error("coupon_not_redeemable");
        }
        const discount = computeCouponDiscount(coupon, breakdown!.total);
        if (discount <= 0) throw new Error("coupon_not_redeemable");

        await tx.insert(couponRedemptionsTable).values({
          couponId: coupon.id,
          userId: ride.riderId,
          rideId: ride.id,
          discountAmount: discount,
        });
        await tx
          .update(couponsTable)
          .set({ totalUsed: sql`${couponsTable.totalUsed} + 1`, updatedAt: now })
          .where(eq(couponsTable.id, coupon.id));

        appliedCouponDiscount = discount;
        appliedCouponId = coupon.id;
        breakdown!.couponCode = coupon.code;
        breakdown!.couponDiscount = discount;
        breakdown!.total = Math.max(0, Math.round((breakdown!.total - discount) * 100) / 100);
      });
      amount = breakdown.total;
    } catch (err) {
      req.log.warn(
        { err, rideId: ride.id, couponId: ride.couponId },
        "[coupons] completion-time validation failed — completing without discount",
      );
    }
  }

  // Atomic completion + queued-ride activation. Doing both inside ONE
  // transaction guarantees that we never expose a window where the trip is
  // marked completed but the queued ride hasn't yet been promoted (or
  // vice-versa). If the queued activation throws, the completion update
  // also rolls back so the system stays consistent.
  let updated: typeof ridesTable.$inferSelect | null = null;
  let queuedActivated: { activatedRideId: string; rideStatus: string } | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(ridesTable)
        .set({
          status: "completed",
          finalAmount: amount ?? null,
          inTransitWaitingMin: waitingMin,
          fareBreakdown: breakdown ?? ride.fareBreakdown ?? null,
          couponId: appliedCouponId,
          couponDiscount: appliedCouponDiscount,
          updatedAt: new Date(),
        })
        .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.status, "in_progress")))
        .returning();
      if (!u) return { updated: null, queuedActivated: null };
      const qa = ride.acceptedDriverId
        ? await activateQueuedRideAfterCompletionTx(tx, ride.acceptedDriverId, ride.id)
        : null;
      return { updated: u, queuedActivated: qa };
    });
    updated = result.updated;
    queuedActivated = result.queuedActivated;
  } catch (err) {
    req.log.error({ err, rideId: ride.id }, "[complete] atomic completion+activation failed");
    return res.status(500).json({ error: "completion_failed" });
  }
  if (!updated) {
    if ((ride.status as string) === "completed") return res.json({ ride });
    return res.status(409).json({ error: "invalid_state" });
  }

  if (ride.acceptedDriverId && amount) {
    const existing = await db
      .select({ id: earningsTable.id })
      .from(earningsTable)
      .where(eq(earningsTable.rideId, ride.id))
      .limit(1);
    if (existing.length === 0) {
      const [rider] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, ride.riderId))
        .limit(1);
      await db.insert(earningsTable).values({
        driverId: ride.acceptedDriverId,
        rideId: ride.id,
        amount,
        riderName: rider?.firstName ?? "Rider",
        pickupAddress: ride.pickupAddress,
        dropoffAddress: ride.dropoffAddress,
      });

      if (vt?.commissionPercent) {
        const now = new Date();
        const [activeExemption] = await db
          .select()
          .from(commissionExemptionsTable)
          .where(
            and(
              eq(commissionExemptionsTable.driverId, ride.acceptedDriverId),
              lte(commissionExemptionsTable.startsAt, now),
              gte(commissionExemptionsTable.expiresAt, now),
            ),
          )
          .limit(1);
        if (activeExemption) {
          logger.info(
            { driverId: ride.acceptedDriverId, rideId: ride.id, exemptionId: activeExemption.id },
            "[wallet] commission deduction skipped — active exemption",
          );
        } else {
          const commissionAmount = Math.round(amount * (vt.commissionPercent / 100) * 100) / 100;
          if (commissionAmount > 0) {
            await db.transaction(async (tx) => {
              // Idempotency: skip if a commission_deduction row already exists
              // for this ride (handles /complete retries even when the
              // earnings-row guard above misses).
              const [dupe] = await tx
                .select({ id: walletTransactionsTable.id })
                .from(walletTransactionsTable)
                .where(
                  and(
                    eq(walletTransactionsTable.rideId, ride.id),
                    eq(walletTransactionsTable.type, "commission_deduction"),
                  ),
                )
                .limit(1);
              if (dupe) return;

              await tx.insert(walletTransactionsTable).values({
                driverId: ride.acceptedDriverId!,
                type: "commission_deduction",
                amount: -commissionAmount,
                rideId: ride.id,
                note: `Commission ${vt!.commissionPercent}% on ${ride.paymentMethod} ride`,
              });
              await tx
                .update(usersTable)
                .set({
                  walletBalance: sql`(${usersTable.walletBalance}::numeric - ${commissionAmount})::text`,
                })
                .where(eq(usersTable.id, ride.acceptedDriverId!));
            });
          }
        }
      }
    }
  }

  // Complete all sibling rides in the shared group. Each sibling records its
  // own earnings entry (per-seat fair split — each rider pays their own fare).
  if (ride.sharedGroupId && ride.acceptedDriverId) {
    const siblings = await getGroupSiblings(ride.sharedGroupId, ride.id);
    for (const sibling of siblings) {
      if (sibling.status !== "in_progress") continue;

      // Determine this sibling's fare — build a final breakdown for each to
      // respect their specific vehicle type, distance/duration, and seat count.
      let siblingBidAmount = sibling.finalAmount ?? null;
      if (siblingBidAmount == null && sibling.acceptedBidId) {
        const [sb] = await db.select().from(bidsTable).where(eq(bidsTable.id, sibling.acceptedBidId)).limit(1);
        if (sb) siblingBidAmount = sb.amount;
      }
      // If bidAmount is still null, we might need to fall back to something,
      // but in this flow there should be an accepted bid.
      const sVt = await loadVehicleType(sibling.vehicleTypeId);
      const sWeather = await resolveWeatherSurcharge(
        sibling.pickupLat ?? null,
        sibling.pickupLng ?? null,
      ).catch(() => null);
      const sAirport = await resolveAirportSurcharge(
        sibling.vehicleTypeId,
        sibling.pickupLat != null && sibling.pickupLng != null
          ? { lat: sibling.pickupLat, lng: sibling.pickupLng }
          : null,
        sibling.dropoffLat != null && sibling.dropoffLng != null
          ? { lat: sibling.dropoffLat, lng: sibling.dropoffLng }
          : null,
      ).catch(() => null);
      const sBreakdown = siblingBidAmount != null ? buildFinalFareBreakdown(
        sVt,
        siblingBidAmount,
        sibling.estimatedDistanceKm,
        sibling.estimatedDurationMin,
        sibling.inTransitWaitingMin,
        new Date(),
        1,
        sWeather,
        sAirport,
      ) : null;
      const siblingAmount = sBreakdown?.total ?? sibling.finalAmount ?? sibling.initialFare ?? 0;

      await db
        .update(ridesTable)
        .set({
          status: "completed",
          finalAmount: siblingAmount,
          fareBreakdown: sBreakdown ?? sibling.fareBreakdown ?? null,
          updatedAt: new Date()
        })
        .where(eq(ridesTable.id, sibling.id));

      const existingSiblingEarning = await db
        .select({ id: earningsTable.id })
        .from(earningsTable)
        .where(eq(earningsTable.rideId, sibling.id))
        .limit(1);
      if (existingSiblingEarning.length === 0 && siblingAmount) {
        const [siblingRider] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, sibling.riderId))
          .limit(1);
        await db.insert(earningsTable).values({
          driverId: ride.acceptedDriverId,
          rideId: sibling.id,
          amount: siblingAmount,
          riderName: siblingRider?.firstName ?? "Rider",
          pickupAddress: sibling.pickupAddress,
          dropoffAddress: sibling.dropoffAddress,
        });

        if (sVt?.commissionPercent) {
          const now = new Date();
          const [siblingExemption] = await db
            .select()
            .from(commissionExemptionsTable)
            .where(
              and(
                eq(commissionExemptionsTable.driverId, ride.acceptedDriverId),
                lte(commissionExemptionsTable.startsAt, now),
                gte(commissionExemptionsTable.expiresAt, now),
              ),
            )
            .limit(1);
          if (siblingExemption) {
            logger.info(
              { driverId: ride.acceptedDriverId, rideId: sibling.id, exemptionId: siblingExemption.id },
              "[wallet] commission deduction skipped for sibling — active exemption",
            );
          } else {
            const siblingCommission = Math.round(siblingAmount * (sVt.commissionPercent / 100) * 100) / 100;
            if (siblingCommission > 0) {
              await db.transaction(async (tx) => {
                const [dupe] = await tx
                  .select({ id: walletTransactionsTable.id })
                  .from(walletTransactionsTable)
                  .where(
                    and(
                      eq(walletTransactionsTable.rideId, sibling.id),
                      eq(walletTransactionsTable.type, "commission_deduction"),
                    ),
                  )
                  .limit(1);
                if (dupe) return;
                await tx.insert(walletTransactionsTable).values({
                  driverId: ride.acceptedDriverId!,
                  type: "commission_deduction",
                  amount: -siblingCommission,
                  rideId: sibling.id,
                  note: `Commission ${sVt.commissionPercent}% on ${sibling.paymentMethod} ride`,
                });
                await tx
                  .update(usersTable)
                  .set({
                    walletBalance: sql`(${usersTable.walletBalance}::numeric - ${siblingCommission})::text`,
                  })
                  .where(eq(usersTable.id, ride.acceptedDriverId!));
              });
            }
          }
        }
      }

      // Distribute referral rewards for this sibling on both the rider's and
      // the driver's uplines. Idempotent via the unique
      // (ride_id, level, from_user_id) constraint and wrapped in try/catch so
      // a referral failure never blocks completion.
      if (siblingAmount && siblingAmount > 0) {
        try {
          await distributeReferralRewards({
            rideId: sibling.id,
            payerUserId: sibling.riderId,
            rideAmount: siblingAmount,
          });
          if (ride.acceptedDriverId) {
            await distributeReferralRewards({
              rideId: sibling.id,
              payerUserId: ride.acceptedDriverId,
              rideAmount: siblingAmount,
            });
          }
        } catch (err) {
          logger.error(
            { err, rideId: sibling.id },
            "[referrals] sibling distribution failed",
          );
        }
      }

      // Driver-promotion tracking for the sibling completion. try/catch so
      // a promotion failure never rolls back the ride completion.
      if (ride.acceptedDriverId) {
        try {
          await recordTripForPromotions({
            ride: {
              id: sibling.id,
              acceptedDriverId: ride.acceptedDriverId,
              vehicleTypeId: sibling.vehicleTypeId,
              pickupLat: sibling.pickupLat ?? null,
              pickupLng: sibling.pickupLng ?? null,
            },
            completedAt: new Date(),
          });
        } catch (err) {
          req.log.warn(
            { err, rideId: sibling.id },
            "[promotions] sibling record failed",
          );
        }
      }

      emitToRide(sibling.id, "ride:status", {
        id: sibling.id,
        status: "completed",
        finalAmount: siblingAmount,
        fareBreakdown: sBreakdown,
      });
      emitToUser(sibling.riderId, "ride:completed", { id: sibling.id });
      void cleanupTripMessages(sibling.id);
    }
  }

  // Distribute 3-level referral rewards. The task requires both a referred
  // RIDER and a referred DRIVER to generate upline credit on every completed
  // ride, so we run the distributor against each chain independently. The
  // unique (ride_id, level, from_user_id) constraint scopes idempotency per
  // payer, so the rider's and driver's uplines never collide. Wrapped in
  // try/catch so a referral failure never rolls back the ride completion.
  if (amount && amount > 0) {
    try {
      await distributeReferralRewards({
        rideId: ride.id,
        payerUserId: ride.riderId,
        rideAmount: amount,
      });
    } catch (err) {
      logger.error(
        { err, rideId: ride.id, side: "rider" },
        "[referrals] distribution failed",
      );
    }
    if (ride.acceptedDriverId) {
      try {
        await distributeReferralRewards({
          rideId: ride.id,
          payerUserId: ride.acceptedDriverId,
          rideAmount: amount,
        });
      } catch (err) {
        logger.error(
          { err, rideId: ride.id, side: "driver" },
          "[referrals] distribution failed",
        );
      }
    }
  }

  // Driver-promotion tracking for the main ride completion. Wrapped so any
  // promotion failure never blocks the ride from being reported as completed.
  if (ride.acceptedDriverId) {
    try {
      await recordTripForPromotions({
        ride: {
          id: ride.id,
          acceptedDriverId: ride.acceptedDriverId,
          vehicleTypeId: ride.vehicleTypeId,
          pickupLat: ride.pickupLat ?? null,
          pickupLng: ride.pickupLng ?? null,
        },
        completedAt: new Date(),
      });
    } catch (err) {
      req.log.warn(
        { err, rideId: ride.id },
        "[promotions] main record failed",
      );
    }
  }

  emitToRide(ride.id, "ride:status", {
    id: ride.id,
    status: "completed",
    finalAmount: amount,
    fareBreakdown: breakdown,
  });
  if (ride.acceptedDriverId)
    emitToUser(ride.acceptedDriverId, "ride:completed", { id: ride.id });
  void cleanupTripMessages(ride.id);

  // Auto-disable the driver's destination mode if this completed trip
  // brought them within the configured match radius. Best-effort — never
  // blocks the response.
  if (ride.acceptedDriverId) {
    try {
      const { maybeAutoDisableAfterCompletion } = await import(
        "../lib/destinationMode"
      );
      const result = await maybeAutoDisableAfterCompletion(
        ride.acceptedDriverId,
        {
          id: ride.id,
          dropoffLat: ride.dropoffLat ?? null,
          dropoffLng: ride.dropoffLng ?? null,
        },
      );
      if (result.deactivated) {
        emitToUser(ride.acceptedDriverId, "destinationMode:deactivated", {
          reason: result.reason ?? "trip_completed",
          rideId: ride.id,
        });
      }
    } catch (err) {
      req.log.warn({ err, rideId: ride.id }, "[destinationMode] auto-disable failed");
    }
  }

  // Activation already happened inside the completion transaction above —
  // here we only emit the resulting socket events outside the transaction.
  if (ride.acceptedDriverId) {
    if (queuedActivated) {
      emitToUser(ride.acceptedDriverId, "queuedRideActivated", {
        rideId: queuedActivated.activatedRideId,
        previousTripId: ride.id,
      });
      emitToRide(queuedActivated.activatedRideId, "queuedRideActivated", {
        rideId: queuedActivated.activatedRideId,
        previousTripId: ride.id,
      });
    }
    // Always notify the driver that the previous trip is finished, so the
    // mobile app can switch its UI even if no queued ride was waiting.
    emitToUser(ride.acceptedDriverId, "currentTripCompleted", {
      rideId: ride.id,
      hasQueuedRide: !!queuedActivated,
      queuedRideId: queuedActivated?.activatedRideId ?? null,
    });
  }

  // Return the trip in `/driver/trip` shape so the driver app can apply the
  // completed state to its UI immediately without a refetch.
  return res.json({
    ride: updated,
    trip: await buildDriverTripPayload(updated),
    queuedActivated,
  });
});

/**
 * Builds the absolute base URL the rider should share. Prefers the public
 * Replit domain (production / dev preview), falling back to whatever the
 * proxy reports via x-forwarded-host. Always returns the URL **without** a
 * trailing slash.
 */
function publicBaseUrl(req: import("express").Request): string {
  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) {
    const first = replitDomains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const replitDev = process.env["REPLIT_DEV_DOMAIN"];
  if (replitDev) return `https://${replitDev}`;
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ??
    req.protocol ??
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
    req.headers.host ??
    "localhost";
  return `${proto}://${host}`;
}

/**
 * POST /rides/:id/share
 * Mints (lazily) and returns a public share token + URL the rider can send
 * to friends/family so they can follow the live trip on the web. The token
 * is only generated for the rider that owns the ride and only while the
 * ride is in an active state (driver_arriving or in_progress). Once minted
 * the token is reused for the lifetime of the ride.
 */
router.post("/rides/:id/share", requireUser, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.riderId !== req.userId) return res.status(403).json({ error: "forbidden" });
  if (!["driver_arriving", "in_progress"].includes(ride.status))
    return res.status(409).json({ error: "trip_not_active" });

  let token = ride.shareToken;
  if (!token) {
    // 22-char base64url token (~128 bits of entropy). Long enough that the
    // URL is unguessable but still short enough to paste into a SMS.
    token = randomUUID().replace(/-/g, "");
    await db
      .update(ridesTable)
      .set({ shareToken: token, updatedAt: new Date() })
      .where(eq(ridesTable.id, ride.id));
  }

  const url = `${publicBaseUrl(req)}/api/track/${token}`;
  return res.json({ token, url });
});

/**
 * GET /track/:token/data
 * Public, unauthenticated. Returns a sanitized snapshot of the trip the
 * rider chose to share. Intentionally omits phone numbers, fare details
 * and rider identity — only safety-relevant tracking info is exposed.
 * Polled by the public tracking page every few seconds.
 */
router.get("/track/:token/data", async (req, res) => {
  const token = (req.params.token as string);
  if (!token || token.length < 8 || token.length > 64) {
    return res.status(404).json({ error: "not_found" });
  }
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.shareToken, token))
    .limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });

  let driver: {
    name: string;
    photoUrl: string | null;
    plate: string | null;
    vehicle: string | null;
    location: { lat: number; lng: number } | null;
    etaMin: number | null;
  } | null = null;

  if (ride.acceptedDriverId) {
    const [row] = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        photoUrl: usersTable.photoUrl,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        color: vehiclesTable.color,
        plate: vehiclesTable.plate,
      })
      .from(usersTable)
      .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
      .where(eq(usersTable.id, ride.acceptedDriverId))
      .limit(1);

    const live = getDriverLivePosition(ride.acceptedDriverId);

    let etaMin: number | null = null;
    if (live) {
      if (ride.status === "driver_arriving" && ride.pickupLat != null && ride.pickupLng != null) {
        const distKm = haversineKm(live.lat, live.lng, ride.pickupLat, ride.pickupLng);
        etaMin = Math.max(1, Math.round((distKm / 30) * 60));
      } else if (
        ride.status === "in_progress" &&
        ride.dropoffLat != null &&
        ride.dropoffLng != null
      ) {
        const distKm = haversineKm(live.lat, live.lng, ride.dropoffLat, ride.dropoffLng);
        etaMin = Math.max(1, Math.round((distKm / 30) * 60));
      }
    }

    driver = {
      name: row ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "Driver" : "Driver",
      photoUrl: row?.photoUrl ?? null,
      plate: row?.plate ?? null,
      vehicle: row && row.make && row.model
        ? `${row.color ? row.color + " " : ""}${row.make} ${row.model}`.trim()
        : null,
      location: live,
      etaMin,
    };
  }

  // Disable caching so the polling page always sees fresh data.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.json({
    status: ride.status,
    pickup: {
      label: ride.pickupLabel,
      address: ride.pickupAddress,
      lat: ride.pickupLat,
      lng: ride.pickupLng,
    },
    dropoff: {
      label: ride.dropoffLabel,
      address: ride.dropoffAddress,
      lat: ride.dropoffLat,
      lng: ride.dropoffLng,
    },
    estimatedDistanceKm: ride.estimatedDistanceKm,
    estimatedDurationMin: ride.estimatedDurationMin,
    routePolyline: ride.routePolyline,
    driver,
  });
});

/**
 * GET /track/:token
 * Public HTML tracking page that the rider's friends/family open in their
 * browser. Renders a Leaflet map (no API key needed) and polls /track/:token/data
 * every 5 seconds for status + driver location updates. The page is fully
 * self-contained so it works on any modern mobile or desktop browser.
 */
router.get("/track/:token", async (req, res) => {
  const token = (req.params.token as string);
  if (!token || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
    return res.status(404).type("html").send(renderTrackError("Invalid tracking link"));
    return;
  }
  const [ride] = await db
    .select({ id: ridesTable.id })
    .from(ridesTable)
    .where(eq(ridesTable.shareToken, token))
    .limit(1);
  if (!ride) {
    return res.status(404).type("html").send(renderTrackError("This tracking link is no longer active"));
    return;
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.type("html").send(renderTrackPage(token));
});

function renderTrackError(message: string): string {
  const safe = String(message).replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trip tracker</title><style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0F172A;color:#E2E8F0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}div{max-width:340px}h1{font-size:20px;margin:0 0 8px}p{color:#94A3B8;margin:0;line-height:1.4}</style></head><body><div><h1>Trip not available</h1><p>${safe}.</p></div></body></html>`;
}

function renderTrackPage(token: string): string {
  // Token is validated against /^[A-Za-z0-9_-]{8,64}$/ before reaching here,
  // so it is safe to embed directly in the JS string literal.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FF6E40">
<title>Live trip tracker</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0F172A;color:#0F172A;-webkit-font-smoothing:antialiased}
  #map{position:fixed;inset:0;background:#0F172A}
  .topbar{position:fixed;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;background:#FF6E40;color:#fff;padding:14px 18px;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.25);display:flex;align-items:center;gap:12px;z-index:1000}
  .topbar .title{font-weight:700;font-size:15px;line-height:1.2}
  .topbar .sub{font-size:12px;opacity:.9;margin-top:2px;line-height:1.3}
  .eta{margin-left:auto;text-align:center;min-width:54px}
  .eta-num{font-weight:700;font-size:22px;line-height:1}
  .eta-unit{font-size:10px;letter-spacing:1px;opacity:.85;margin-top:2px}
  .card{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));background:#fff;border-radius:20px;box-shadow:0 -10px 30px rgba(15,23,42,.18);padding:18px;z-index:1000}
  .driver-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .avatar{width:48px;height:48px;border-radius:24px;background:#FFE3D6;color:#FF6E40;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;background-size:cover;background-position:center;flex-shrink:0}
  .driver-name{font-weight:700;font-size:16px}
  .driver-vehicle{font-size:13px;color:#64748B;margin-top:2px}
  .plate{margin-left:auto;border:1px solid #E2E8F0;border-radius:10px;padding:6px 10px;font-weight:700;font-size:13px;color:#0F172A}
  .stop-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;font-size:13px;color:#475569}
  .dot{width:10px;height:10px;border-radius:5px;margin-top:5px;flex-shrink:0}
  .dot.pickup{background:#10B981}
  .dot.dropoff{background:#FF6E40}
  .stop-row .stop-text{flex:1;line-height:1.35}
  .stop-row .stop-label{color:#94A3B8;font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .footer{margin-top:12px;padding-top:12px;border-top:1px solid #F1F5F9;font-size:12px;color:#94A3B8;text-align:center}
  .pin{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:18px;background:#FF6E40;color:#fff;font-weight:700;box-shadow:0 4px 12px rgba(255,110,64,.45);border:3px solid #fff}
  .pin.pickup{background:#10B981;box-shadow:0 4px 12px rgba(16,185,129,.45)}
  .pin.dropoff{background:#0F172A;box-shadow:0 4px 12px rgba(15,23,42,.45)}
  .leaflet-container{font-family:inherit}
  @media(max-width:380px){.topbar{padding:12px 14px}.card{padding:14px}}
</style>
</head>
<body>
<div id="map"></div>
<div class="topbar" id="topbar" role="status" aria-live="polite">
  <div style="flex:1;min-width:0">
    <div class="title" id="title">Loading trip…</div>
    <div class="sub" id="subtitle">Fetching the latest status</div>
  </div>
  <div class="eta" id="eta" hidden>
    <div class="eta-num" id="eta-num">—</div>
    <div class="eta-unit">MIN</div>
  </div>
</div>
<div class="card" id="card" hidden>
  <div class="driver-row">
    <div class="avatar" id="avatar">D</div>
    <div style="flex:1;min-width:0">
      <div class="driver-name" id="driver-name">Driver</div>
      <div class="driver-vehicle" id="driver-vehicle"></div>
    </div>
    <div class="plate" id="plate" hidden></div>
  </div>
  <div class="stop-row">
    <div class="dot pickup"></div>
    <div class="stop-text">
      <div class="stop-label">Pickup</div>
      <div id="pickup-addr">—</div>
    </div>
  </div>
  <div class="stop-row">
    <div class="dot dropoff"></div>
    <div class="stop-text">
      <div class="stop-label">Dropoff</div>
      <div id="dropoff-addr">—</div>
    </div>
  </div>
  <div class="footer">Live tracking shared by the rider · refreshes automatically</div>
</div>
<script>
(function(){
  var TOKEN = ${JSON.stringify(token)};
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([0,0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.control.attribution({ prefix: false }).addAttribution('© OpenStreetMap').addTo(map);

  function makePin(cls, html){
    return L.divIcon({ className: '', html: '<div class="pin '+cls+'">'+(html||'')+'</div>', iconSize:[36,36], iconAnchor:[18,18] });
  }
  var pickupMarker=null, dropoffMarker=null, driverMarker=null, routeLine=null;
  var fitDoneFor=null;

  function setStatusBanner(status, driver){
    var t = document.getElementById('title');
    var s = document.getElementById('subtitle');
    var eta = document.getElementById('eta');
    var etaNum = document.getElementById('eta-num');
    if(status === 'driver_arriving'){
      t.textContent = (driver && driver.name ? driver.name : 'Driver') + ' is on the way';
      s.textContent = driver && driver.etaMin ? ('Arriving in ' + driver.etaMin + ' min') : 'Heading to pickup';
      if(driver && driver.etaMin){ etaNum.textContent = driver.etaMin; eta.hidden = false; } else { eta.hidden = true; }
    } else if(status === 'in_progress'){
      t.textContent = 'On the way to destination';
      s.textContent = driver && driver.etaMin ? ('Arriving in ' + driver.etaMin + ' min') : 'Trip in progress';
      if(driver && driver.etaMin){ etaNum.textContent = driver.etaMin; eta.hidden = false; } else { eta.hidden = true; }
    } else if(status === 'completed'){
      t.textContent = 'Trip completed';
      s.textContent = 'The rider arrived safely';
      eta.hidden = true;
    } else if(status === 'cancelled'){
      t.textContent = 'Trip cancelled';
      s.textContent = 'This ride was cancelled';
      eta.hidden = true;
    } else {
      t.textContent = 'Looking for a driver';
      s.textContent = 'The rider has not been matched yet';
      eta.hidden = true;
    }
  }

  function decodePolyline(str){
    if(!str) return [];
    var index=0, lat=0, lng=0, coords=[];
    while(index < str.length){
      var b, shift=0, result=0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
      shift=0; result=0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
      coords.push([lat/1e5, lng/1e5]);
    }
    return coords;
  }

  function update(data){
    setStatusBanner(data.status, data.driver);
    var card = document.getElementById('card');
    card.hidden = false;

    document.getElementById('pickup-addr').textContent = data.pickup.address || data.pickup.label || '—';
    document.getElementById('dropoff-addr').textContent = data.dropoff.address || data.dropoff.label || '—';

    if(data.driver){
      document.getElementById('driver-name').textContent = data.driver.name || 'Driver';
      document.getElementById('driver-vehicle').textContent = data.driver.vehicle || '';
      var plate = document.getElementById('plate');
      if(data.driver.plate){ plate.textContent = data.driver.plate; plate.hidden = false; } else { plate.hidden = true; }
      var av = document.getElementById('avatar');
      if(data.driver.photoUrl){
        av.style.backgroundImage = 'url(' + JSON.stringify(data.driver.photoUrl) + ')';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.textContent = (data.driver.name || 'D').trim().charAt(0).toUpperCase();
      }
    } else {
      document.getElementById('driver-name').textContent = 'Waiting for driver';
      document.getElementById('driver-vehicle').textContent = '';
      document.getElementById('plate').hidden = true;
    }

    var pts = [];
    if(data.pickup.lat != null && data.pickup.lng != null){
      var p = [data.pickup.lat, data.pickup.lng];
      if(!pickupMarker){ pickupMarker = L.marker(p, { icon: makePin('pickup','A') }).addTo(map); }
      else pickupMarker.setLatLng(p);
      pts.push(p);
    }
    if(data.dropoff.lat != null && data.dropoff.lng != null){
      var d = [data.dropoff.lat, data.dropoff.lng];
      if(!dropoffMarker){ dropoffMarker = L.marker(d, { icon: makePin('dropoff','B') }).addTo(map); }
      else dropoffMarker.setLatLng(d);
      pts.push(d);
    }
    if(data.routePolyline && !routeLine){
      var coords = decodePolyline(data.routePolyline);
      if(coords.length){ routeLine = L.polyline(coords, { color:'#FF6E40', weight:4, opacity:.7 }).addTo(map); }
    }
    if(data.driver && data.driver.location){
      var dr = [data.driver.location.lat, data.driver.location.lng];
      if(!driverMarker){ driverMarker = L.marker(dr, { icon: makePin('','🚗') }).addTo(map); }
      else driverMarker.setLatLng(dr);
      pts.push(dr);
    }

    var fitKey = data.status + (data.driver && data.driver.location ? ':live' : ':nolive');
    if(pts.length && fitDoneFor !== fitKey){
      if(pts.length === 1){ map.setView(pts[0], 15); }
      else { map.fitBounds(L.latLngBounds(pts), { padding: [80, 80] }); }
      fitDoneFor = fitKey;
    }
  }

  function poll(){
    fetch('/api/track/' + encodeURIComponent(TOKEN) + '/data', { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
      .then(update)
      .catch(function(){ /* swallow — keep showing last good state */ });
  }
  poll();
  setInterval(poll, 5000);
})();
</script>
</body>
</html>`;
}

router.post("/rides/:id/rate-customer", requireUser, async (req, res) => {
  const parsed = z
    .object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, req.params.id as string)).limit(1);
  if (!ride || ride.acceptedDriverId !== req.userId) return res.status(403).json({ error: "forbidden" });
  if (ride.status !== "completed") return res.status(409).json({ error: "not_completed" });
  if (ride.customerRatingScore != null) return res.json({ ride });
  const [updated] = await db
    .update(ridesTable)
    .set({
      customerRatingScore: parsed.data.rating,
      customerRatingComment: parsed.data.comment ?? null,
    })
    .where(eq(ridesTable.id, ride.id))
    .returning();
  if (updated?.riderId) {
    try {
      await recomputeAndStoreCustomerRating(updated.riderId);
    } catch (err) {
      req.log.error(
        { err, riderId: updated.riderId, rideId: updated.id },
        "[rate-customer] failed to recompute customer rating",
      );
    }
  }
  return res.json({ ride: updated });
});

router.get("/drivers/:driverId/rating-summary", requireUser, async (req, res) => {
  const [driver] = await db
    .select({ rating: usersTable.rating, driverRatingCount: usersTable.driverRatingCount })
    .from(usersTable)
    .where(eq(usersTable.id, req.params.driverId as string))
    .limit(1);
  if (!driver) return res.status(404).json({ error: "not_found" });
  return res.json({
    averageRating: parseFloat(driver.rating),
    ratingCount: driver.driverRatingCount ?? 0,
  });
});

router.get("/users/:userId/rating-summary", requireUser, async (req, res) => {
  const [user] = await db
    .select({ customerRating: usersTable.customerRating, customerRatingCount: usersTable.customerRatingCount })
    .from(usersTable)
    .where(eq(usersTable.id, req.params.userId as string))
    .limit(1);
  if (!user) return res.status(404).json({ error: "not_found" });
  return res.json({
    averageRating: user.customerRating != null ? parseFloat(user.customerRating) : null,
    ratingCount: user.customerRatingCount ?? 0,
  });
});

router.post("/rides/:id/rate", requireUser, async (req, res) => {
  const parsed = z
    .object({
      score: z.number().int().min(1).max(5),
      comment: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.id as string))).limit(1);
  if (!ride || ride.riderId !== req.userId) return res.status(403).json({ error: "forbidden" });
  if (ride.status !== "completed") return res.status(409).json({ error: "not_completed" });
  if (ride.ratingScore != null) return res.json({ ride });
  const [updated] = await db
    .update(ridesTable)
    .set({
      ratingScore: parsed.data.score,
      ratingComment: parsed.data.comment ?? null,
    })
    .where(eq(ridesTable.id, ride.id))
    .returning();
  // Keep the driver's stored aggregate rating in sync so consumers that
  // read it directly (e.g. drivers list table) reflect the new feedback
  // without waiting for an admin to reopen the dialog.
  if (updated?.acceptedDriverId) {
    try {
      await recomputeAndStoreDriverRating(updated.acceptedDriverId);
    } catch (err) {
      req.log.error(
        { err, driverId: updated.acceptedDriverId, rideId: updated.id },
        "[rate] failed to recompute driver rating",
      );
    }
  }
  return res.json({ ride: updated });
});

export default router;
