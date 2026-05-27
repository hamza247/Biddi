/**
 * Driver destination-mode matching helpers.
 *
 * Drivers can opt into a destination-bound filter: when active, only ride
 * requests heading toward that destination are surfaced in
 * GET /driver/requests. We use Haversine for the dropoff-radius check and a
 * bearing-corridor (cross-track distance) check as a fallback when the
 * dropoff alone is outside the radius — that captures rides that pass
 * "through" the destination on the way somewhere a bit further.
 *
 * No external routing API is consulted; everything is computed from the
 * pickup/dropoff coordinates already on the ride row.
 */
import { db, driverDestinationModesTable, ridesTable } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { getConfig } from "./settings";

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Signed cross-track distance (km) from point P to the great-circle through
 * A→B. Sign indicates side of the line; callers usually take Math.abs().
 */
export function crossTrackDistanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
  pLat: number,
  pLng: number,
): number {
  const d13 = haversineKm(aLat, aLng, pLat, pLng) / EARTH_RADIUS_KM;
  const θ13 = bearingRad(aLat, aLng, pLat, pLng);
  const θ12 = bearingRad(aLat, aLng, bLat, bLng);
  const xt = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  return Math.abs(xt) * EARTH_RADIUS_KM;
}

/**
 * Along-track distance (km) from A to the projection of P onto the
 * great-circle A→B. Negative means P projects "behind" A; values larger
 * than the A→B distance mean P projects past B. Used together with
 * cross-track to clamp matching to the actual pickup→dropoff segment.
 */
export function alongTrackDistanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
  pLat: number,
  pLng: number,
): number {
  const d13 = haversineKm(aLat, aLng, pLat, pLng) / EARTH_RADIUS_KM;
  const θ13 = bearingRad(aLat, aLng, pLat, pLng);
  const θ12 = bearingRad(aLat, aLng, bLat, bLng);
  const xt = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  // Math.acos can return NaN for tiny floating errors when |x| ~ 1;
  // clamp the ratio to keep the result well-defined.
  const ratio = Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt)));
  const sign = Math.cos(θ12 - θ13) >= 0 ? 1 : -1;
  return sign * Math.acos(ratio) * EARTH_RADIUS_KM;
}

function bearingRad(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}

export interface ActiveDestinationMode {
  id: string;
  destLat: number;
  destLng: number;
  destinationAddress: string;
  destinationLabel: string;
  activatedAt: Date;
  expiresAt: Date | null;
}

/**
 * Returns the driver's currently-active destination mode row, transparently
 * deactivating it if the configured time-window has elapsed since
 * activation.
 */
export async function getActiveDestinationMode(
  driverId: string,
): Promise<ActiveDestinationMode | null> {
  const [row] = await db
    .select()
    .from(driverDestinationModesTable)
    .where(
      and(
        eq(driverDestinationModesTable.driverId, driverId),
        eq(driverDestinationModesTable.isActive, true),
      ),
    )
    .orderBy(desc(driverDestinationModesTable.activatedAt))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await db
      .update(driverDestinationModesTable)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedReason: "expired",
        updatedAt: new Date(),
      })
      .where(eq(driverDestinationModesTable.id, row.id));
    return null;
  }
  return {
    id: row.id,
    destLat: row.destLat,
    destLng: row.destLng,
    destinationAddress: row.destinationAddress,
    destinationLabel: row.destinationLabel,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Count activations the driver has made since UTC midnight today. Used to
 * enforce destinationModeMaxPerDay.
 */
export async function countActivationsToday(driverId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: driverDestinationModesTable.id })
    .from(driverDestinationModesTable)
    .where(
      and(
        eq(driverDestinationModesTable.driverId, driverId),
        gte(driverDestinationModesTable.createdAt, startOfDay),
      ),
    );
  return rows.length;
}

