import { Server as IOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { db, usersTable, vehiclesTable, vehicleTypesTable, ridesTable, tripMessagesTable, driverLivePositionsTable, driverTrailPointsTable } from "@workspace/db";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { verifyToken } from "./auth";
import { logger } from "./logger";

let io: IOServer | null = null;

interface DriverLocationEntry {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  lastSeenAt: number;
  name: string;
  vehicle: string | null;
  vehicleCategory: "car" | "moto";
  // Phone and plate are surfaced to admin clients so the live-map popup can
  // show contact + vehicle identifiers without an extra fetch. Both default
  // to null when the driver row or vehicle row is missing the value.
  phone: string | null;
  plate: string | null;
}

interface RiderSubscription {
  userId: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const POSITION_TTL_MS = 120_000;
const SWEEP_INTERVAL_MS = 15_000;
const DEFAULT_RADIUS_KM = 5;
const DISCONNECT_GRACE_MS = 15_000;

// How often (ms) a driver's last-known position is flushed to the
// users.last_known_* fallback columns.  The primary crash-safe store
// (driver_live_positions) is upserted on every GPS tick, so this
// throttle only affects the secondary warm-up path.  5 s keeps the
// fallback within a single GPS-reporting cycle of the live value while
// avoiding per-tick write-amplification on the users table.
// Override via DRIVER_PERSIST_INTERVAL_MS env var (integer ms, min 1000, max 60000).
const _persistIntervalEnv = parseInt(process.env.DRIVER_PERSIST_INTERVAL_MS ?? "", 10);
const POSITION_PERSIST_INTERVAL_MS = (
  Number.isFinite(_persistIntervalEnv) && _persistIntervalEnv >= 1_000 && _persistIntervalEnv <= 60_000
    ? _persistIntervalEnv
    : 5_000
);
// Maximum age of a DB-persisted position that we're willing to use for
// the warm-up snapshot. Default is 24 hours so that drivers whose last
// GPS fix was earlier today still appear on the admin map after a server
// restart. The staleness label on the frontend provides the visual
// distinction between live and last-known pins.
// Override via WARM_UP_MAX_AGE_HOURS env var (integer, min 1, max 168).
const _warmUpHoursEnv = parseInt(process.env.WARM_UP_MAX_AGE_HOURS ?? "", 10);
const WARM_UP_MAX_AGE_MS = (Number.isFinite(_warmUpHoursEnv) && _warmUpHoursEnv >= 1 && _warmUpHoursEnv <= 168
  ? _warmUpHoursEnv
  : 24) * 60 * 60_000;

// Per-driver timer used to throttle DB persistence.
const positionPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Resolved once the startup warm-up query has completed.  Admin and
// rider connections that arrive before this promise settles will await
// it so their initial snapshot reflects the warmed-up state.
let warmUpPromise: Promise<void> = Promise.resolve();

const livePositions = new Map<string, DriverLocationEntry>();
const driverSockets = new Map<string, Set<string>>();

// In-memory trail buffer: accumulates GPS fixes per driver, scoped to the
// current active ride.  A new active rideId resets the buffer so old-trip
// coordinates never bleed into a new trip.  The buffer is used for:
//   1. Real-time live-extension: the socket `driver:location` broadcast
//      lets the admin map append points without polling.
//   2. Batch DB persistence: every TRAIL_PERSIST_INTERVAL_MS the buffered
//      points that have not yet been written to driver_trail_points are
//      flushed, so trails survive server restarts.
// The HTTP endpoint reads from the DB (not this buffer), so it is always
// restart-safe.  This buffer is cleared on dropDriver.
const TRAIL_MAX_POINTS = 200;
// How often (ms) accumulated trail points are flushed to the DB.
const TRAIL_PERSIST_INTERVAL_MS = 5_000;
interface TrailPoint { lat: number; lng: number; ts: number }
interface DriverTrailBuffer {
  rideId: string | null;
  points: TrailPoint[];
  // Index into `points` of the first point not yet persisted to the DB.
  // Everything before this index has already been inserted.
  persistedUpTo: number;
}
const driverTrails = new Map<string, DriverTrailBuffer>();
// Per-driver timers that schedule the next trail-point DB flush.
const trailPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingDropTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeRideByDriver = new Map<
  string,
  { rideId: string; rideStatus: string }
>();
const ACTIVE_RIDE_REFRESH_MS = 5_000;

// Tracks queued-ride eligibility per (driver, currentTripId) so we only emit
// `queuedRideRequest` when the driver newly transitions into eligibility for
// a given active trip. Throttled by `lastChecked` so we don't hit the DB on
// every GPS tick. Entries are cleared when the driver loses their active ride.
interface QueuedEligibilityState {
  tripId: string;
  eligible: boolean;
  lastCheckedAt: number;
  inFlight: boolean;
}
const queuedEligibility = new Map<string, QueuedEligibilityState>();
const QUEUED_ELIGIBILITY_CHECK_MS = 5_000;

// socketId -> rider subscription (used to scope nearby driver broadcasts)
const riderSubscriptions = new Map<string, RiderSubscription>();

const ADMIN_ROOM = "admins:live-map";
const HEATMAP_ROOM = "drivers:heatmap";

const chatPresence = new Map<string, Map<string, Set<string>>>();

function addChatPresence(tripId: string, userId: string, socketId: string): boolean {
  let usersForTrip = chatPresence.get(tripId);
  if (!usersForTrip) {
    usersForTrip = new Map();
    chatPresence.set(tripId, usersForTrip);
  }
  let socks = usersForTrip.get(userId);
  const wasPresent = !!socks && socks.size > 0;
  if (!socks) {
    socks = new Set();
    usersForTrip.set(userId, socks);
  }
  socks.add(socketId);
  return !wasPresent;
}

function removeChatPresence(tripId: string, userId: string, socketId: string): boolean {
  const usersForTrip = chatPresence.get(tripId);
  if (!usersForTrip) return false;
  const socks = usersForTrip.get(userId);
  if (!socks) return false;
  socks.delete(socketId);
  if (socks.size === 0) {
    usersForTrip.delete(userId);
    if (usersForTrip.size === 0) chatPresence.delete(tripId);
    return true;
  }
  return false;
}

function removeAllChatPresenceForSocket(socketId: string, userId: string): string[] {
  const departed: string[] = [];
  for (const [tripId, usersForTrip] of chatPresence) {
    const socks = usersForTrip.get(userId);
    if (!socks || !socks.has(socketId)) continue;
    socks.delete(socketId);
    if (socks.size === 0) {
      usersForTrip.delete(userId);
      if (usersForTrip.size === 0) chatPresence.delete(tripId);
      departed.push(tripId);
    }
  }
  return departed;
}

export function isUserInChat(tripId: string, userId: string): boolean {
  const usersForTrip = chatPresence.get(tripId);
  const socks = usersForTrip?.get(userId);
  return !!socks && socks.size > 0;
}

export function getChatPeers(tripId: string): string[] {
  const usersForTrip = chatPresence.get(tripId);
  if (!usersForTrip) return [];
  return Array.from(usersForTrip.keys());
}

// ---------- Haversine distance ----------
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

interface DriverEnrichment {
  name: string;
  vehicle: string | null;
  vehicleCategory: "car" | "moto";
  phone: string | null;
  plate: string | null;
}

async function loadDriverEnrichment(userId: string): Promise<DriverEnrichment> {
  const [row] = await db
    .select({
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      plate: vehiclesTable.plate,
    })
    .from(usersTable)
    .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!row) return { name: "Driver", vehicle: null, vehicleCategory: "car", phone: null, plate: null };

  const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "Driver";
  const vehicle = row.make && row.model ? `${row.make} ${row.model}`.trim() : null;
  return { name, vehicle, vehicleCategory: "car", phone: row.phone ?? null, plate: row.plate ?? null };
}

function entryToBroadcast(id: string, e: DriverLocationEntry) {
  const ride = activeRideByDriver.get(id);
  return {
    id,
    name: e.name,
    vehicle: e.vehicle,
    vehicleCategory: e.vehicleCategory,
    phone: e.phone,
    plate: e.plate,
    lat: e.lat,
    lng: e.lng,
    heading: e.heading,
    speed: e.speed,
    accuracy: e.accuracy,
    lastSeenAt: e.lastSeenAt,
    rideId: ride?.rideId ?? null,
    rideStatus: ride?.rideStatus ?? null,
  };
}

// Strict, single source of truth for "this coordinate is plottable on the map".
// Mirrors the frontend `isValidCoordinate` exactly: rejects null/NaN/Infinity,
// out-of-range values, AND the (0,0) sentinel which is overwhelmingly
// indicative of an uninitialised default rather than the actual Null Island
// location. Used by socket broadcasts, REST snapshots, and warm-up.
function isValidLatLng(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

function entryToRiderBroadcast(id: string, e: DriverLocationEntry) {
  return {
    id,
    vehicleCategory: e.vehicleCategory,
    lat: e.lat,
    lng: e.lng,
    heading: e.heading,
    speed: e.speed,
  };
}

// Returns all live drivers filtered by proximity to a rider's center.
// Drops any entry without finite, in-range coordinates so a corrupt cache
// row can't propagate to clients.
export function getLiveDriversForRiders(
  lat?: number,
  lng?: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
): {
  id: string;
  vehicleCategory: "car" | "moto";
  lat: number;
  lng: number;
  heading?: number;
}[] {
  const result: ReturnType<typeof getLiveDriversForRiders> = [];
  for (const [id, entry] of livePositions) {
    if (!id || !isValidLatLng(entry.lat, entry.lng)) continue;
    if (lat != null && lng != null) {
      if (haversineKm(lat, lng, entry.lat, entry.lng) > radiusKm) continue;
    }
    result.push(entryToRiderBroadcast(id, entry));
  }
  return result;
}

// Emit a driver location update to all rider sockets that are within range of the driver.
function broadcastDriverUpdateToNearbyRiders(driverId: string, entry: DriverLocationEntry) {
  if (!io) return;
  if (!driverId || !isValidLatLng(entry.lat, entry.lng)) return;
  const payload = entryToRiderBroadcast(driverId, entry);
  for (const [sockId, sub] of riderSubscriptions) {
    if (haversineKm(sub.lat, sub.lng, entry.lat, entry.lng) <= sub.radiusKm) {
      io.to(sockId).emit("nearby:driver_update", payload);
    }
  }
}

// Emit a driver offline event to all subscribed rider sockets.
function broadcastDriverOfflineToRiders(driverId: string) {
  if (!io) return;
  const payload = { id: driverId };
  for (const [sockId] of riderSubscriptions) {
    io.to(sockId).emit("nearby:driver_offline", payload);
  }
}

async function refreshActiveRides(): Promise<void> {
  const ids = Array.from(livePositions.keys());
  if (ids.length === 0) {
    if (activeRideByDriver.size > 0) activeRideByDriver.clear();
    return;
  }
  try {
    const rides = await db
      .select({
        id: ridesTable.id,
        driverId: ridesTable.acceptedDriverId,
        status: ridesTable.status,
      })
      .from(ridesTable)
      .where(
        and(
          inArray(ridesTable.acceptedDriverId, ids),
          inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
        ),
      );
    const next = new Map<string, { rideId: string; rideStatus: string }>();
    for (const r of rides) {
      if (r.driverId) next.set(r.driverId, { rideId: r.id, rideStatus: r.status });
    }
    activeRideByDriver.clear();
    for (const [k, v] of next) activeRideByDriver.set(k, v);
  } catch (err) {
    logger.error({ err }, "failed to refresh active rides for live map");
  }
}

async function buildSnapshot() {
  await refreshActiveRides();
  const ids = Array.from(livePositions.keys());
  return {
    drivers: ids.map((id) => entryToBroadcast(id, livePositions.get(id)!)),
  };
}

// Schedule an offline drop after the grace period if one isn't already pending.
// Idempotent: a second call while a timer is live is a no-op.
// The timer is cancelled if driver:location arrives before it fires (indicating
// the driver's location stream has resumed on the new socket).
function scheduleGraceDrop(userId: string) {
  if (pendingDropTimers.has(userId)) return;
  const timer = setTimeout(() => {
    pendingDropTimers.delete(userId);
    dropDriver(userId, "disconnect");
  }, DISCONNECT_GRACE_MS);
  timer.unref?.();
  pendingDropTimers.set(userId, timer);
}

/**
 * On server start, pre-populate livePositions from the last DB-persisted
 * positions of drivers who had a recent update.
 *
 * Strategy (two passes):
 * 1. Read from `driver_live_positions` — the real-time persistent store that
 *    is upserted on every GPS tick. This recovers positions for drivers that
 *    sent location updates since the last throttled `users.last_known_*` write,
 *    including positions received just before a hard crash.
 * 2. Supplement with `users.last_known_lat/lng/at` for any approved driver
 *    whose row is not yet in `driver_live_positions` (e.g. they last connected
 *    before the dedicated table was introduced).
 */
async function warmUpPositions(): Promise<void> {
  const cutoff = new Date(Date.now() - WARM_UP_MAX_AGE_MS);

  // --- Pass 1: driver_live_positions (primary, crash-safe store) ---
  // Isolated try/catch so a failure here (e.g. table missing on first deploy)
  // never prevents Pass 2 from running.
  let liveCount = 0;
  try {
    const liveRows = await db
      .select({
        driverId: driverLivePositionsTable.driverId,
        lat: driverLivePositionsTable.lat,
        lng: driverLivePositionsTable.lng,
        heading: driverLivePositionsTable.heading,
        speed: driverLivePositionsTable.speed,
        accuracy: driverLivePositionsTable.accuracy,
        updatedAt: driverLivePositionsTable.updatedAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        plate: vehiclesTable.plate,
        vehicleCategory: vehicleTypesTable.vehicleCategory,
      })
      .from(driverLivePositionsTable)
      .innerJoin(usersTable, eq(usersTable.id, driverLivePositionsTable.driverId))
      .leftJoin(vehiclesTable, eq(vehiclesTable.userId, driverLivePositionsTable.driverId))
      .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
      .where(
        and(
          eq(usersTable.driverStatus, "approved"),
          sql`${driverLivePositionsTable.updatedAt} >= ${cutoff}`,
        ),
      );

    for (const row of liveRows) {
      if (!isValidLatLng(row.lat, row.lng)) continue;
      const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "Driver";
      const vehicle = row.make && row.model ? `${row.make} ${row.model}`.trim() : null;
      livePositions.set(row.driverId, {
        lat: row.lat,
        lng: row.lng,
        heading: row.heading ?? undefined,
        speed: row.speed ?? undefined,
        accuracy: row.accuracy ?? undefined,
        lastSeenAt: row.updatedAt.getTime(),
        name,
        vehicle,
        vehicleCategory: row.vehicleCategory ?? "car",
        phone: row.phone ?? null,
        plate: row.plate ?? null,
      });
      liveCount++;
    }
  } catch (err) {
    logger.error({ err }, "warm-up pass 1 (driver_live_positions) failed — falling back to users table");
  }

  // --- Pass 2: users.last_known_* fallback ---
  // Always runs regardless of pass-1 outcome. Fills gaps for drivers whose
  // row isn't in driver_live_positions yet (e.g. first deploy after migration).
  let fallbackCount = 0;
  try {
    const alreadySeeded = new Set(livePositions.keys());
    const fallbackRows = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        lastKnownLat: usersTable.lastKnownLat,
        lastKnownLng: usersTable.lastKnownLng,
        lastKnownHeading: usersTable.lastKnownHeading,
        lastKnownAt: usersTable.lastKnownAt,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        plate: vehiclesTable.plate,
        vehicleCategory: vehicleTypesTable.vehicleCategory,
      })
      .from(usersTable)
      .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
      .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
      .where(
        and(
          eq(usersTable.driverStatus, "approved"),
          sql`${usersTable.lastKnownLat} IS NOT NULL`,
          sql`${usersTable.lastKnownAt} >= ${cutoff}`,
        ),
      );

    for (const row of fallbackRows) {
      if (alreadySeeded.has(row.id)) continue;
      if (row.lastKnownLat == null || row.lastKnownLng == null) continue;
      if (!isValidLatLng(row.lastKnownLat, row.lastKnownLng)) continue;
      const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "Driver";
      const vehicle = row.make && row.model ? `${row.make} ${row.model}`.trim() : null;
      livePositions.set(row.id, {
        lat: row.lastKnownLat,
        lng: row.lastKnownLng,
        heading: row.lastKnownHeading ?? undefined,
        lastSeenAt: row.lastKnownAt ? row.lastKnownAt.getTime() : Date.now(),
        name,
        vehicle,
        vehicleCategory: row.vehicleCategory ?? "car",
        phone: row.phone ?? null,
        plate: row.plate ?? null,
      });
      fallbackCount++;
    }
  } catch (err) {
    logger.error({ err }, "warm-up pass 2 (users.last_known_*) failed");
  }

  const total = liveCount + fallbackCount;
  if (total > 0) {
    logger.info(
      { fromLiveTable: liveCount, fromFallback: fallbackCount, total },
      "warmed up livePositions from DB",
    );
  }
}

