import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  ridesTable,
  bidsTable,
  usersTable,
  earningsTable,
  vehicleTypesTable,
  vehiclesTable,
  walletTransactionsTable,
} from "@workspace/db";
import { and, eq, desc, inArray, ne, gte, sql } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";
import { checkLimit } from "../lib/rateLimit";
import { clampRadiusKm, emitToRide, emitToUser, getLiveDriversForRiders, updateDriverPositionFromHttp } from "../lib/io";
import { getSnapshot } from "../lib/heatmap";
import { computeBidBounds, loadVehicleType, validateBid } from "../lib/pricing";
import { resolveAirportSurcharge } from "../lib/airportSurcharge";
import { invalidateDriverRates } from "../lib/driverStats";
import {
  getActiveDestinationMode,
  loadDestinationModeConfig,
  rideMatchesDestination,
} from "../lib/destinationMode";

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function ensureApprovedDriver(userId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u && u.driverStatus === "approved" ? u : null;
}

// HTTP fallback for driver location updates when the Socket.IO connection
// is not yet available (e.g. cold-start, brief network switch). The driver
// app calls this endpoint at most once every 15 seconds. It mirrors the
// `driver:location` socket handler: updates livePositions + persists to DB
// + emits to the admin room via Socket.IO if any admin is connected.
// Max 10 location updates per minute per authenticated driver (client self-throttles
// to 1 per 15 s, so this gives 4× headroom while blocking runaway clients).
const DRIVER_LOCATION_MAX = 10;
const DRIVER_LOCATION_WINDOW_MS = 60_000;

router.post("/driver/location", requireUser, async (req, res) => {
  const rl = checkLimit(`dloc:u:${req.userId}`, DRIVER_LOCATION_MAX, DRIVER_LOCATION_WINDOW_MS);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const parsed = z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    heading: z.number().finite().min(0).max(360).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { lat, lng, heading } = parsed.data;
  // Reject the (0,0) sentinel that occasionally leaks from uninitialised GPS.
  if (lat === 0 && lng === 0) return res.status(400).json({ error: "invalid_coords" });
  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.status(403).json({ error: "not_approved" });
  await updateDriverPositionFromHttp(driver.id, { lat, lng, heading });
  return res.json({ ok: true });
});

