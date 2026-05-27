import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, isNull, or, desc } from "drizzle-orm";
import { db, ridesTable, bidsTable } from "@workspace/db";
import { requireUser } from "../middlewares/auth";
import {
  emitToRide,
  emitToUser,
  getDriverLivePosition,
  haversineKm,
} from "../lib/io";
import { acceptBid } from "../lib/bidding";
import { ensureApprovedDriver } from "./driver";
import { getRideWithBids } from "./rides";
import { loadVehicleType, validateBid } from "../lib/pricing";
import { resolveAirportSurcharge } from "../lib/airportSurcharge";
import { invalidateDriverRates } from "../lib/driverStats";
import { checkLimit } from "../lib/rateLimit";

const router: IRouter = Router();

const BID_TTL_SECONDS = 90;
const NEARBY_RADIUS_KM_DEFAULT = 5;
// Per-driver rate limit on POST /bidding/offers: counter-offers are
// legitimate but we don't want a malicious or buggy client flooding the
// queue. 30 offers per 60 s is well above any human-driven rate.
const BIDDING_OFFER_MAX = 30;
const BIDDING_OFFER_WINDOW_MS = 60_000;

/**
 * Driver-facing list of their own offers. Status filter defaults to "active"
 * so the driver UI can show only outstanding offers; pass status=all to
 * include the driver's full history.
 */
router.get("/bidding/offers/mine", requireUser, async (req, res) => {
  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.status(403).json({ error: "not_approved" });

  const status = req.query.status as string | undefined;
  const validStatuses = ["active", "accepted", "rejected", "cancelled", "expired"] as const;

  const whereClauses = [eq(bidsTable.driverId, driver.id)];
  if (status && (validStatuses as readonly string[]).includes(status)) {
    whereClauses.push(eq(bidsTable.status, status as (typeof validStatuses)[number]));
  } else if (!status || status !== "all") {
    whereClauses.push(eq(bidsTable.status, "active"));
  }

  const rows = await db
    .select({
      bid: bidsTable,
      ride: {
        id: ridesTable.id,
        status: ridesTable.status,
        pickupLabel: ridesTable.pickupLabel,
        pickupAddress: ridesTable.pickupAddress,
        dropoffLabel: ridesTable.dropoffLabel,
        dropoffAddress: ridesTable.dropoffAddress,
        pickupLat: ridesTable.pickupLat,
        pickupLng: ridesTable.pickupLng,
        initialFare: ridesTable.initialFare,
        biddingExpiresAt: ridesTable.biddingExpiresAt,
        estimatedDistanceKm: ridesTable.estimatedDistanceKm,
        estimatedDurationMin: ridesTable.estimatedDurationMin,
      },
    })
    .from(bidsTable)
    .leftJoin(ridesTable, eq(ridesTable.id, bidsTable.rideId))
    .where(and(...whereClauses))
    .orderBy(desc(bidsTable.createdAt))
    .limit(50);

  return res.json({
    offers: rows.map(({ bid, ride }) => ({
      id: bid.id,
      rideId: bid.rideId,
      amount: bid.amount,
      etaMin: bid.etaMin,
      note: bid.note,
      status: bid.status,
      expiresAt: bid.expiresAt,
      createdAt: bid.createdAt,
      ride: ride
        ? {
            id: ride.id,
            status: ride.status,
            pickupLabel: ride.pickupLabel,
            dropoffLabel: ride.dropoffLabel,
            initialFare: ride.initialFare,
            biddingExpiresAt: ride.biddingExpiresAt,
            estimatedDistanceKm: ride.estimatedDistanceKm,
            estimatedDurationMin: ride.estimatedDurationMin,
          }
        : null,
    })),
  });
});

/**
 * Driver-facing list of active bidding rides near their current location.
 * Excludes rides whose biddingExpiresAt has elapsed, rides on which the
 * driver already has an active bid, and rides where the driver doesn't
 * have a known live position (can't compute distance).
 */