/**
 * Immediately upsert a driver's current position into the dedicated
 * `driver_live_positions` table. This is fire-and-forget — the caller
 * is never blocked. Because every GPS tick is upserted here (one row
 * per driver keyed by driverId), the table always reflects the most
 * recent known position and survives any kind of server restart,
 * including hard crashes that bypass the SIGTERM handler.
 */
function upsertLivePosition(driverId: string, entry: DriverLocationEntry): void {
  db.insert(driverLivePositionsTable)
    .values({
      driverId,
      lat: entry.lat,
      lng: entry.lng,
      heading: entry.heading ?? null,
      speed: entry.speed ?? null,
      accuracy: entry.accuracy ?? null,
      updatedAt: new Date(entry.lastSeenAt),
    })
    .onConflictDoUpdate({
      target: driverLivePositionsTable.driverId,
      set: {
        lat: entry.lat,
        lng: entry.lng,
        heading: entry.heading ?? null,
        speed: entry.speed ?? null,
        accuracy: entry.accuracy ?? null,
        updatedAt: new Date(entry.lastSeenAt),
      },
    })
    .catch((err) =>
      logger.error({ err, driverId }, "failed to upsert live position to driver_live_positions"),
    );
}

/**
 * Flushes unpersisted trail points for a driver to driver_trail_points.
 * Safe to call at any time (no-op if no unpersisted points).
 */