router.post("/driver/online", requireUser, async (req, res) => {
  const parsed = z.object({ online: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.status(403).json({ error: "not_approved" });
  const [u] = await db
    .update(usersTable)
    .set({ driverOnline: parsed.data.online })
    .where(eq(usersTable.id, driver.id))
    .returning();
  // Going offline releases any queued next-rides so they can be picked up
  // by another driver instead of being held indefinitely.
  if (!parsed.data.online) {
    const { releaseQueuedRidesForDriver } = await import(
      "../lib/queuedRides"
    );
    void releaseQueuedRidesForDriver(driver.id, "driver_offline");
  }
  return res.json({ online: u.driverOnline });
});

router.get("/driver/requests", requireUser, async (req, res) => {
  const driver = await ensureApprovedDriver(req.userId!);
  if (!driver) return res.json({ requests: [] });
  if (!driver.driverOnline) return res.json({ requests: [] });

  // Fetch the driver's own vehicle type for capability-based filtering.
  const [driverVehicleRow] = await db
    .select({ vehicle: vehiclesTable, vehicleType: vehicleTypesTable })
    .from(vehiclesTable)
    .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
    .where(eq(vehiclesTable.userId, driver.id))
    .limit(1);
  const driverVt = driverVehicleRow?.vehicleType ?? null;

  const rides = await db
    .select({ ride: ridesTable, rider: usersTable, vehicleType: vehicleTypesTable })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, ridesTable.vehicleTypeId))
    .where(eq(ridesTable.status, "bidding"))
    .orderBy(desc(ridesTable.createdAt))
    .limit(50);

  const myBids = await db
    .select({ rideId: bidsTable.rideId })
    .from(bidsTable)
    .where(and(eq(bidsTable.driverId, driver.id), eq(bidsTable.status, "active")));
  const bidSet = new Set(myBids.map((b) => b.rideId));

  // Apply capability filtering: driver only sees rides their vehicle can fulfill.
  let eligible = rides.filter(({ ride, vehicleType: rideVt }) => {
    if (bidSet.has(ride.id)) return false;
    if (ride.vehicleTypeId) {
      if (!driverVt || !rideVt) return false;
      if (rideVt.vehicleCategory !== driverVt.vehicleCategory) return false;
    }
    if (ride.wheelchairRequested && !driverVt?.wheelchairAccess) return false;
    if (ride.petRequested && !driverVt?.petFriendly) return false;
    if (ride.assistRequested && !driverVt?.assistAvailable) return false;
    if (ride.isShared) {
      if (!driverVt?.poolEnabled) return false;
      if ((driverVt?.personCapacity ?? 0) < ride.seatsRequested) return false;
    }
    return true;
  });

  // Destination-mode filter: when the driver has an active destination
  // session, drop any ride whose dropoff/route doesn't head toward it.
  const destCfg = await loadDestinationModeConfig();
  if (destCfg.enabled) {
    const activeDest = await getActiveDestinationMode(driver.id);
    if (activeDest) {
      eligible = eligible.filter(({ ride }) =>
        rideMatchesDestination(
          {
            pickupLat: ride.pickupLat,
            pickupLng: ride.pickupLng,
            dropoffLat: ride.dropoffLat,
            dropoffLng: ride.dropoffLng,
          },
          { destLat: activeDest.destLat, destLng: activeDest.destLng },
          {
            matchRadiusKm: destCfg.matchRadiusKm,
            corridorKm: destCfg.corridorKm,
          },
        ),
      );
    }
  }

  // Group rides that share a sharedGroupId. Present each shared group as a
  // single request entry (keyed on the earliest ride in the group) with an
  // ordered stop list so the driver sees the full multi-stop picture.
  const grouped: Map<
    string,
    {
      ride: typeof ridesTable.$inferSelect;
      rider: typeof usersTable.$inferSelect | null;
      vehicleType: typeof vehicleTypesTable.$inferSelect | null;
    }[]
  > = new Map();
  const solo: typeof eligible = [];

  for (const row of eligible) {
    if (row.ride.sharedGroupId) {
      const key = row.ride.sharedGroupId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    } else {
      solo.push(row);
    }
  }

  const requests: object[] = [];

  // Solo (unmatched) rides — same shape as before.
  for (const { ride, rider, vehicleType } of solo.slice(0, 20)) {
    // Resolve airport surcharge so the bid band drivers see matches what the
    // rider was quoted and what /complete will charge. A few extra DB hits
    // per request feed (capped at 20) is well within budget.
    const airport = await resolveAirportSurcharge(
      ride.vehicleTypeId,
      ride.pickupLat != null && ride.pickupLng != null
        ? { lat: ride.pickupLat, lng: ride.pickupLng }
        : null,
      ride.dropoffLat != null && ride.dropoffLng != null
        ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
        : null,
    ).catch(() => null);
    const bounds = computeBidBounds(
      vehicleType,
      ride.estimatedDistanceKm,
      ride.estimatedDurationMin,
      ride.createdAt,
      airport,
    );
    requests.push({
      id: ride.id,
      riderName: rider?.firstName ?? "Rider",
      riderRating: rider ? parseFloat(rider.rating) : 4.9,
      riderCustomerRating:
        rider?.customerRating != null ? parseFloat(rider.customerRating) : null,
      riderCustomerRatingCount: rider?.customerRatingCount ?? 0,
      pickup: { label: ride.pickupLabel, address: ride.pickupAddress },
      dropoff: { label: ride.dropoffLabel, address: ride.dropoffAddress },
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      dropoffLat: ride.dropoffLat,
      dropoffLng: ride.dropoffLng,
      routePolyline: ride.routePolyline,
      distanceKm: ride.estimatedDistanceKm,
      durationMin: ride.estimatedDurationMin,
      suggestedFare: bounds.suggested,
      minBid: bounds.min,
      maxBid: bounds.max,
      fixedFare: bounds.fixedAmount,
      fareModel: bounds.fareModel,
      pool: bounds.pool,
      initialFare: ride.initialFare,
      vehicleClass: ride.vehicleClass,
      vehicleTypeId: ride.vehicleTypeId,
      vehicleTypeName: vehicleType?.name ?? null,
      isShared: ride.isShared,
      seatsRequested: ride.seatsRequested,
      sharedGroupId: null,
      stops: null,
      wheelchairRequested: ride.wheelchairRequested,
      petRequested: ride.petRequested,
      assistRequested: ride.assistRequested,
      receivedAt: ride.createdAt.getTime(),
    });
  }

  // Shared-group rides — presented as a single entry with ordered stops.
  // The "primary" ride (earliest createdAt) is used as the entry id so the
  // driver bids on it; acceptance cascades to all siblings server-side.
  for (const [groupId, members] of grouped) {
    // Skip groups whose total seats exceed the driver's vehicle capacity.
    const totalSeats = members.reduce((s, m) => s + m.ride.seatsRequested, 0);
    if (driverVt && (driverVt.personCapacity ?? 0) < totalSeats) continue;

    // Sort by createdAt ascending so rider A (oldest) is first.
    members.sort((a, b) => a.ride.createdAt.getTime() - b.ride.createdAt.getTime());
    const primary = members[0];

    // Compute bounds by summing per-member computeBidBounds.
    let totalSuggestedFare = 0;
    let totalMinBid = 0;
    let totalMaxBid = 0;
    let totalFixedFare: number | null = 0;

    for (const m of members) {
      const mAirport = await resolveAirportSurcharge(
        m.ride.vehicleTypeId,
        m.ride.pickupLat != null && m.ride.pickupLng != null
          ? { lat: m.ride.pickupLat, lng: m.ride.pickupLng }
          : null,
        m.ride.dropoffLat != null && m.ride.dropoffLng != null
          ? { lat: m.ride.dropoffLat, lng: m.ride.dropoffLng }
          : null,
      ).catch(() => null);
      const b = computeBidBounds(
        m.vehicleType,
        m.ride.estimatedDistanceKm,
        m.ride.estimatedDurationMin,
        m.ride.createdAt,
        mAirport,
      );
      totalSuggestedFare += b.suggested;
      totalMinBid += b.min;
      totalMaxBid += b.max;
      if (totalFixedFare !== null) {
        if (b.fixedAmount === null) totalFixedFare = null;
        else totalFixedFare += b.fixedAmount;
      }
    }

    const totalInitialFare = members.every((m) => m.ride.initialFare != null)
      ? members.reduce((s, m) => s + (m.ride.initialFare ?? 0), 0)
      : null;

    // Build ordered stop list: all pickups first, then all dropoffs.
    const stops = [
      ...members.map((m) => ({
        type: "pickup" as const,
        rideId: m.ride.id,
        riderName: m.rider?.firstName ?? "Rider",
        label: m.ride.pickupLabel,
        address: m.ride.pickupAddress,
        lat: m.ride.pickupLat,
        lng: m.ride.pickupLng,
      })),
      ...members.map((m) => ({
        type: "dropoff" as const,
        rideId: m.ride.id,
        riderName: m.rider?.firstName ?? "Rider",
        label: m.ride.dropoffLabel,
        address: m.ride.dropoffAddress,
        lat: m.ride.dropoffLat,
        lng: m.ride.dropoffLng,
      })),
    ];

    const primaryAirport = await resolveAirportSurcharge(
      primary.ride.vehicleTypeId,
      primary.ride.pickupLat != null && primary.ride.pickupLng != null
        ? { lat: primary.ride.pickupLat, lng: primary.ride.pickupLng }
        : null,
      primary.ride.dropoffLat != null && primary.ride.dropoffLng != null
        ? { lat: primary.ride.dropoffLat, lng: primary.ride.dropoffLng }
        : null,
    ).catch(() => null);
    const primaryBounds = computeBidBounds(
      primary.vehicleType,
      primary.ride.estimatedDistanceKm,
      primary.ride.estimatedDurationMin,
      primary.ride.createdAt,
      primaryAirport,
    );

    requests.push({
      id: primary.ride.id,
      riderName: members.map((m) => m.rider?.firstName ?? "Rider").join(" & "),
      riderRating:
        members.reduce((s, m) => s + (m.rider ? parseFloat(m.rider.rating) : 4.9), 0) /
        members.length,
      riderCustomerRating: (() => {
        const rated = members.filter((m) => m.rider?.customerRating != null);
        if (rated.length === 0) return null;
        return (
          rated.reduce((s, m) => s + parseFloat(m.rider!.customerRating!), 0) /
          rated.length
        );
      })(),
      riderCustomerRatingCount: members.reduce(
        (s, m) => s + (m.rider?.customerRatingCount ?? 0),
        0,
      ),
      pickup: { label: primary.ride.pickupLabel, address: primary.ride.pickupAddress },
      dropoff: {
        label: members[members.length - 1].ride.dropoffLabel,
        address: members[members.length - 1].ride.dropoffAddress,
      },
      pickupLat: primary.ride.pickupLat,
      pickupLng: primary.ride.pickupLng,
      dropoffLat: members[members.length - 1].ride.dropoffLat,
      dropoffLng: members[members.length - 1].ride.dropoffLng,
      routePolyline: primary.ride.routePolyline,
      distanceKm: primary.ride.estimatedDistanceKm,
      durationMin: primary.ride.estimatedDurationMin,
      suggestedFare: round2(totalSuggestedFare),
      minBid: round2(totalMinBid),
      maxBid: round2(totalMaxBid),
      fixedFare: totalFixedFare !== null ? round2(totalFixedFare) : null,
      fareModel: primaryBounds.fareModel,
      pool: primaryBounds.pool,
      initialFare: totalInitialFare,
      vehicleClass: primary.ride.vehicleClass,
      vehicleTypeId: primary.ride.vehicleTypeId,
      vehicleTypeName: primary.vehicleType?.name ?? null,
      isShared: true,
      seatsRequested: totalSeats,
      sharedGroupId: groupId,
      stops,
      wheelchairRequested: primary.ride.wheelchairRequested,
      petRequested: primary.ride.petRequested,
      assistRequested: primary.ride.assistRequested,
      receivedAt: primary.ride.createdAt.getTime(),
    });
  }

  return res.json({ requests });
});

