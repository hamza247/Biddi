/**
 * Queued ride requests — matching helpers and lifecycle.
 *
 * A driver on an active trip (driver_arriving / in_progress) may receive,
 * accept, and queue ONE upcoming ride request whose pickup is near their
 * current trip's dropoff. The queued ride auto-activates when the current
 * trip is marked completed.
 *
 * Safety: row-level locking is used when accepting and activating so that
 * a driver can never be assigned two concurrently active trips.
 */
import {
  db,
  ridesTable,
  driverQueuedRidesTable,
  usersTable,
  vehiclesTable,
  vehicleTypesTable,
  bidsTable,
} from "@workspace/db";
import { and, eq, inArray, sql, desc, isNull, or } from "drizzle-orm";
import { getConfig } from "./settings";
import { logger } from "./logger";
import { emitToUser, emitToRide, getDriverLivePosition } from "./io";

/** Earth-radius haversine distance in km. */
export function calculateDistanceKm(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined,
): number | null {
  if (
    lat1 == null ||
    lng1 == null ||
    lat2 == null ||
    lng2 == null ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface QueuedCandidate {
  rideId: string;
  riderId: string;
  riderName: string;
  pickupLabel: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLabel: string;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  initialFare: number | null;
  suggestedFare: number;
  vehicleClass: string | null;
  vehicleTypeId: string | null;
  distanceFromCurrentDropoffKm: number;
  expiresAtMs: number;
  routePolyline: string | null;
}

interface RecentDeclineEntry {
  driverId: string;
  rideId: string;
  declinedAt: number;
}
const recentDeclines: RecentDeclineEntry[] = [];
const DECLINE_DEBOUNCE_MS = 60_000;

function recentlyDeclined(driverId: string, rideId: string): boolean {
  const cutoff = Date.now() - DECLINE_DEBOUNCE_MS;
  for (let i = recentDeclines.length - 1; i >= 0; i--) {
    if (recentDeclines[i].declinedAt < cutoff) {
      recentDeclines.splice(i, 1);
      continue;
    }
    if (
      recentDeclines[i].driverId === driverId &&
      recentDeclines[i].rideId === rideId
    ) {
      return true;
    }
  }
  return false;
}

export function rememberDecline(driverId: string, rideId: string): void {
  recentDeclines.push({ driverId, rideId, declinedAt: Date.now() });
  // Drop any pending offer-window so it isn't immediately re-offered.
  offerWindows.delete(`${driverId}:${rideId}`);
}

/**
 * Stable per-(driver, ride) offer expiry. The first time a candidate is
 * surfaced for a given driver we record `Date.now() + expiryMs` and keep
 * returning that same timestamp on subsequent polls — so the countdown
 * doesn't reset every 10s and the offer actually expires.
 *
 * Once expired we keep the entry until the next sweep, returning null so
 * callers know to drop the candidate. A driver who declines clears their
 * entry via `rememberDecline`; the rest are GC'd lazily.
 */
const offerWindows = new Map<string, number>();
const OFFER_WINDOW_GC_MS = 5 * 60_000;
let lastOfferWindowGc = Date.now();

function getOrCreateOfferExpiry(
  driverId: string,
  rideId: string,
  expiryMs: number,
): number | null {
  const key = `${driverId}:${rideId}`;
  const existing = offerWindows.get(key);
  const now = Date.now();
  if (existing != null) {
    if (existing <= now) return null;
    return existing;
  }
  const expiresAt = now + expiryMs;
  offerWindows.set(key, expiresAt);
  // Lazy GC of long-expired entries to keep the map bounded.
  if (now - lastOfferWindowGc > OFFER_WINDOW_GC_MS) {
    lastOfferWindowGc = now;
    for (const [k, v] of offerWindows) {
      if (v + OFFER_WINDOW_GC_MS < now) offerWindows.delete(k);
    }
  }
  return expiresAt;
}

/**
 * Returns true if this driver has no currently active queued ride and is
 * therefore eligible to receive another queued candidate.
 */
export async function canDriverReceiveQueuedRequest(
  driverId: string,
): Promise<boolean> {
  const cfg = await getConfig();
  if (!cfg.queuedRidesEnabled) return false;
  const active = await db
    .select({ id: driverQueuedRidesTable.id })
    .from(driverQueuedRidesTable)
    .where(
      and(
        eq(driverQueuedRidesTable.driverId, driverId),
        inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
      ),
    );
  return active.length < (cfg.queuedRidesMaxPerDriver ?? 1);
}

async function loadDriverVehicleType(driverId: string): Promise<{
  vehicleTypeId: string | null;
  vehicleCategory: string | null;
  wheelchairAccess: boolean | null;
  petFriendly: boolean | null;
  assistAvailable: boolean | null;
  poolEnabled: boolean | null;
  personCapacity: number | null;
} | null> {
  const [row] = await db
    .select({
      vehicleTypeId: vehiclesTable.vehicleTypeId,
      vehicleCategory: vehicleTypesTable.vehicleCategory,
      wheelchairAccess: vehicleTypesTable.wheelchairAccess,
      petFriendly: vehicleTypesTable.petFriendly,
      assistAvailable: vehicleTypesTable.assistAvailable,
      poolEnabled: vehicleTypesTable.poolEnabled,
      personCapacity: vehicleTypesTable.personCapacity,
    })
    .from(vehiclesTable)
    .leftJoin(
      vehicleTypesTable,
      eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId),
    )
    .where(eq(vehiclesTable.userId, driverId))
    .limit(1);
  return row ?? null;
}

/**
 * Strict capability/type match between a queued candidate ride and a
 * driver's active vehicle. Used by BOTH the candidate filter and the
 * acceptance path so a caller cannot bypass type matching by hitting
 * /accept directly.
 *
 * Fails closed: any missing required metadata (no driver vehicle row,
 * no vehicle type joined, etc.) returns false. The only "open" case is
 * when the rider did NOT pin a specific vehicleTypeId AND did not flag
 * any special-needs requirements — then a driver with a known vehicle
 * type is allowed regardless of category.
 */
function matchesQueuedRideRequirements(
  ride: {
    vehicleTypeId: string | null;
    wheelchairRequested?: boolean | null;
    petRequested?: boolean | null;
    assistRequested?: boolean | null;
    isShared?: boolean | null;
    seatsRequested?: number | null;
  },
  driverVt: Awaited<ReturnType<typeof loadDriverVehicleType>>,
  rideVehicleCategory: string | null,
): boolean {
  // Driver MUST have a known vehicle (fail closed on missing metadata).
  if (!driverVt || !driverVt.vehicleTypeId) return false;

  // Strict vehicle-type identity match when the rider pinned one. This
  // is what enforces "no cross-vehicle-type matching" — drivers with a
  // different vehicleTypeId in the same category are rejected.
  if (ride.vehicleTypeId) {
    if (ride.vehicleTypeId !== driverVt.vehicleTypeId) return false;
  } else if (rideVehicleCategory) {
    // Soft category fallback when only category is known. Fail closed if
    // either side's category is missing.
    if (!driverVt.vehicleCategory) return false;
    if (rideVehicleCategory !== driverVt.vehicleCategory) return false;
  }

  // Special-capability gates — fail closed when driver vehicle does not
  // serve the request.
  if (ride.wheelchairRequested && !driverVt.wheelchairAccess) return false;
  if (ride.petRequested && !driverVt.petFriendly) return false;
  if (ride.assistRequested && !driverVt.assistAvailable) return false;
  if (ride.isShared) {
    if (!driverVt.poolEnabled) return false;
    if ((driverVt.personCapacity ?? 0) < (ride.seatsRequested ?? 1)) return false;
  }
  return true;
}

/**
 * Find rides that are still in `bidding` status, whose pickup is within the
 * configured radius of the driver's CURRENT trip dropoff, and whose vehicle
 * category matches what the driver can serve. Excludes anything already
 * queued, the driver's own active trip, the driver's own past trips, and
 * recently-declined rides for this driver.
 */
export async function findQueuedRideCandidates(
  driverId: string,
  currentTripId: string,
  limit = 5,
): Promise<QueuedCandidate[]> {
  const cfg = await getConfig();
  if (!cfg.queuedRidesEnabled) return [];

  const [currentTrip] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, currentTripId))
    .limit(1);
  if (!currentTrip) return [];
  if (currentTrip.dropoffLat == null || currentTrip.dropoffLng == null) return [];
  if (
    currentTrip.status !== "driver_arriving" &&
    currentTrip.status !== "in_progress"
  ) {
    return [];
  }

  const driverVt = await loadDriverVehicleType(driverId);

  // Pull bidding rides the driver isn't already involved in.
  const candidates = await db
    .select({
      ride: ridesTable,
      rider: usersTable,
      vehicleCategory: vehicleTypesTable.vehicleCategory,
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .leftJoin(
      vehicleTypesTable,
      eq(vehicleTypesTable.id, ridesTable.vehicleTypeId),
    )
    .where(
      and(
        eq(ridesTable.status, "bidding"),
        // exclude rides the rider already shared with this driver
        // (driver-side cancellation cooldown is handled in-memory)
      ),
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(50);

  // Already-queued ride ids should be excluded.
  const alreadyQueued = await db
    .select({ rideId: driverQueuedRidesTable.nextTripId })
    .from(driverQueuedRidesTable)
    .where(
      inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
    );
  const queuedSet = new Set(alreadyQueued.map((r) => r.rideId));

  const expiryMs = (cfg.queuedRidesExpirySeconds ?? 45) * 1000;
  const radiusKm = cfg.queuedRidesRadiusKm ?? 3;

  const result: QueuedCandidate[] = [];
  for (const row of candidates) {
    const r = row.ride;
    if (queuedSet.has(r.id)) continue;
    if (recentlyDeclined(driverId, r.id)) continue;
    if (r.riderId === driverId) continue;
    if (r.pickupLat == null || r.pickupLng == null) continue;

    // Strict vehicle-type / capability match (fail closed). Replaces the
    // previous loose category-only check that allowed cross-type matches
    // within the same category.
    if (!matchesQueuedRideRequirements(r, driverVt, row.vehicleCategory)) {
      continue;
    }

    const dist = calculateDistanceKm(
      currentTrip.dropoffLat,
      currentTrip.dropoffLng,
      r.pickupLat,
      r.pickupLng,
    );
    if (dist == null || dist > radiusKm) continue;

    // Stable per-(driver, ride) offer expiry — see getOrCreateOfferExpiry.
    // If null the offer window has already passed; skip the candidate so
    // it isn't redelivered with a refreshed countdown on the next poll.
    const stableExpiresAt = getOrCreateOfferExpiry(driverId, r.id, expiryMs);
    if (stableExpiresAt == null) continue;

    result.push({
      rideId: r.id,
      riderId: r.riderId,
      riderName: row.rider?.firstName ?? "Rider",
      pickupLabel: r.pickupLabel,
      pickupAddress: r.pickupAddress,
      pickupLat: r.pickupLat,
      pickupLng: r.pickupLng,
      dropoffLabel: r.dropoffLabel,
      dropoffAddress: r.dropoffAddress,
      dropoffLat: r.dropoffLat,
      dropoffLng: r.dropoffLng,
      estimatedDistanceKm: r.estimatedDistanceKm,
      estimatedDurationMin: r.estimatedDurationMin,
      initialFare: r.initialFare ?? null,
      suggestedFare: r.initialFare ?? r.fareBreakdown?.total ?? 0,
      vehicleClass: r.vehicleClass ?? null,
      vehicleTypeId: r.vehicleTypeId ?? null,
      distanceFromCurrentDropoffKm: Math.round(dist * 100) / 100,
      expiresAtMs: stableExpiresAt,
      routePolyline: r.routePolyline ?? null,
    });
    if (result.length >= limit) break;
  }
  // Nearest pickup first.
  result.sort(
    (a, b) =>
      a.distanceFromCurrentDropoffKm - b.distanceFromCurrentDropoffKm,
  );
  return result;
}

/**
 * Returns true if the driver's CURRENT trip is close enough to its dropoff
 * that we should start surfacing queued candidates.
 */
export async function shouldOfferQueuedRides(
  driverId: string,
  currentTripId: string,
): Promise<boolean> {
  const cfg = await getConfig();
  if (!cfg.queuedRidesEnabled) return false;
  const [trip] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, currentTripId))
    .limit(1);
  if (!trip) return false;
  if (trip.status !== "in_progress" && trip.status !== "driver_arriving") return false;
  if (trip.dropoffLat == null || trip.dropoffLng == null) return false;

  const pos = getDriverLivePosition(driverId);
  if (!pos) return false;
  const remainingKm = calculateDistanceKm(
    pos.lat,
    pos.lng,
    trip.dropoffLat,
    trip.dropoffLng,
  );
  if (remainingKm == null) return false;

  // Two thresholds — either is sufficient to start offering queued rides:
  //   1. Distance threshold (leadDistanceKm)
  //   2. Time threshold (leadMinutes), converted to a distance using the
  //      trip's own average estimated speed (km/h). When estimates are
  //      missing we fall back to a conservative 30 km/h urban average.
  const leadDistanceKm = cfg.queuedRidesLeadDistanceKm ?? 2;
  const leadMinutes = cfg.queuedRidesLeadMinutes ?? 4;
  const estDist = trip.estimatedDistanceKm ?? 0;
  const estDur = trip.estimatedDurationMin ?? 0;
  const avgSpeedKmh = estDist > 0 && estDur > 0 ? (estDist / estDur) * 60 : 30;
  const leadMinutesAsKm = (leadMinutes / 60) * avgSpeedKmh;
  const effectiveThresholdKm = Math.max(leadDistanceKm, leadMinutesAsKm);
  return remainingKm <= effectiveThresholdKm;
}