function flushTrailPoints(driverId: string): void {
  const buf = driverTrails.get(driverId);
  if (!buf || !buf.rideId) return;
  const unpersisted = buf.points.slice(buf.persistedUpTo);
  if (unpersisted.length === 0) return;
  const rideId = buf.rideId;
  // Snapshot the current end index *before* the async insert so we know
  // exactly which slice is in-flight.
  const newPersistedUpTo = buf.persistedUpTo + unpersisted.length;
  const rows = unpersisted.map((p) => ({
    driverId,
    rideId,
    lat: p.lat,
    lng: p.lng,
    recordedAt: new Date(p.ts),
  }));
  db.insert(driverTrailPointsTable)
    .values(rows)
    .then(() => {
      // Advance the cursor only after the insert succeeds so a transient
      // failure leaves the points eligible for retry on the next flush.
      const current = driverTrails.get(driverId);
      if (current && current.rideId === rideId) {
        current.persistedUpTo = Math.max(current.persistedUpTo, newPersistedUpTo);
      }
    })
    .catch((err) => logger.error({ err, driverId }, "failed to persist trail points to DB"));
}

/**
 * Schedules a throttled DB flush of trail points.
 * At most one flush per driver per TRAIL_PERSIST_INTERVAL_MS.
 */
function scheduleTrailPersist(driverId: string): void {
  if (trailPersistTimers.has(driverId)) return;
  const timer = setTimeout(() => {
    trailPersistTimers.delete(driverId);
    flushTrailPoints(driverId);
  }, TRAIL_PERSIST_INTERVAL_MS);
  timer.unref?.();
  trailPersistTimers.set(driverId, timer);
}

/**
 * Schedules a throttled DB write for a driver's last-known position.
 * At most one write per driver per POSITION_PERSIST_INTERVAL_MS.
 */
function schedulePersistPosition(driverId: string): void {
  if (positionPersistTimers.has(driverId)) return;
  const timer = setTimeout(() => {
    positionPersistTimers.delete(driverId);
    const current = livePositions.get(driverId);
    if (!current) return;
    logger.debug({ driverId }, "flushing fallback position to users.last_known_*");
    db.update(usersTable)
      .set({
        lastKnownLat: current.lat,
        lastKnownLng: current.lng,
        lastKnownHeading: current.heading ?? null,
        lastKnownAt: new Date(current.lastSeenAt),
      })
      .where(eq(usersTable.id, driverId))
      .catch((err) => logger.error({ err, driverId }, "failed to persist driver position to DB"));
  }, POSITION_PERSIST_INTERVAL_MS);
  timer.unref?.();
  positionPersistTimers.set(driverId, timer);
}