// Legacy POST /driver/bids removed — clients now use POST /bidding/offers
// in routes/bidding.ts, which supports counter-offers + sets expiresAt and
// emits the named bidding:new-offer socket event.

/**
 * Build the driver-facing trip payload (the same shape `/driver/trip`
 * returns) from a ride row. Exported so route handlers that mutate ride
 * status (e.g. /rides/:id/start, /rides/:id/complete) can return the
 * updated trip directly and let the driver app refresh its UI without
 * waiting on a follow-up GET.
 */
export async function buildDriverTripPayload(
  ride: typeof ridesTable.$inferSelect,
): Promise<object> {
  const [bid] = ride.acceptedBidId
    ? await db.select().from(bidsTable).where(eq(bidsTable.id, ride.acceptedBidId)).limit(1)
    : [];
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);

  const baseAmount = bid?.amount ?? ride.finalAmount ?? 0;
  let stops: object[] | null = null;
  let totalAmount = baseAmount;

  if (ride.sharedGroupId) {
    const groupRides = await db
      .select({ ride: ridesTable, rider: usersTable })
      .from(ridesTable)
      .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
      .where(eq(ridesTable.sharedGroupId, ride.sharedGroupId))
      .orderBy(desc(ridesTable.createdAt));
    groupRides.sort((a, b) => a.ride.createdAt.getTime() - b.ride.createdAt.getTime());
    stops = [
      ...groupRides.map((g) => ({
        type: "pickup",
        rideId: g.ride.id,
        riderName: g.rider?.firstName ?? "Rider",
        label: g.ride.pickupLabel,
        address: g.ride.pickupAddress,
        lat: g.ride.pickupLat,
        lng: g.ride.pickupLng,
      })),
      ...groupRides.map((g) => ({
        type: "dropoff",
        rideId: g.ride.id,
        riderName: g.rider?.firstName ?? "Rider",
        label: g.ride.dropoffLabel,
        address: g.ride.dropoffAddress,
        lat: g.ride.dropoffLat,
        lng: g.ride.dropoffLng,
      })),
    ];
    totalAmount = groupRides.reduce(
      (sum, g) => sum + (g.ride.initialFare ?? bid?.amount ?? 0),
      0,
    );
    if (totalAmount === 0) totalAmount = baseAmount;
  }

  const vt = await loadVehicleType(ride.vehicleTypeId).catch(() => null);

  return {
    id: ride.id,
    riderName: rider?.firstName ?? "Rider",
    riderPhotoUrl: rider?.photoUrl ?? null,
    riderPhone: rider ? rider.phone : null,
    riderCustomerRating:
      rider?.customerRating != null ? parseFloat(rider.customerRating) : null,
    riderCustomerRatingCount: rider?.customerRatingCount ?? 0,
    pickup: { label: ride.pickupLabel, address: ride.pickupAddress },
    dropoff: { label: ride.dropoffLabel, address: ride.dropoffAddress },
    pickupLat: ride.pickupLat,
    pickupLng: ride.pickupLng,
    dropoffLat: ride.dropoffLat,
    dropoffLng: ride.dropoffLng,
    routePolyline: ride.routePolyline,
    distanceKm: ride.estimatedDistanceKm,
    durationMin: ride.estimatedDurationMin,
    amount: totalAmount,
    status: ride.status,
    isShared: ride.isShared,
    sharedGroupId: ride.sharedGroupId,
    stops,
    waitingFeePerMin: vt?.inTransitWaitingFeePerMin ?? 0,
  };
}