/**
 * Atomically queue a candidate ride for the driver. Uses row-level locking
 * on the rides table so two drivers cannot queue the same ride.
 */
export async function acceptQueuedRide(
  driverId: string,
  rideId: string,
  currentTripId: string,
): Promise<{
  ok: boolean;
  reason?: string;
  queueId?: string;
  ride?: typeof ridesTable.$inferSelect;
}> {
  if (!(await canDriverReceiveQueuedRequest(driverId))) {
    return { ok: false, reason: "driver_at_capacity" };
  }
  // Server-side eligibility re-check — never trust the candidate list alone.
  // The driver must currently be close enough to the dropoff (lead distance/
  // time threshold) to be allowed to queue ANY ride.
  if (!(await shouldOfferQueuedRides(driverId, currentTripId))) {
    return { ok: false, reason: "driver_not_in_lead_window" };
  }
  const cfgPre = await getConfig();
  const driverVtPre = await loadDriverVehicleType(driverId);
  try {
    return await db.transaction(async (tx) => {
      const [currentTrip] = await tx
        .select()
        .from(ridesTable)
        .where(eq(ridesTable.id, currentTripId))
        .for("update")
        .limit(1);
      if (!currentTrip) return { ok: false, reason: "current_trip_not_found" };
      if (currentTrip.acceptedDriverId !== driverId) {
        return { ok: false, reason: "not_your_trip" };
      }
      if (
        currentTrip.status !== "driver_arriving" &&
        currentTrip.status !== "in_progress"
      ) {
        return { ok: false, reason: "current_trip_not_active" };
      }
      if (currentTrip.dropoffLat == null || currentTrip.dropoffLng == null) {
        return { ok: false, reason: "current_trip_missing_dropoff" };
      }

      const [target] = await tx
        .select()
        .from(ridesTable)
        .where(eq(ridesTable.id, rideId))
        .for("update")
        .limit(1);
      if (!target) return { ok: false, reason: "ride_not_found" };
      if (target.status !== "bidding") {
        return { ok: false, reason: "ride_no_longer_available" };
      }
      if (target.riderId === driverId) {
        return { ok: false, reason: "cannot_queue_own_ride" };
      }
      if (target.pickupLat == null || target.pickupLng == null) {
        return { ok: false, reason: "ride_missing_pickup" };
      }

      // Radius enforcement: pickup must be within configured radius of the
      // driver's current dropoff. Belt-and-suspenders with the candidate
      // list (which already filters) — caller cannot bypass via direct POST.
      const radiusKm = cfgPre.queuedRidesRadiusKm ?? 3;
      const dist = calculateDistanceKm(
        currentTrip.dropoffLat,
        currentTrip.dropoffLng,
        target.pickupLat,
        target.pickupLng,
      );
      if (dist == null || dist > radiusKm) {
        return { ok: false, reason: "pickup_outside_radius" };
      }

      // Strict vehicle-type / capability gate. Mirrors the candidate-list
      // filter so a driver cannot accept a ride they aren't eligible for
      // by calling /accept directly. Fails closed on any missing
      // metadata.
      let targetCategory: string | null = null;
      if (target.vehicleTypeId) {
        const [targetVt] = await tx
          .select({ vehicleCategory: vehicleTypesTable.vehicleCategory })
          .from(vehicleTypesTable)
          .where(eq(vehicleTypesTable.id, target.vehicleTypeId))
          .limit(1);
        targetCategory = targetVt?.vehicleCategory ?? null;
      }
      if (!matchesQueuedRideRequirements(target, driverVtPre, targetCategory)) {
        return { ok: false, reason: "vehicle_requirements_mismatch" };
      }

      // Re-check capacity inside the transaction.
      const existing = await tx
        .select({ id: driverQueuedRidesTable.id })
        .from(driverQueuedRidesTable)
        .where(
          and(
            eq(driverQueuedRidesTable.driverId, driverId),
            inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
          ),
        );
      const cfg = cfgPre;
      if (existing.length >= (cfg.queuedRidesMaxPerDriver ?? 1)) {
        return { ok: false, reason: "driver_at_capacity" };
      }

      // expiresAt is a hard ceiling: if the driver's current trip drags on
      // past this point the queued ride is auto-released so the rider isn't
      // stranded. We use the current trip's estimated remaining duration
      // plus a generous buffer (the configured offer-expiry seconds, default
      // 45s, treated as minutes of buffer here).
      const bufferMin = Math.max(5, Math.ceil((cfg.queuedRidesExpirySeconds ?? 45) / 60) + 5);
      const remainingMin = Math.max(currentTrip.estimatedDurationMin ?? 0, 5);
      const expiresAt = new Date(Date.now() + (remainingMin + bufferMin) * 60_000);

      const [queue] = await tx
        .insert(driverQueuedRidesTable)
        .values({
          driverId,
          currentTripId,
          nextTripId: rideId,
          status: "accepted",
          pickupLat: target.pickupLat,
          pickupLng: target.pickupLng,
          dropoffLat: target.dropoffLat,
          dropoffLng: target.dropoffLng,
          expiresAt,
        })
        .returning();

      const [updatedRide] = await tx
        .update(ridesTable)
        .set({
          status: "assigned_next",
          queuedDriverId: driverId,
          queueStatus: "accepted",
          queuedAt: new Date(),
          previousTripId: currentTripId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(ridesTable.id, rideId), eq(ridesTable.status, "bidding")),
        )
        .returning();
      if (!updatedRide) {
        throw new Error("ride_no_longer_available");
      }
      return { ok: true, queueId: queue.id, ride: updatedRide };
    });
  } catch (err) {
    logger.warn(
      { err, driverId, rideId, currentTripId },
      "[queuedRides] acceptQueuedRide failed",
    );
    return { ok: false, reason: "conflict" };
  }
}