function dropDriver(userId: string, reason: "disconnect" | "ttl") {
  // Cancel any scheduled grace-period drop before executing immediately.
  const timer = pendingDropTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingDropTimers.delete(userId);
  }
  // Cancel any pending throttled-persist timer and, if the driver had a
  // live position, immediately flush it to the DB so the warm-up query
  // can recover it even after a longer server gap.
  const persistTimer = positionPersistTimers.get(userId);
  if (persistTimer) {
    clearTimeout(persistTimer);
    positionPersistTimers.delete(userId);
  }
  const current = livePositions.get(userId);
  if (current) {
    db.update(usersTable)
      .set({
        lastKnownLat: current.lat,
        lastKnownLng: current.lng,
        lastKnownHeading: current.heading ?? null,
        lastKnownAt: new Date(current.lastSeenAt),
      })
      .where(eq(usersTable.id, userId))
      .catch((err) =>
        logger.error({ err, driverId: userId }, "failed to flush driver position on drop"),
      );
  }
  const had = livePositions.delete(userId);
  // Flush any unpersisted trail points before clearing the buffer so that
  // the trail stored in driver_trail_points is complete up to the last GPS fix.
  const trailTimer = trailPersistTimers.get(userId);
  if (trailTimer) {
    clearTimeout(trailTimer);
    trailPersistTimers.delete(userId);
  }
  flushTrailPoints(userId);
  driverTrails.delete(userId);
  const rideInfo = activeRideByDriver.get(userId);
  activeRideByDriver.delete(userId);
  // Clear any per-trip queued-ride eligibility tracking so a reconnecting
  // driver starts fresh and doesn't carry stale state from a prior session.
  queuedEligibility.delete(userId);
  if (had && io) {
    io.to(ADMIN_ROOM).emit("driver:offline", { id: userId, reason });
    broadcastDriverOfflineToRiders(userId);
    // Notify the rider on this trip so the driver pin disappears immediately.
    if (rideInfo) {
      io.to(`ride:${rideInfo.rideId}`).emit("trip:driver_offline", { id: userId });
    }
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let rideRefreshTimer: ReturnType<typeof setInterval> | null = null;
function startSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of livePositions) {
      if (now - entry.lastSeenAt > POSITION_TTL_MS) {
        dropDriver(id, "ttl");
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  if (rideRefreshTimer) return;
  rideRefreshTimer = setInterval(() => {
    void refreshActiveRides();
  }, ACTIVE_RIDE_REFRESH_MS);
  rideRefreshTimer.unref?.();
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateLocation(payload: unknown): {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)) return null;
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return null;
  const out: { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number } = {
    lat: p.lat,
    lng: p.lng,
  };
  if (isFiniteNumber(p.heading) && p.heading >= 0 && p.heading <= 360) out.heading = p.heading;
  if (isFiniteNumber(p.speed) && p.speed >= 0) out.speed = p.speed;
  if (isFiniteNumber(p.accuracy) && p.accuracy >= 0) out.accuracy = p.accuracy;
  return out;
}

const MAX_RADIUS_KM = 25;

export function clampRadiusKm(value: unknown): number {
  if (!isFiniteNumber(value) || value <= 0) return DEFAULT_RADIUS_KM;
  if (value > MAX_RADIUS_KM) return MAX_RADIUS_KM;
  return value;
}

function parseNearbyJoinPayload(payload: unknown): { lat: number; lng: number; radiusKm: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)) return null;
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return null;
  return { lat: p.lat, lng: p.lng, radiusKm: clampRadiusKm(p.radiusKm) };
}

interface SocketData {
  kind: "user" | "admin";
  id: string;
  isApprovedDriver?: boolean;
}

function getData(socket: Socket): SocketData {
  return socket.data as SocketData;
}