router.get("/driver/trip", requireUser, async (req, res) => {
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.acceptedDriverId, req.userId!),
        inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
      ),
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(1);
  if (!ride) {
    // Check if the driver has a recently completed trip that hasn't been rated yet.
    const [lastCompleted] = await db
      .select({ id: ridesTable.id, riderId: ridesTable.riderId, customerRatingScore: ridesTable.customerRatingScore })
      .from(ridesTable)
      .where(
        and(
          eq(ridesTable.acceptedDriverId, req.userId!),
          eq(ridesTable.status, "completed"),
        ),
      )
      .orderBy(desc(ridesTable.updatedAt))
      .limit(1);
    if (lastCompleted && lastCompleted.customerRatingScore == null) {
      const [rider] = await db
        .select({ firstName: usersTable.firstName })
        .from(usersTable)
        .where(eq(usersTable.id, lastCompleted.riderId))
        .limit(1);
      return res.json({
        trip: null,
        pendingCustomerRating: {
          rideId: lastCompleted.id,
          riderName: rider?.firstName ?? "Rider",
        },
      });
    }
    return res.json({ trip: null, pendingCustomerRating: null });
  }
  return res.json({ trip: await buildDriverTripPayload(ride), pendingCustomerRating: null });
});

router.get("/driver/earnings", requireUser, async (req, res) => {
  const list = await db
    .select()
    .from(earningsTable)
    .where(eq(earningsTable.driverId, req.userId!))
    .orderBy(desc(earningsTable.createdAt))
    .limit(50);
  return res.json({
    earnings: list.map((e) => ({
      id: e.id,
      rideId: e.rideId,
      date: e.createdAt.getTime(),
      amount: e.amount,
      riderName: e.riderName,
      pickup: e.pickupAddress,
      dropoff: e.dropoffAddress,
    })),
  });
});