/**
 * Inner logic shared by the standalone and transaction-aware variants of
 * activateQueuedRideAfterCompletion. The activation is strictly tied to the
 * `completedTripId` — the queue row's `currentTripId` MUST match, otherwise
 * we refuse to activate (prevents a stale queue row from a different trip
 * being promoted by accident).
 */
async function activateInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  driverId: string,
  completedTripId: string,
): Promise<{ activatedRideId: string; rideStatus: string } | null> {
  const [queue] = await tx
    .select()
    .from(driverQueuedRidesTable)
    .where(
      and(
        eq(driverQueuedRidesTable.driverId, driverId),
        eq(driverQueuedRidesTable.status, "accepted"),
        eq(driverQueuedRidesTable.currentTripId, completedTripId),
      ),
    )
    .for("update")
    .limit(1);
  if (!queue) return null;

  // Invariant: the driver MUST NOT have any other active trip besides the
  // one we're activating from. Belt-and-braces against any caller that
  // bypasses the route-level "trip must be completed" check.
  const otherActive = await tx
    .select({ id: ridesTable.id })
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.acceptedDriverId, driverId),
        inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
      ),
    )
    .limit(1);
  if (otherActive.length > 0) {
    logger.warn(
      { driverId, completedTripId, otherActiveId: otherActive[0]!.id },
      "[queuedRides] refusing activation — driver still has an active trip",
    );
    return null;
  }

  // Hard expiry guard: if the driver's current trip dragged on past the
  // queued ride's expiry we release it instead of activating.
  if (queue.expiresAt && queue.expiresAt.getTime() < Date.now()) {
    await tx
      .update(driverQueuedRidesTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(driverQueuedRidesTable.id, queue.id));
    await tx
      .update(ridesTable)
      .set({
        status: "bidding",
        queuedDriverId: null,
        queueStatus: "cancelled",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ridesTable.id, queue.nextTripId),
          inArray(ridesTable.status, ["assigned_next", "queued"]),
        ),
      );
    return null;
  }

  const [target] = await tx
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, queue.nextTripId))
    .for("update")
    .limit(1);
  if (!target) {
    await tx
      .update(driverQueuedRidesTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(driverQueuedRidesTable.id, queue.id));
    return null;
  }
  if (target.status !== "assigned_next" && target.status !== "queued") {
    // Rider may have cancelled in the meantime.
    await tx
      .update(driverQueuedRidesTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(driverQueuedRidesTable.id, queue.id));
    return null;
  }

  // Create a synthetic accepted bid for the queued driver. The rider trip UI
  // (and many other downstream consumers) keys off `acceptedBidId` to render
  // the matched-driver state — without this the rider would land on a blank
  // screen after activation. The bid amount mirrors the fare we promised the
  // driver at accept time, so wallet/earnings flows stay consistent.
  const bidAmount = target.initialFare ?? target.finalAmount ?? 0;
  const [bid] = await tx
    .insert(bidsTable)
    .values({
      rideId: target.id,
      driverId,
      amount: bidAmount,
      etaMin: 1,
      status: "accepted",
    })
    .returning();

  const [updated] = await tx
    .update(ridesTable)
    .set({
      status: "driver_arriving",
      acceptedDriverId: driverId,
      acceptedBidId: bid.id,
      queueStatus: "activated",
      updatedAt: new Date(),
    })
    .where(eq(ridesTable.id, target.id))
    .returning();

  await tx
    .update(driverQueuedRidesTable)
    .set({ status: "activated", updatedAt: new Date() })
    .where(eq(driverQueuedRidesTable.id, queue.id));

  return { activatedRideId: updated.id, rideStatus: updated.status };
}