export function initIo(http: HttpServer): IOServer {
  logger.info(
    { positionPersistIntervalMs: POSITION_PERSIST_INTERVAL_MS },
    "io: driver position persist interval configured",
  );

  io = new IOServer(http, {
    cors: { origin: true, credentials: true },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (typeof socket.handshake.headers.authorization === "string"
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
        : undefined);
    if (!token) return next(new Error("missing_token"));
    const payload = verifyToken(token);
    if (!payload) return next(new Error("invalid_token"));
    (socket.data as SocketData) = { kind: payload.kind, id: payload.sub };
    next();
  });

  io.on("connection", async (socket): Promise<void> => {
    const { kind, id } = getData(socket);
    if (!id) {
      socket.disconnect();
      return;
    }

    if (kind === "admin") {
      socket.join(ADMIN_ROOM);
      try {
        await warmUpPromise;
        const snapshot = await buildSnapshot();
        socket.emit("drivers:snapshot", snapshot);
      } catch (err) {
        logger.error({ err }, "failed to build live-map snapshot");
        socket.emit("drivers:snapshot", { drivers: [] });
      }
      socket.on("disconnect", () => {
        logger.debug({ adminId: id }, "admin socket disconnected");
      });
      return;
    }

    socket.join(`user:${id}`);

    // If this is a driver reconnecting within the grace period, cancel the
    // existing disconnect timer and re-arm a fresh grace window from this
    // reconnect moment. The fresh timer is only cancelled once driver:location
    // arrives — confirming the telemetry stream has resumed. This prevents
    // stale markers from lingering if location does not resume within the
    // grace window after reconnect. Guard on livePositions so this only
    // applies to drivers with an active position entry.
    const reconnectTimer = pendingDropTimers.get(id);
    if (reconnectTimer && livePositions.has(id)) {
      clearTimeout(reconnectTimer);
      pendingDropTimers.delete(id);
      logger.debug({ userId: id }, "driver reconnected within grace period — rearming location grace timer");
      scheduleGraceDrop(id);
    }

    // If the warm-up already seeded a position for this driver (e.g. from
    // their last DB-persisted fix), immediately broadcast it to the admin
    // room so the map shows returning drivers without waiting for the first
    // GPS tick after reconnect.
    const existingEntry = livePositions.get(id);
    if (existingEntry && io) {
      io.to(ADMIN_ROOM).emit("driver:location", entryToBroadcast(id, existingEntry));
    }

    socket.on("ride:join", async (rideId: string) => {
      if (typeof rideId !== "string" || rideId.length >= 64) return;
      try {
        const [row] = await db
          .select({
            riderId: ridesTable.riderId,
            acceptedDriverId: ridesTable.acceptedDriverId,
            status: ridesTable.status,
          })
          .from(ridesTable)
          .where(eq(ridesTable.id, rideId))
          .limit(1);
        if (!row) return;
        if (row.riderId !== id && row.acceptedDriverId !== id) return;
        await socket.join(`ride:${rideId}`);
        // If a rider joins and the driver is already streaming, send the current position.
        if (row.riderId === id && row.acceptedDriverId) {
          const entry = livePositions.get(row.acceptedDriverId);
          if (
            entry &&
            (row.status === "driver_arriving" || row.status === "in_progress")
          ) {
            socket.emit(
              "trip:driver_location",
              entryToRiderBroadcast(row.acceptedDriverId, entry),
            );
          }
        }
      } catch (err) {
        logger.error({ err, rideId }, "ride:join auth check failed");
      }
    });
    socket.on("ride:leave", (rideId: string) => {
      if (typeof rideId === "string") socket.leave(`ride:${rideId}`);
    });

    socket.on("chat:join", async (tripId: string) => {
      if (typeof tripId !== "string" || tripId.length >= 64) return;
      try {
        const [row] = await db
          .select({
            riderId: ridesTable.riderId,
            acceptedDriverId: ridesTable.acceptedDriverId,
            status: ridesTable.status,
          })
          .from(ridesTable)
          .where(eq(ridesTable.id, tripId))
          .limit(1);
        if (!row) return;
        if (row.riderId !== id && row.acceptedDriverId !== id) return;
        if (row.status !== "driver_arriving" && row.status !== "in_progress") return;
        await socket.join(`ride:${tripId}`);
        addChatPresence(tripId, id, socket.id);
      } catch (err) {
        logger.error({ err, tripId }, "chat:join auth check failed");
      }
    });

    socket.on("chat:leave", (tripId: string) => {
      if (typeof tripId !== "string") return;
      const departed = removeChatPresence(tripId, id, socket.id);
      if (departed) {
        for (const peerId of getChatPeers(tripId)) {
          if (peerId !== id) emitToUser(peerId, "chat:typing:stop", { tripId, userId: id });
        }
      }
    });

    const lastTypingStartAt = new Map<string, number>();
    const TYPING_START_MIN_INTERVAL_MS = 800;

    function relayTyping(eventName: "chat:typing:start" | "chat:typing:stop", tripId: string) {
      for (const peerId of getChatPeers(tripId)) {
        if (peerId === id) continue;
        emitToUser(peerId, eventName, { tripId, userId: id });
      }
    }

    socket.on("chat:typing:start", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { tripId?: unknown };
      if (typeof p.tripId !== "string") return;
      if (!isUserInChat(p.tripId, id)) return;
      const now = Date.now();
      const last = lastTypingStartAt.get(p.tripId) ?? 0;
      if (now - last < TYPING_START_MIN_INTERVAL_MS) return; // flood-drop
      lastTypingStartAt.set(p.tripId, now);
      relayTyping("chat:typing:start", p.tripId);
    });

    const lastTypingStopAt = new Map<string, number>();
    socket.on("chat:typing:stop", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { tripId?: unknown };
      if (typeof p.tripId !== "string") return;
      if (!isUserInChat(p.tripId, id)) return;
      const now = Date.now();
      const last = lastTypingStopAt.get(p.tripId) ?? 0;
      if (now - last < TYPING_START_MIN_INTERVAL_MS) return;
      lastTypingStopAt.set(p.tripId, now);
      lastTypingStartAt.delete(p.tripId);
      relayTyping("chat:typing:stop", p.tripId);
    });

    async function authorizeChatParticipant(tripId: string): Promise<{
      riderId: string;
      acceptedDriverId: string | null;
    } | null> {
      const [row] = await db
        .select({
          riderId: ridesTable.riderId,
          acceptedDriverId: ridesTable.acceptedDriverId,
          status: ridesTable.status,
        })
        .from(ridesTable)
        .where(eq(ridesTable.id, tripId))
        .limit(1);
      if (!row) return null;
      if (row.riderId !== id && row.acceptedDriverId !== id) return null;
      if (row.status !== "driver_arriving" && row.status !== "in_progress") return null;
      return row;
    }

    socket.on("chat:message:delivered", async (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { tripId?: unknown; messageIds?: unknown };
      if (typeof p.tripId !== "string") return;
      const ids = Array.isArray(p.messageIds)
        ? p.messageIds.filter((x): x is string => typeof x === "string").slice(0, 200)
        : [];
      if (ids.length === 0) return;
      try {
        const ride = await authorizeChatParticipant(p.tripId);
        if (!ride) return;
        const updated = await db
          .update(tripMessagesTable)
          .set({ deliveredAt: new Date() })
          .where(
            and(
              eq(tripMessagesTable.tripId, p.tripId),
              ne(tripMessagesTable.senderId, id),
              isNull(tripMessagesTable.deliveredAt),
              inArray(tripMessagesTable.id, ids),
            ),
          )
          .returning({ id: tripMessagesTable.id, senderId: tripMessagesTable.senderId, deliveredAt: tripMessagesTable.deliveredAt });
        if (updated.length === 0) return;
        const senderId = updated[0]!.senderId;
        const deliveredAt = updated[0]!.deliveredAt!.toISOString();
        io?.to(`user:${senderId}`).emit("chat:message:delivered", {
          tripId: p.tripId,
          messageIds: updated.map((u) => u.id),
          deliveredAt,
        });
      } catch (err) {
        logger.error({ err, tripId: p.tripId }, "chat:message:delivered handler failed");
      }
    });

    socket.on("chat:message:read", async (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { tripId?: unknown; messageIds?: unknown };
      if (typeof p.tripId !== "string") return;
      const ids = Array.isArray(p.messageIds)
        ? p.messageIds.filter((x): x is string => typeof x === "string").slice(0, 200)
        : [];
      if (ids.length === 0) return;
      try {
        const ride = await authorizeChatParticipant(p.tripId);
        if (!ride) return;
        const now = new Date();
        const updated = await db
          .update(tripMessagesTable)
          .set({
            readAt: now,
            deliveredAt: sql`COALESCE(${tripMessagesTable.deliveredAt}, ${now})`,
          })
          .where(
            and(
              eq(tripMessagesTable.tripId, p.tripId),
              ne(tripMessagesTable.senderId, id),
              isNull(tripMessagesTable.readAt),
              inArray(tripMessagesTable.id, ids),
            ),
          )
          .returning({ id: tripMessagesTable.id, senderId: tripMessagesTable.senderId });
        if (updated.length === 0) return;
        const senderId = updated[0]!.senderId;
        io?.to(`user:${senderId}`).emit("chat:message:read", {
          tripId: p.tripId,
          messageIds: updated.map((u) => u.id),
          readAt: now.toISOString(),
        });
        const [remaining] = await db
          .select({ value: count() })
          .from(tripMessagesTable)
          .where(
            and(
              eq(tripMessagesTable.tripId, p.tripId),
              ne(tripMessagesTable.senderId, id),
              isNull(tripMessagesTable.readAt),
            ),
          );
        io?.to(`user:${id}`).emit("chat:unread:update", {
          tripId: p.tripId,
          unread: remaining?.value ?? 0,
        });
      } catch (err) {
        logger.error({ err, tripId: p.tripId }, "chat:message:read handler failed");
      }
    });
    socket.on("driver:online", async (online: boolean) => {
      // isApprovedDriver is populated at the end of this connection handler
      // but may not be set yet when the client emits immediately on connect
      // (common on reconnect). If undefined, do an inline DB check and
      // cache the result on socket.data so subsequent events use the cache.
      if (getData(socket).isApprovedDriver === undefined) {
        try {
          const [row] = await db
            .select({ driverStatus: usersTable.driverStatus })
            .from(usersTable)
            .where(eq(usersTable.id, id))
            .limit(1);
          (socket.data as SocketData).isApprovedDriver =
            row?.driverStatus === "approved";
        } catch {
          (socket.data as SocketData).isApprovedDriver = false;
        }
      }
      if (!getData(socket).isApprovedDriver) return;
      if (online) {
        socket.join("drivers:online");
        // Online drivers automatically receive heatmap diffs. Going offline
        // leaves the room so the client stops getting updates it can't render.
        socket.join(HEATMAP_ROOM);
        if (heatmapInitialSnapshot) {
          try {
            socket.emit("heatmap:snapshot", heatmapInitialSnapshot());
          } catch (err) {
            logger.error({ err }, "failed to send initial heatmap snapshot");
          }
        }
      } else {
        socket.leave("drivers:online");
        socket.leave(HEATMAP_ROOM);
      }
      db.update(usersTable)
        .set({ driverOnline: online })
        .where(eq(usersTable.id, id))
        .catch((err) => logger.error({ err, userId: id }, "failed to sync driverOnline to db"));
    });

    // Rider subscribes to nearby driver feed with their current map centre.
    // Only drivers within the specified radius (default 5 km) are included in
    // the initial snapshot and subsequent live updates for this socket.
    socket.on("nearby:join", async (payload: unknown) => {
      const sub = parseNearbyJoinPayload(payload);
      if (sub) {
        riderSubscriptions.set(socket.id, { userId: id, ...sub });
        await warmUpPromise;
        const drivers = getLiveDriversForRiders(sub.lat, sub.lng, sub.radiusKm);
        socket.emit("nearby:snapshot", { drivers });
      } else {
        socket.emit("nearby:snapshot", { drivers: [] });
      }
    });

    socket.on("nearby:leave", () => {
      riderSubscriptions.delete(socket.id);
    });

    // Rider can update their map centre (e.g. after panning) to re-scope updates.
    socket.on("nearby:update_center", (payload: unknown) => {
      const sub = parseNearbyJoinPayload(payload);
      if (sub && riderSubscriptions.has(socket.id)) {
        riderSubscriptions.set(socket.id, { userId: id, ...sub });
        const drivers = getLiveDriversForRiders(sub.lat, sub.lng, sub.radiusKm);
        socket.emit("nearby:snapshot", { drivers });
      }
    });

    socket.on("driver:location", async (payload: unknown) => {
      if (getData(socket).isApprovedDriver === undefined) {
        try {
          const [row] = await db
            .select({ driverStatus: usersTable.driverStatus })
            .from(usersTable)
            .where(eq(usersTable.id, id))
            .limit(1);
          (socket.data as SocketData).isApprovedDriver =
            row?.driverStatus === "approved";
        } catch {
          (socket.data as SocketData).isApprovedDriver = false;
        }
      }
      if (!getData(socket).isApprovedDriver) return;
      const loc = validateLocation(payload);
      if (!loc) return;

      // If the driver reconnected within the grace period, cancel the pending
      // drop so they are never marked offline.
      const pendingTimer = pendingDropTimers.get(id);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingDropTimers.delete(id);
      }

      let entry = livePositions.get(id);
      const isNewEntry = !entry;
      if (!entry) {
        // Always provide phone+plate in the fallback shape so a transient
        // DB read failure on the very first location event does not produce
        // a broadcast missing those fields (which would then disagree with
        // every later snapshot built via loadDriverEnrichment).
        const meta = await loadDriverEnrichment(id).catch(() => ({
          name: "Driver",
          vehicle: null,
          vehicleCategory: "car" as const,
          phone: null,
          plate: null,
        }));
        entry = {
          ...loc,
          lastSeenAt: Date.now(),
          name: meta.name,
          vehicle: meta.vehicle,
          vehicleCategory: meta.vehicleCategory,
          phone: meta.phone,
          plate: meta.plate,
        };
      } else {
        entry.lat = loc.lat;
        entry.lng = loc.lng;
        entry.heading = loc.heading;
        entry.speed = loc.speed;
        entry.accuracy = loc.accuracy;
        entry.lastSeenAt = Date.now();
      }
      livePositions.set(id, entry);
      // Append to the in-memory trail buffer (scoped to the current active
      // ride so that buffers reset automatically on a new trip).
      // Points are batch-persisted to driver_trail_points every
      // TRAIL_PERSIST_INTERVAL_MS so the trail survives server restarts.
      {
        const currentRideId = activeRideByDriver.get(id)?.rideId ?? null;
        let trailBuf = driverTrails.get(id);
        if (!trailBuf || trailBuf.rideId !== currentRideId) {
          // New trip or first update — flush any pending old-trip points first.
          if (trailBuf) flushTrailPoints(id);
          trailBuf = { rideId: currentRideId, points: [], persistedUpTo: 0 };
          driverTrails.set(id, trailBuf);
        }
        trailBuf.points.push({ lat: loc.lat, lng: loc.lng, ts: Date.now() });
        if (trailBuf.points.length > TRAIL_MAX_POINTS) {
          // Shift the window forward; update persistedUpTo so we never
          // re-insert a point that was already written to the DB.
          trailBuf.points.shift();
          if (trailBuf.persistedUpTo > 0) trailBuf.persistedUpTo--;
        }
        if (currentRideId) scheduleTrailPersist(id);
      }
      // Upsert immediately into the crash-safe persistent store so the
      // position survives any kind of server restart, including hard crashes
      // that never reach the SIGTERM handler.
      upsertLivePosition(id, entry);
      if (isNewEntry) {
        // Also persist immediately to users.last_known_* on the first event
        // for backward compatibility with the fallback warm-up path.
        db.update(usersTable)
          .set({
            lastKnownLat: entry.lat,
            lastKnownLng: entry.lng,
            lastKnownHeading: entry.heading ?? null,
            lastKnownAt: new Date(entry.lastSeenAt),
          })
          .where(eq(usersTable.id, id))
          .catch((err) => logger.error({ err, driverId: id }, "failed to persist initial driver position to DB"));
      }
      schedulePersistPosition(id);

      let socks = driverSockets.get(id);
      if (!socks) {
        socks = new Set();
        driverSockets.set(id, socks);
      }
      socks.add(socket.id);

      io?.to(ADMIN_ROOM).emit("driver:location", entryToBroadcast(id, entry));
      broadcastDriverUpdateToNearbyRiders(id, entry);

      // Emit live position directly to the rider on this trip.
      const activeRide = activeRideByDriver.get(id);
      if (
        activeRide &&
        (activeRide.rideStatus === "driver_arriving" || activeRide.rideStatus === "in_progress")
      ) {
        io?.to(`ride:${activeRide.rideId}`).emit("trip:driver_location", entryToRiderBroadcast(id, entry));
      }

      // As soon as this position update makes the driver eligible to receive
      // queued ride candidates (lead-distance/time threshold against their
      // current dropoff), push a `queuedRideRequest` hint so the driver app
      // refetches immediately instead of waiting for its next 10s poll.
      if (activeRide) {
        void maybePushQueuedRideRequest(id, activeRide.rideId);
      } else {
        // Driver has no active trip — clear any tracked eligibility state so
        // the next trip starts fresh.
        queuedEligibility.delete(id);
      }
    });

    socket.on("disconnect", () => {
      riderSubscriptions.delete(socket.id);
      const departedTrips = removeAllChatPresenceForSocket(socket.id, id);
      for (const tripId of departedTrips) {
        for (const peerId of getChatPeers(tripId).filter((u) => u !== id)) {
          emitToUser(peerId, "chat:typing:stop", { tripId, userId: id });
        }
      }
      const socks = driverSockets.get(id);
      if (socks) {
        socks.delete(socket.id);
        if (socks.size === 0) {
          driverSockets.delete(id);
          if (livePositions.has(id)) {
            // Give the driver a short grace period before broadcasting offline.
            // If they reconnect within DISCONNECT_GRACE_MS (checked at connection
            // time), the timer is cancelled and no offline event is emitted.
            scheduleGraceDrop(id);
          }
          // If livePositions has no entry for this driver they never sent a
          // location, so there is nothing to drop.
        }
      } else if (livePositions.has(id)) {
        // Socket was not tracked in driverSockets — this happens when a driver
        // reconnected within the grace period (clearing the previous timer) but
        // then disconnected again before sending any driver:location update.
        // Re-schedule the grace drop so the stale position is not left in
        // livePositions indefinitely.
        scheduleGraceDrop(id);
      }
      // Clear driverOnline in DB when this was the last socket for this user.
      // Socket.IO fires "disconnect" after the socket has already left all rooms,
      // so a room size of 0 (or missing room) means no more active connections
      // remain for this user. This runs regardless of whether the driver ever
      // emitted driver:location, covering drivers who went online but never sent
      // a GPS position.
      const userRoom = io?.sockets.adapter.rooms.get(`user:${id}`);
      if (!userRoom || userRoom.size === 0) {
        db.update(usersTable)
          .set({ driverOnline: false })
          .where(eq(usersTable.id, id))
          .catch((err) => logger.error({ err, userId: id }, "failed to mark driver offline in db on disconnect"));
      }
      logger.debug({ userId: id }, "socket disconnected");
    });

    try {
      const [row] = await db
        .select({ driverStatus: usersTable.driverStatus })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      (socket.data as SocketData).isApprovedDriver =
        row?.driverStatus === "approved";
    } catch (err) {
      logger.error({ err, userId: id }, "failed to load driver status");
      (socket.data as SocketData).isApprovedDriver = false;
    }
  });

  startSweep();
  // Lazy-load heatmap aggregator to avoid the io.ts ↔ heatmap.ts circular import.
  void import("./heatmap").then((mod) => {
    registerHeatmapSnapshotProvider(() => mod.getSnapshot());
    mod.startHeatmapAggregator();
  }).catch((err) => logger.error({ err }, "failed to start heatmap aggregator"));
  warmUpPromise = warmUpPositions();
  return io;
}