router.get("/driver/trips/:rideId", requireUser, async (req, res) => {
  const rideId = req.params.rideId as string;
  const earning = await db
    .select()
    .from(earningsTable)
    .where(and(eq(earningsTable.rideId, rideId), eq(earningsTable.driverId, req.userId!)))
    .limit(1);
  if (!earning[0]) return res.status(404).json({ error: "not_found" });

  const [ride] = await db
    .select({
      id: ridesTable.id,
      pickupLat: ridesTable.pickupLat,
      pickupLng: ridesTable.pickupLng,
      dropoffLat: ridesTable.dropoffLat,
      dropoffLng: ridesTable.dropoffLng,
      routePolyline: ridesTable.routePolyline,
      estimatedDistanceKm: ridesTable.estimatedDistanceKm,
      estimatedDurationMin: ridesTable.estimatedDurationMin,
      createdAt: ridesTable.createdAt,
      couponDiscount: ridesTable.couponDiscount,
      fareBreakdown: ridesTable.fareBreakdown,
    })
    .from(ridesTable)
    .where(eq(ridesTable.id, rideId))
    .limit(1);

  if (!ride) return res.status(404).json({ error: "not_found" });

  // Surface coupon info to the driver so the trip detail screen can show
  // the gross fare and explain why the net payout differs from the agreed
  // bid. Code is snapshotted onto fareBreakdown at completion.
  const couponDiscount = ride.couponDiscount ?? null;
  const couponCode = ride.fareBreakdown?.couponCode ?? null;
  const grossAmount =
    couponDiscount != null && couponDiscount > 0
      ? Math.round((earning[0].amount + couponDiscount) * 100) / 100
      : null;

  return res.json({
    trip: {
      id: ride.id,
      date: ride.createdAt.getTime(),
      amount: earning[0].amount,
      riderName: earning[0].riderName,
      pickup: earning[0].pickupAddress,
      dropoff: earning[0].dropoffAddress,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      dropoffLat: ride.dropoffLat,
      dropoffLng: ride.dropoffLng,
      routePolyline: ride.routePolyline,
      distanceKm: ride.estimatedDistanceKm,
      durationMin: ride.estimatedDurationMin,
      couponCode,
      couponDiscount,
      grossAmount,
    },
  });
});