/**
 * Transaction-aware variant. Used by /rides/:id/complete so the trip
 * completion update and queued-ride activation happen atomically.
 */
export async function activateQueuedRideAfterCompletionTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  driverId: string,
  completedTripId: string,
): Promise<{ activatedRideId: string; rideStatus: string } | null> {
  return activateInTx(tx, driverId, completedTripId);
}

/**
 * Standalone variant — opens its own transaction. Kept for the manual
 * /system/activate-next-queued-ride retry endpoint.
 */
export async function activateQueuedRideAfterCompletion(
  driverId: string,
  completedTripId: string,
): Promise<{
  activatedRideId: string;
  rideStatus: string;
} | null> {
  try {
    return await db.transaction((tx) => activateInTx(tx, driverId, completedTripId));
  } catch (err) {
    logger.error(
      { err, driverId, completedTripId },
      "[queuedRides] activateQueuedRideAfterCompletion failed",
    );
    return null;
  }
}

/**
 * Sweep all queue rows whose expires_at has passed and release them.
 * Used as a request-time guard so an expired queued ride doesn't sit
 * reserved indefinitely if the current trip drags on or the driver app
 * stalls. Cheap to call on every queued-ride request (single indexed
 * scan + bounded updates).
 */
export async function releaseExpiredQueuedRides(): Promise<{
  releasedRideIds: string[];
  notifiedDriverIds: string[];
}> {
  try {
    const result = await db.transaction(async (tx) => {
      const expired = await tx
        .select()
        .from(driverQueuedRidesTable)
        .where(
          and(
            inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
            sql`${driverQueuedRidesTable.expiresAt} IS NOT NULL`,
            sql`${driverQueuedRidesTable.expiresAt} < NOW()`,
          ),
        )
        .for("update");
      const releasedRideIds: string[] = [];
      const notifiedDriverIds: string[] = [];
      for (const q of expired) {
        await tx
          .update(driverQueuedRidesTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(driverQueuedRidesTable.id, q.id));
        const [updated] = await tx
          .update(ridesTable)
          .set({
            status: "bidding",
            queuedDriverId: null,
            queueStatus: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ridesTable.id, q.nextTripId),
              inArray(ridesTable.status, ["assigned_next", "queued"]),
            ),
          )
          .returning();
        if (updated) {
          releasedRideIds.push(updated.id);
          notifiedDriverIds.push(q.driverId);
        }
      }
      return { releasedRideIds, notifiedDriverIds };
    });
    for (let i = 0; i < result.releasedRideIds.length; i++) {
      const rideId = result.releasedRideIds[i];
      const driverId = result.notifiedDriverIds[i];
      emitToRide(rideId, "queuedRideDeclined", { rideId, reason: "expired" });
      emitToUser(driverId, "queuedRideDeclined", { rideId, reason: "expired" });
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "[queuedRides] releaseExpiredQueuedRides failed");
    return { releasedRideIds: [], notifiedDriverIds: [] };
  }
}