router.get("/bidding/nearby", requireUser, async (req, res) => {
  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.status(403).json({ error: "not_approved" });

  const position = getDriverLivePosition(driver.id);
  if (!position) return res.status(409).json({ error: "no_live_position" });

  const radiusKm = Math.min(
    Math.max(Number(req.query.radiusKm) || NEARBY_RADIUS_KM_DEFAULT, 0.5),
    25,
  );
  const now = new Date();

  const activeBiddingRides = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.status, "bidding"),
        or(
          isNull(ridesTable.biddingExpiresAt),
          gt(ridesTable.biddingExpiresAt, now),
        ),
      ),
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(50);

  const driverActiveBids = await db
    .select({ rideId: bidsTable.rideId })
    .from(bidsTable)
    .where(
      and(eq(bidsTable.driverId, driver.id), eq(bidsTable.status, "active")),
    );
  const excluded = new Set(driverActiveBids.map((b) => b.rideId));

  const nearby = activeBiddingRides
    .filter((r) => !excluded.has(r.id))
    .filter((r) => r.pickupLat != null && r.pickupLng != null)
    .map((r) => ({
      ride: r,
      distanceKm: haversineKm(position.lat, position.lng, r.pickupLat!, r.pickupLng!),
    }))
    .filter((entry) => entry.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return res.json({
    rides: nearby.map(({ ride, distanceKm }) => ({
      id: ride.id,
      pickupLabel: ride.pickupLabel,
      pickupAddress: ride.pickupAddress,
      dropoffLabel: ride.dropoffLabel,
      dropoffAddress: ride.dropoffAddress,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      initialFare: ride.initialFare,
      vehicleClass: ride.vehicleClass,
      vehicleTypeId: ride.vehicleTypeId,
      estimatedDistanceKm: ride.estimatedDistanceKm,
      estimatedDurationMin: ride.estimatedDurationMin,
      distanceKm,
      biddingExpiresAt: ride.biddingExpiresAt,
      createdAt: ride.createdAt,
    })),
  });
});

/**
 * Driver posts (or replaces) their bid for a bidding ride. If the driver
 * already has an active bid on this ride, the previous bid is cancelled
 * in the same transaction — this is the "counter-offer" path. Sets an
 * expiresAt so the expiry job can age out stale bids.
 */
router.post("/bidding/offers", requireUser, async (req, res) => {
  const rl = checkLimit(
    `bidoffer:u:${req.userId}`,
    BIDDING_OFFER_MAX,
    BIDDING_OFFER_WINDOW_MS,
  );
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const parsed = z
    .object({
      rideId: z.string().uuid(),
      amount: z.number().positive().max(100000),
      etaMin: z.number().int().positive().max(60),
      note: z.string().max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.status(403).json({ error: "not_approved" });
  if (!driver.driverOnline) return res.status(403).json({ error: "not_online" });

  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, parsed.data.rideId))
    .limit(1);
  if (!ride) return res.status(404).json({ error: "ride_not_found" });
  if (ride.status !== "bidding") return res.status(409).json({ error: "not_bidding" });
  if (ride.biddingExpiresAt && ride.biddingExpiresAt < new Date()) {
    return res.status(410).json({ error: "bidding_expired" });
  }

  const vt = await loadVehicleType(ride.vehicleTypeId);
  const bidAirport = await resolveAirportSurcharge(
    ride.vehicleTypeId,
    ride.pickupLat != null && ride.pickupLng != null
      ? { lat: ride.pickupLat, lng: ride.pickupLng }
      : null,
    ride.dropoffLat != null && ride.dropoffLng != null
      ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
      : null,
  ).catch(() => null);
  const violation = validateBid(
    vt,
    parsed.data.amount,
    ride.estimatedDistanceKm,
    ride.estimatedDurationMin,
    ride.createdAt,
    bidAirport,
  );
  if (violation) {
    return res.status(400).json({ error: violation.code, bounds: violation.bounds });
  }

  const expiresAt = new Date(Date.now() + BID_TTL_SECONDS * 1000);

  // Counter-offer: cancel the driver's previous active bid (if any) then
  // insert the new one in the same transaction so the rider's list never
  // sees both.
  const inserted = await db.transaction(async (tx) => {
    await tx
      .update(bidsTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bidsTable.rideId, ride.id),
          eq(bidsTable.driverId, driver.id),
          eq(bidsTable.status, "active"),
        ),
      );
    const [bid] = await tx
      .insert(bidsTable)
      .values({
        rideId: ride.id,
        driverId: driver.id,
        amount: parsed.data.amount,
        etaMin: parsed.data.etaMin,
        note: parsed.data.note,
        expiresAt,
      })
      .returning();
    return bid;
  });

  invalidateDriverRates(driver.id);

  emitToRide(ride.id, "bidding:new-offer", { rideId: ride.id, bid: inserted });
  emitToUser(ride.riderId, "bidding:new-offer", { rideId: ride.id, bid: inserted });

  return res.status(201).json({ bid: inserted });
});