router.get("/drivers/nearby", requireUser, async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const rawRadius = parseFloat(req.query.radiusKm as string);
  const radiusKm = clampRadiusKm(rawRadius);
  const hasCenter =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;
  const drivers = getLiveDriversForRiders(
    hasCenter ? lat : undefined,
    hasCenter ? lng : undefined,
    radiusKm,
  );
  return res.json({ count: drivers.length, drivers });
});

// ─── DEMAND ZONES (real-time surge heatmap) ──────────────────────────────────
// Returns the latest aggregated supply/demand snapshot computed by the
// background aggregator (`lib/heatmap.ts`). The same data is also broadcast
// over Socket.IO room `drivers:heatmap`; this endpoint is the polling
// fallback / initial load.

router.get("/demand-zones", requireUser, async (_req, res) => {
  const snap = getSnapshot();
  res.setHeader("cache-control", "no-store");
  return res.json(snap);
});

router.get("/driver/me/wallet", requireUser, async (req, res) => {
  const [u] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  const txs = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.driverId, req.userId!))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(50);
  const { getDisplayCurrencyCode } = await import("../lib/displayAmount");
  const { enrichAmount } = await import("../lib/currency");
  const displayCode = await getDisplayCurrencyCode();
  const balanceDisplay = await enrichAmount(parseFloat(u.walletBalance ?? "0"), displayCode);
  const txDisplay = await Promise.all(txs.map((t) => enrichAmount(t.amount, displayCode)));
  return res.json({
    walletBalance: u.walletBalance ?? "0",
    walletBalanceDisplay: balanceDisplay,
    transactions: txs.map((t, i) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      amountDisplay: txDisplay[i],
      rideId: t.rideId ?? null,
      note: t.note ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;