export function getIo(): IOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function emitToRide(rideId: string, event: string, payload: unknown): void {
  io?.to(`ride:${rideId}`).emit(event, payload);
}
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
export function emitToOnlineDrivers(event: string, payload: unknown): void {
  io?.to("drivers:online").emit(event, payload);
}
export function emitToHeatmapRoom(event: string, payload: unknown): void {
  io?.to(HEATMAP_ROOM).emit(event, payload);
}

// Lazy hook for the heatmap aggregator. Set by `registerHeatmapSnapshotProvider`
// at startup to avoid a circular import (io.ts ←→ heatmap.ts).
let heatmapInitialSnapshot: (() => unknown) | null = null;
export function registerHeatmapSnapshotProvider(fn: () => unknown): void {
  heatmapInitialSnapshot = fn;
}

/**
 * Flush every in-memory livePositions entry to both the dedicated
 * `driver_live_positions` table AND the `users.last_known_*` columns.
 * Called on graceful shutdown (SIGTERM/SIGINT) as belt-and-suspenders
 * for any positions whose per-tick upsert is still in-flight.
 */
export async function flushAllPositionsToDb(): Promise<void> {
  const entries = Array.from(livePositions.entries()).filter(([, e]) =>
    isValidLatLng(e.lat, e.lng),
  );
  if (entries.length === 0) return;
  await Promise.all(
    entries.flatMap(([id, e]) => [
      // Primary: upsert into the crash-safe live positions table.
      db
        .insert(driverLivePositionsTable)
        .values({
          driverId: id,
          lat: e.lat,
          lng: e.lng,
          heading: e.heading ?? null,
          speed: e.speed ?? null,
          accuracy: e.accuracy ?? null,
          updatedAt: new Date(e.lastSeenAt),
        })
        .onConflictDoUpdate({
          target: driverLivePositionsTable.driverId,
          set: {
            lat: e.lat,
            lng: e.lng,
            heading: e.heading ?? null,
            speed: e.speed ?? null,
            accuracy: e.accuracy ?? null,
            updatedAt: new Date(e.lastSeenAt),
          },
        })
        .catch((err) =>
          logger.error({ err, driverId: id }, "shutdown flush: failed to upsert live position"),
        ),
      // Fallback: also update users.last_known_* for backward compatibility.
      db
        .update(usersTable)
        .set({
          lastKnownLat: e.lat,
          lastKnownLng: e.lng,
          lastKnownHeading: e.heading ?? null,
          lastKnownAt: new Date(e.lastSeenAt),
        })
        .where(eq(usersTable.id, id))
        .catch((err) =>
          logger.error({ err, driverId: id }, "shutdown flush: failed to persist position to users"),
        ),
    ]),
  );
  logger.info({ count: entries.length }, "shutdown: flushed all live positions to DB");
}