/**
 * Release any pending/accepted queued rides for this driver, restoring the
 * underlying ride back to `bidding` so other drivers can pick it up.
 * Used on current-trip cancel and driver-goes-offline.
 */
export async function releaseQueuedRidesForDriver(
  driverId: string,
  reason: "current_cancelled" | "driver_offline" | "manual",
): Promise<{ releasedRideIds: string[] }> {
  try {
    const result = await db.transaction(async (tx) => {
      const queued = await tx
        .select()
        .from(driverQueuedRidesTable)
        .where(
          and(
            eq(driverQueuedRidesTable.driverId, driverId),
            inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
          ),
        )
        .for("update");
      const releasedRideIds: string[] = [];
      for (const q of queued) {
        await tx
          .update(driverQueuedRidesTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(driverQueuedRidesTable.id, q.id));
        const [updated] = await tx
          .update(ridesTable)
          .set({
            status: "bidding",
            queuedDriverId: null,
            queueStatus: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ridesTable.id, q.nextTripId),
              inArray(ridesTable.status, ["assigned_next", "queued"]),
            ),
          )
          .returning();
        if (updated) releasedRideIds.push(updated.id);
      }
      return { releasedRideIds };
    });
    for (const rideId of result.releasedRideIds) {
      emitToRide(rideId, "queuedRideDeclined", { rideId, reason });
    }
    return result;
  } catch (err) {
    logger.error(
      { err, driverId, reason },
      "[queuedRides] releaseQueuedRidesForDriver failed",
    );
    return { releasedRideIds: [] };
  }
}

