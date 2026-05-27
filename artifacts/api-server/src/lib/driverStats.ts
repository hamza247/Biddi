import { db } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import {
  ridesTable,
  rideDispatchLogsTable,
  bidsTable,
} from "@workspace/db";

/**
 * Minimum sample size required before publishing an acceptance or
 * cancellation rate. Below this threshold the rate is reported as `null`
 * so the UI can render "—" instead of a misleading 0% / 100% based on
 * one or two rides.
 */
export const MIN_SAMPLE_FOR_RATE = 5;

export interface DriverRates {
  /** 0–100, one decimal. `null` when fewer than MIN_SAMPLE_FOR_RATE rides
   *  were ever dispatched to this driver. */
  acceptanceRate: number | null;
  /** 0–100, one decimal. `null` when fewer than MIN_SAMPLE_FOR_RATE rides
   *  were ever accepted by this driver. */
  cancellationRate: number | null;
  /** Total rides delivered to this driver as a request notification. */
  dispatchedCount: number;
  /** Distinct rides this driver bid on (active or accepted). Used as the
   *  acceptance numerator. */
  bidCount: number;
  /** Rides where this driver was the accepted driver (any final status).
   *  Used as the cancellation denominator. */
  acceptedRidesCount: number;
  /** Rides where this driver was the accepted driver and the ride ended
   *  cancelled with cancelled_by = 'driver'. Cancellation numerator. */
  cancelledByDriverCount: number;
}