/**
 * Returns the lat/lng of every driver who is currently in the
 * `drivers:online` room AND has a fresh GPS position. Used by the
 * heatmap aggregator to compute supply.
 */
export function getOnlineDriverPositions(maxAgeMs: number): { lat: number; lng: number }[] {
  if (!io) return [];
  const room = io.sockets.adapter.rooms.get("drivers:online");
  if (!room || room.size === 0) return [];
  const onlineUserIds = new Set<string>();
  for (const sockId of room) {
    const sock = io.sockets.sockets.get(sockId);
    const data = sock?.data as SocketData | undefined;
    if (data?.id) onlineUserIds.add(data.id);
  }
  const now = Date.now();
  const out: { lat: number; lng: number }[] = [];
  for (const id of onlineUserIds) {
    const e = livePositions.get(id);
    if (!e) continue;
    if (now - e.lastSeenAt > maxAgeMs) continue;
    if (!isValidLatLng(e.lat, e.lng)) continue;
    out.push({ lat: e.lat, lng: e.lng });
  }
  return out;
}
export function emitToAdmins(event: string, payload: unknown): void {
  io?.to(ADMIN_ROOM).emit(event, payload);
}

export function isUserSocketConnected(userId: string): boolean {
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return room != null && room.size > 0;
}

export function dropLiveDriver(userId: string): void {
  dropDriver(userId, "disconnect");
}