/**
 * Driver withdraws an active bid they previously submitted. No-op if the
 * bid isn't theirs or has already transitioned out of 'active'.
 */
router.post("/bidding/offers/:bidId/withdraw", requireUser, async (req, res) => {
  const [bid] = await db
    .select()
    .from(bidsTable)
    .where(eq(bidsTable.id, req.params.bidId as string))
    .limit(1);
  if (!bid) return res.status(404).json({ error: "bid_not_found" });
  if (bid.driverId !== req.userId) return res.status(403).json({ error: "forbidden" });
  if (bid.status !== "active") return res.status(409).json({ error: "not_active" });

  const [updated] = await db
    .update(bidsTable)
    .set({ status: "cancelled" })
    .where(and(eq(bidsTable.id, bid.id), eq(bidsTable.status, "active")))
    .returning();
  if (!updated) return res.status(409).json({ error: "race" });

  emitToRide(bid.rideId, "bidding:offer-withdrawn", {
    rideId: bid.rideId,
    bidId: bid.id,
  });
  const [ride] = await db
    .select({ riderId: ridesTable.riderId })
    .from(ridesTable)
    .where(eq(ridesTable.id, bid.rideId))
    .limit(1);
  if (ride) emitToUser(ride.riderId, "bidding:offer-withdrawn", { rideId: bid.rideId, bidId: bid.id });

  return res.json({ bid: updated });
});

/**
 * Rider accepts a driver's offer on their bidding post. Reuses the
 * shared `acceptBid` helper to keep the existing /rides/:id/accept
 * endpoint and this one in lockstep.
 */
router.post("/bidding/posts/:rideId/accept-offer", requireUser, async (req, res) => {
  const parsed = z.object({ bidId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const result = await acceptBid({
    rideId: req.params.rideId as string,
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

  const { ride: updated, bid, siblings, losingDriverIds } = result;

  for (const sibling of siblings) {
    emitToRide(sibling.id, "bidding:accepted", { ride: sibling, bidId: bid.id });
    emitToUser(sibling.riderId, "bidding:accepted", { rideId: sibling.id, bidId: bid.id });
  }
  emitToRide(updated.id, "bidding:accepted", { ride: updated, bidId: bid.id });
  emitToUser(bid.driverId, "bidding:accepted", { rideId: updated.id, bidId: bid.id });
  for (const driverId of losingDriverIds) {
    emitToUser(driverId, "bidding:lost", { rideId: updated.id, bidId: bid.id });
  }

  // Return the same enriched ride shape (with bids array) as
  // /rides/:id/accept so the rider client can use rideToView() without
  // a follow-up GET.
  const enriched = await getRideWithBids(updated.id);
  return res.json({
    ride: enriched ? { ...enriched.ride, bids: enriched.bids } : { ...updated, bids: [] },
    bid,
  });
});

export default router;