/**
 * Decide whether a candidate ride should be shown to a driver in
 * destination mode. A ride passes if either:
 *   - its dropoff is within `matchRadiusKm` of the destination, OR
 *   - the destination's projection onto the pickup→dropoff segment falls
 *     within the segment (along-track in [0, pickupToDrop]) AND the
 *     perpendicular (cross-track) distance is within `corridorKm`.
 *
 * The segment clamp matters: a destination behind the pickup or past the
 * dropoff that happens to be collinear with the route would otherwise pass
 * the cross-track check and surface a ride heading the wrong way.
 */
export function rideMatchesDestination(
  ride: {
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffLat: number | null;
    dropoffLng: number | null;
  },
  dest: { destLat: number; destLng: number },
  cfg: { matchRadiusKm: number; corridorKm: number },
): boolean {
  if (
    ride.dropoffLat == null ||
    ride.dropoffLng == null ||
    ride.pickupLat == null ||
    ride.pickupLng == null
  ) {
    return false;
  }
  const dropToDest = haversineKm(
    ride.dropoffLat,
    ride.dropoffLng,
    dest.destLat,
    dest.destLng,
  );
  if (dropToDest <= cfg.matchRadiusKm) return true;

  const pickupToDrop = haversineKm(
    ride.pickupLat,
    ride.pickupLng,
    ride.dropoffLat,
    ride.dropoffLng,
  );
  if (pickupToDrop <= 0) return false;

  const at = alongTrackDistanceKm(
    ride.pickupLat,
    ride.pickupLng,
    ride.dropoffLat,
    ride.dropoffLng,
    dest.destLat,
    dest.destLng,
  );
  // Allow a small tolerance equal to the corridor width past the dropoff
  // so destinations slightly beyond a near-by dropoff still qualify.
  if (at < 0 || at > pickupToDrop + cfg.corridorKm) return false;

  const xt = crossTrackDistanceKm(
    ride.pickupLat,
    ride.pickupLng,
    ride.dropoffLat,
    ride.dropoffLng,
    dest.destLat,
    dest.destLng,
  );
  return xt <= cfg.corridorKm;
}

export async function loadDestinationModeConfig() {
  const cfg = await getConfig();
  return {
    enabled: cfg.destinationModeEnabled,
    maxPerDay: cfg.destinationModeMaxPerDay,
    matchRadiusKm: cfg.destinationModeMatchRadiusKm,
    corridorKm: cfg.destinationModeCorridorKm,
    autoDisableOnTrip: cfg.destinationModeAutoDisableOnTrip,
    autoDisableMinutes: cfg.destinationModeAutoDisableMinutes,
  };
}

/**
 * Hook fired from POST /rides/:id/complete. If the completing driver has
 * destination mode active and either (a) the dropoff matched their
 * destination or (b) the admin has the auto-disable-on-trip toggle on,
 * deactivate the mode. Safe to call best-effort — never throws.
 */
export async function maybeAutoDisableAfterCompletion(
  driverId: string,
  ride: { id: string; dropoffLat: number | null; dropoffLng: number | null },
): Promise<{ deactivated: boolean; reason?: string }> {
  const active = await getActiveDestinationMode(driverId);
  if (!active) return { deactivated: false };
  const cfg = await loadDestinationModeConfig();
  if (!cfg.autoDisableOnTrip) return { deactivated: false };
  if (ride.dropoffLat == null || ride.dropoffLng == null) {
    return { deactivated: false };
  }
  const d = haversineKm(
    ride.dropoffLat,
    ride.dropoffLng,
    active.destLat,
    active.destLng,
  );
  if (d > cfg.matchRadiusKm) return { deactivated: false };
  await db
    .update(driverDestinationModesTable)
    .set({
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedReason: "trip_completed",
      completedTripId: ride.id,
      updatedAt: new Date(),
    })
    .where(eq(driverDestinationModesTable.id, active.id));
  return { deactivated: true, reason: "trip_completed" };
}