export function getDriverLivePosition(userId: string): { lat: number; lng: number } | null {
  const entry = livePositions.get(userId);
  return entry ? { lat: entry.lat, lng: entry.lng } : null;
}

/**
 * Update a driver's live position from the HTTP fallback endpoint
 * (`POST /api/driver/location`). Called when the driver app sends a
 * position tick but the socket is not yet connected.
 *
 * Mirrors the `driver:location` socket handler: updates `livePositions`,
 * schedules a DB persist, and emits `driver:location` to the admin room.
 * If a socket session exists for this driver the event also reaches any
 * rider watching the same ride, exactly like a socket-sourced update.
 */
export async function updateDriverPositionFromHttp(
  driverId: string,
  loc: { lat: number; lng: number; heading?: number },
): Promise<void> {
  if (!isValidLatLng(loc.lat, loc.lng)) return;

  let entry = livePositions.get(driverId);
  const isNewEntry = !entry;
  if (!entry) {
    const meta = await loadDriverEnrichment(driverId).catch(() => ({
      name: "Driver",
      vehicle: null,
      vehicleCategory: "car" as const,
      phone: null,
      plate: null,
    }));
    entry = {
      lat: loc.lat,
      lng: loc.lng,
      heading: loc.heading,
      lastSeenAt: Date.now(),
      name: meta.name,
      vehicle: meta.vehicle,
      vehicleCategory: meta.vehicleCategory,
      phone: meta.phone,
      plate: meta.plate,
    };
  } else {
    entry.lat = loc.lat;
    entry.lng = loc.lng;
    entry.heading = loc.heading;
    entry.lastSeenAt = Date.now();
  }
  livePositions.set(driverId, entry);
  // Append to the in-memory trail buffer (mirrors socket handler logic).
  {
    const currentRideId = activeRideByDriver.get(driverId)?.rideId ?? null;
    let trailBuf = driverTrails.get(driverId);
    if (!trailBuf || trailBuf.rideId !== currentRideId) {
      if (trailBuf) flushTrailPoints(driverId);
      trailBuf = { rideId: currentRideId, points: [], persistedUpTo: 0 };
      driverTrails.set(driverId, trailBuf);
    }
    trailBuf.points.push({ lat: loc.lat, lng: loc.lng, ts: Date.now() });
    if (trailBuf.points.length > TRAIL_MAX_POINTS) {
      trailBuf.points.shift();
      if (trailBuf.persistedUpTo > 0) trailBuf.persistedUpTo--;
    }
    if (currentRideId) scheduleTrailPersist(driverId);
  }
  // Upsert immediately into the crash-safe persistent store.
  upsertLivePosition(driverId, entry);

  if (isNewEntry) {
    db.update(usersTable)
      .set({
        lastKnownLat: entry.lat,
        lastKnownLng: entry.lng,
        lastKnownHeading: entry.heading ?? null,
        lastKnownAt: new Date(entry.lastSeenAt),
      })
      .where(eq(usersTable.id, driverId))
      .catch((err) => logger.error({ err, driverId }, "http location: failed to persist initial position"));
  }
  schedulePersistPosition(driverId);

  if (io) {
    io.to(ADMIN_ROOM).emit("driver:location", entryToBroadcast(driverId, entry));
    broadcastDriverUpdateToNearbyRiders(driverId, entry);
    const activeRide = activeRideByDriver.get(driverId);
    if (activeRide && (activeRide.rideStatus === "driver_arriving" || activeRide.rideStatus === "in_progress")) {
      io.to(`ride:${activeRide.rideId}`).emit("trip:driver_location", entryToRiderBroadcast(driverId, entry));
    }
  }
}

// Returns the set of driver IDs that currently have a live socket position
// entry. Used by the admin live map to filter out drivers that are already
// shown via the realtime socket feed when listing offline last-known
// positions from the DB.
export function getLiveDriverIdSet(): Set<string> {
  return new Set(livePositions.keys());
}

// Snapshot of currently-live drivers (same shape as the socket
// `drivers:snapshot` payload entries, with lat/lng nullable). Used by the
// admin REST endpoint as a polling fallback when the socket is
// disconnected. We deliberately KEEP entries whose coordinates fail the
// validity gate — their lat/lng are nulled out — so the admin list can
// continue to show those live drivers as "Location unavailable" instead
// of dropping them entirely during socket outages.
export type LiveDriverSnapshotEntry = Omit<ReturnType<typeof entryToBroadcast>, "lat" | "lng"> & {
  lat: number | null;
  lng: number | null;
};
export function getLiveDriversSnapshot(): LiveDriverSnapshotEntry[] {
  const out: LiveDriverSnapshotEntry[] = [];
  for (const [id, e] of livePositions) {
    const broadcast = entryToBroadcast(id, e);
    const valid = isValidLatLng(e.lat, e.lng);
    out.push({
      ...broadcast,
      lat: valid ? broadcast.lat : null,
      lng: valid ? broadcast.lng : null,
    });
  }
  return out;
}

/**
 * Throttled eligibility check for back-to-back queued rides. Called from the
 * `driver:location` handler. When the driver newly transitions into the
 * lead-distance/time window for their current trip AND a candidate is
 * available, emits a `queuedRideRequest` hint to the driver so the app
 * refetches `/driver/queued-requests` immediately instead of waiting for
 * the next 10s poll. Eligibility is re-validated server-side on the
 * candidate request, so this is purely a hint event.
 */
async function maybePushQueuedRideRequest(
  driverId: string,
  currentTripId: string,
): Promise<void> {
  if (!io) return;
  const now = Date.now();
  let state = queuedEligibility.get(driverId);
  if (state && state.tripId !== currentTripId) {
    // New active trip — reset.
    state = undefined;
  }
  if (state?.inFlight) return;
  if (state && now - state.lastCheckedAt < QUEUED_ELIGIBILITY_CHECK_MS) return;

  const next: QueuedEligibilityState = state ?? {
    tripId: currentTripId,
    eligible: false,
    lastCheckedAt: 0,
    inFlight: false,
  };
  next.inFlight = true;
  next.lastCheckedAt = now;
  queuedEligibility.set(driverId, next);

  try {
    const mod = await import("./queuedRides");
    if (!(await mod.canDriverReceiveQueuedRequest(driverId))) {
      next.eligible = false;
      return;
    }
    const eligibleNow = await mod.shouldOfferQueuedRides(driverId, currentTripId);
    const wasEligible = next.eligible;
    next.eligible = eligibleNow;
    if (!eligibleNow || wasEligible) return;
    // Newly eligible — fetch the top candidate (if any) and push a hint.
    const candidates = await mod.findQueuedRideCandidates(driverId, currentTripId, 1);
    if (candidates.length === 0) return;
    const top = candidates[0]!;
    emitToUser(driverId, "queuedRideRequest", {
      rideId: top.rideId,
      pickupAddress: top.pickupAddress,
      distanceFromCurrentDropoffKm: top.distanceFromCurrentDropoffKm,
    });
  } catch (err) {
    logger.warn(
      { err, driverId, currentTripId },
      "[io] maybePushQueuedRideRequest failed",
    );
  } finally {
    next.inFlight = false;
  }
}