type RatesRow = {
  dispatched: string | number | null;
  bid: string | number | null;
  accepted: string | number | null;
  cancelled_by_driver: string | number | null;
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const raw = (numerator / denominator) * 100;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

/**
 * Compute acceptance and cancellation rates for one driver from real ride
 * history. Returns null rates when the underlying sample is too small.
 *
 * This bypasses the cache. Prefer `getDriverRates` for request handlers so
 * repeated calls within the TTL window are served from memory.
 */
export async function computeDriverRates(driverId: string): Promise<DriverRates> {
  const result = await db.execute<RatesRow>(sql`
    SELECT
      (SELECT COUNT(*) FROM ride_dispatch_logs
        WHERE driver_id = ${driverId} AND status = 'delivered') AS dispatched,
      (SELECT COUNT(DISTINCT ride_id) FROM bids
        WHERE driver_id = ${driverId} AND status IN ('active','accepted')) AS bid,
      (SELECT COUNT(*) FROM rides
        WHERE accepted_driver_id = ${driverId}) AS accepted,
      (SELECT COUNT(*) FROM rides
        WHERE accepted_driver_id = ${driverId}
          AND status = 'cancelled'
          AND cancelled_by = 'driver') AS cancelled_by_driver
  `);
  const rows = (result as unknown as { rows: RatesRow[] }).rows ?? [];
  const row = rows[0];
  const dispatchedCount = Number(row?.dispatched ?? 0);
  const bidCount = Number(row?.bid ?? 0);
  const acceptedRidesCount = Number(row?.accepted ?? 0);
  const cancelledByDriverCount = Number(row?.cancelled_by_driver ?? 0);

  const acceptanceRate =
    dispatchedCount < MIN_SAMPLE_FOR_RATE
      ? null
      : pct(bidCount, dispatchedCount);
  const cancellationRate =
    acceptedRidesCount < MIN_SAMPLE_FOR_RATE
      ? null
      : pct(cancelledByDriverCount, acceptedRidesCount);

  return {
    acceptanceRate,
    cancellationRate,
    dispatchedCount,
    bidCount,
    acceptedRidesCount,
    cancelledByDriverCount,
  };
}

/**
 * In-memory per-driver cache for `DriverRates`.
 *
 * The four aggregate subqueries in `computeDriverRates` are O(history) and
 * run on every `/auth/me` and `/admin/drivers/:id` request. Once a driver
 * has hundreds of rides this dominates request latency. We cache results
 * with a short TTL and additionally invalidate explicitly whenever a
 * relevant event fires (dispatch delivered, bid placed, ride accepted,
 * ride cancelled). The TTL is a safety net so stale entries cannot live
 * forever if an invalidation hook is missed.
 *
 * The cache lives in process memory; with a single api-server instance
 * this is sufficient. If we ever scale out, replace this with Redis (or
 * a small `driver_stats` rollup table) without changing call-site usage.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  rates: DriverRates;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DriverRates>>();

/**
 * Returns cached rates for a driver, recomputing only if the entry is
 * missing or expired. Concurrent callers for the same driver share a
 * single in-flight DB query.
 */
export async function getDriverRates(driverId: string): Promise<DriverRates> {
  const now = Date.now();
  const hit = cache.get(driverId);
  if (hit && hit.expiresAt > now) return hit.rates;

  const pending = inflight.get(driverId);
  if (pending) return pending;

  const promise = computeDriverRates(driverId)
    .then((rates) => {
      cache.set(driverId, { rates, expiresAt: Date.now() + CACHE_TTL_MS });
      return rates;
    })
    .finally(() => {
      inflight.delete(driverId);
    });
  inflight.set(driverId, promise);
  return promise;
}

/**
 * Drops the cached rates for a driver. Call this from any code path that
 * mutates one of the underlying inputs (ride_dispatch_logs deliveries,
 * bids, ride acceptance, ride cancellation by accepted driver). The next
 * `getDriverRates` call will recompute from the database.
 *
 * Safe to call with a null/undefined driverId; it is a no-op in that
 * case so callers do not need to guard.
 */
export function invalidateDriverRates(driverId: string | null | undefined): void {
  if (!driverId) return;
  cache.delete(driverId);
}

/** Test-only: wipe the entire cache. */
export function _resetDriverRatesCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Batch variant of {@link computeDriverRates}. Returns a Map keyed by driver
 * id. Drivers with no matching ride history are still included in the output
 * with zero counts (and therefore null rates, since they are below the
 * minimum sample size).
 */
export async function computeDriverRatesBatch(
  driverIds: string[],
): Promise<Map<string, DriverRates>> {
  const out = new Map<string, DriverRates>();
  if (driverIds.length === 0) return out;

  const counts = new Map<
    string,
    { dispatched: number; bid: number; accepted: number; cancelledByDriver: number }
  >();
  for (const id of driverIds) {
    counts.set(id, { dispatched: 0, bid: 0, accepted: 0, cancelledByDriver: 0 });
  }

  const [dispatchedRows, bidRows, acceptedRows, cancelledRows] = await Promise.all([
    db
      .select({
        driverId: rideDispatchLogsTable.driverId,
        count: sql<number>`count(*)::int`,
      })
      .from(rideDispatchLogsTable)
      .where(
        sql`${inArray(rideDispatchLogsTable.driverId, driverIds)} AND ${rideDispatchLogsTable.status} = 'delivered'`,
      )
      .groupBy(rideDispatchLogsTable.driverId),
    db
      .select({
        driverId: bidsTable.driverId,
        count: sql<number>`count(distinct ${bidsTable.rideId})::int`,
      })
      .from(bidsTable)
      .where(
        sql`${inArray(bidsTable.driverId, driverIds)} AND ${bidsTable.status} IN ('active','accepted')`,
      )
      .groupBy(bidsTable.driverId),
    db
      .select({
        driverId: ridesTable.acceptedDriverId,
        count: sql<number>`count(*)::int`,
      })
      .from(ridesTable)
      .where(inArray(ridesTable.acceptedDriverId, driverIds))
      .groupBy(ridesTable.acceptedDriverId),
    db
      .select({
        driverId: ridesTable.acceptedDriverId,
        count: sql<number>`count(*)::int`,
      })
      .from(ridesTable)
      .where(
        sql`${inArray(ridesTable.acceptedDriverId, driverIds)} AND ${ridesTable.status} = 'cancelled' AND ${ridesTable.cancelledBy} = 'driver'`,
      )
      .groupBy(ridesTable.acceptedDriverId),
  ]);

  for (const r of dispatchedRows) {
    if (r.driverId) counts.get(r.driverId)!.dispatched = Number(r.count) || 0;
  }
  for (const r of bidRows) {
    if (r.driverId) counts.get(r.driverId)!.bid = Number(r.count) || 0;
  }
  for (const r of acceptedRows) {
    if (r.driverId) counts.get(r.driverId)!.accepted = Number(r.count) || 0;
  }
  for (const r of cancelledRows) {
    if (r.driverId) counts.get(r.driverId)!.cancelledByDriver = Number(r.count) || 0;
  }

  for (const id of driverIds) {
    const c = counts.get(id)!;
    const acceptanceRate =
      c.dispatched < MIN_SAMPLE_FOR_RATE ? null : pct(c.bid, c.dispatched);
    const cancellationRate =
      c.accepted < MIN_SAMPLE_FOR_RATE ? null : pct(c.cancelledByDriver, c.accepted);
    out.set(id, {
      acceptanceRate,
      cancellationRate,
      dispatchedCount: c.dispatched,
      bidCount: c.bid,
      acceptedRidesCount: c.accepted,
      cancelledByDriverCount: c.cancelledByDriver,
    });
  }
  return out;
}