/**
 * Release a single queued ride when the rider cancels it.
 */
export async function releaseQueuedRideForRider(
  rideId: string,
): Promise<boolean> {
  try {
    const [queue] = await db
      .select()
      .from(driverQueuedRidesTable)
      .where(
        and(
          eq(driverQueuedRidesTable.nextTripId, rideId),
          inArray(driverQueuedRidesTable.status, ["pending", "accepted"]),
        ),
      )
      .limit(1);
    if (!queue) return false;
    await db
      .update(driverQueuedRidesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(driverQueuedRidesTable.id, queue.id));
    emitToUser(queue.driverId, "queuedRideDeclined", {
      rideId,
      reason: "rider_cancelled",
    });
    return true;
  } catch (err) {
    logger.warn(
      { err, rideId },
      "[queuedRides] releaseQueuedRideForRider failed",
    );
    return false;
  }
}

/**
 * Returns the driver's currently-accepted queued ride (if any). Used by the
 * driver app to render the "Next ride queued" indicator.
 */
export async function getDriverActiveQueuedRide(
  driverId: string,
): Promise<{
  queueId: string;
  ride: typeof ridesTable.$inferSelect;
} | null> {
  const [q] = await db
    .select()
    .from(driverQueuedRidesTable)
    .where(
      and(
        eq(driverQueuedRidesTable.driverId, driverId),
        eq(driverQueuedRidesTable.status, "accepted"),
      ),
    )
    .orderBy(desc(driverQueuedRidesTable.createdAt))
    .limit(1);
  if (!q) return null;
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, q.nextTripId))
    .limit(1);
  if (!ride) return null;
  return { queueId: q.id, ride };
}
