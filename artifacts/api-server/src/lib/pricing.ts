import { and, eq } from "drizzle-orm";
import {
  db,
  vehicleTypesTable,
  type FareBreakdown,
  type VehicleType,
} from "@workspace/db";

export const FARE_CURRENCY = "USD";

// Fallback pricing used when no matching vehicle type exists. Mirrors the
// hard-coded suggestion the original code used so removing/seeding categories
// can't take pricing offline.
const FALLBACK_PRICING = {
  baseFare: 4,
  pricePerKm: 1.6,
  pricePerMin: 0,
  minimumFare: 5,
  fareModelStrategy: "incremental" as const,
  poolEnabled: false,
  cancellationTimeLimitMin: 0,
  cancellationCharge: 0,
  inTransitWaitingFeePerMin: 0,
  peakSurchargeEnabled: false,
  peakSurchargeWindows: [] as VehicleType["peakSurchargeWindows"],
  nightChargeEnabled: false,
  nightChargeStart: null as string | null,
  nightChargeEnd: null as string | null,
  nightChargeMultiplier: 1,
  personCapacity: 4,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pick a vehicle type for the given rider-selected class. Falls back to the
 * first active type so pricing always resolves to *something*. */
export async function pickVehicleType(
  vehicleClass: string | null | undefined,
): Promise<VehicleType | null> {
  if (vehicleClass) {
    const [byClass] = await db
      .select()
      .from(vehicleTypesTable)
      .where(
        and(
          eq(vehicleTypesTable.classKey, vehicleClass),
          eq(vehicleTypesTable.active, true),
        ),
      )
      .orderBy(vehicleTypesTable.displayOrder)
      .limit(1);
    if (byClass) return byClass;
  }
  const [fallback] = await db
    .select()
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.active, true))
    .orderBy(vehicleTypesTable.displayOrder)
    .limit(1);
  return fallback ?? null;
}

export async function loadVehicleType(
  id: string | null | undefined,
): Promise<VehicleType | null> {
  if (!id) return null;
  const [vt] = await db
    .select()
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.id, id))
    .limit(1);
  return vt ?? null;
}

interface MinutesOfDay {
  start: number;
  end: number;
  /** True when the window straddles midnight (e.g. 22:00–04:00). */
  wraps: boolean;
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function windowFromTimes(
  start: string | null | undefined,
  end: string | null | undefined,
): MinutesOfDay | null {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null) return null;
  return { start: s, end: e, wraps: e <= s };
}

function isWithinWindow(date: Date, window: MinutesOfDay): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (window.wraps) {
    return minutes >= window.start || minutes < window.end;
  }
  return minutes >= window.start && minutes < window.end;
}

/** Returns the first matching peak window's multiplier for `at`, or 1. */
export function peakMultiplierAt(vt: VehicleType | null, at: Date): number {
  if (!vt || !vt.peakSurchargeEnabled) return 1;
  const day = at.getDay();
  for (const w of vt.peakSurchargeWindows ?? []) {
    if (!w.days.includes(day)) continue;
    const window = windowFromTimes(w.startTime, w.endTime);
    if (!window) continue;
    if (isWithinWindow(at, window)) {
      return Math.max(1, Number(w.multiplier) || 1);
    }
  }
  return 1;
}

/** Returns the night charge multiplier when `at` falls in the configured
 * overnight window, otherwise 1. */
export function nightMultiplierAt(vt: VehicleType | null, at: Date): number {
  if (!vt || !vt.nightChargeEnabled) return 1;
  const window = windowFromTimes(vt.nightChargeStart, vt.nightChargeEnd);
  if (!window) return 1;
  return isWithinWindow(at, window)
    ? Math.max(1, vt.nightChargeMultiplier || 1)
    : 1;
}

interface ComputeFareInput {
  vehicleType: VehicleType | null;
  distanceKm: number;
  durationMin: number;
  /** Time the fare applies to — used to resolve peak/night windows. */
  at?: Date;
  /** In-transit waiting (per-min) reported by the driver. Rounded up. */
  waitingMin?: number;
  /** Number of seats for pool/shared rides. Pool fares are per-seat. */
  seats?: number;
  /** Pre-resolved weather surcharge for the pickup location. The pricing
   * engine never calls the provider itself — `resolveWeatherSurcharge` is
   * called once by the route handler and the result is passed in. */
  weather?: {
    multiplier: number;
    fixed: number;
    reason: string;
    ruleName: string;
  } | null;
  /** Pre-resolved airport surcharge for the ride's pickup/dropoff. The
   * pricing engine never queries the database itself — the route handler
   * calls `resolveAirportSurcharge` once and passes the result. */
  airport?: {
    pickup: {
      airportName: string;
      surchargeType: "multiplier" | "fixed";
      surchargeValue: number;
    } | null;
    dropoff: {
      airportName: string;
      surchargeType: "multiplier" | "fixed";
      surchargeValue: number;
    } | null;
  } | null;
}

function applyAirportSide(
  baseSubtotal: number,
  side: { surchargeType: "multiplier" | "fixed"; surchargeValue: number } | null,
): number {
  if (!side) return 0;
  if (side.surchargeType === "multiplier") {
    const m = Math.max(1, side.surchargeValue || 1);
    return round2(baseSubtotal * (m - 1));
  }
  return round2(Math.max(0, side.surchargeValue || 0));
}

/** Builds a complete fare breakdown using the category's pricing rules. */
export function computeFareBreakdown({
  vehicleType,
  distanceKm,
  durationMin,
  at = new Date(),
  waitingMin = 0,
  seats = 1,
  weather = null,
  airport = null,
}: ComputeFareInput): FareBreakdown {
  const cfg = vehicleType ?? FALLBACK_PRICING;
  const peak = peakMultiplierAt(vehicleType, at);
  const night = nightMultiplierAt(vehicleType, at);

  const safeDistance = Math.max(0, distanceKm);
  const safeDuration = Math.max(0, durationMin);

  const base = round2(cfg.baseFare);
  const distance = round2(safeDistance * cfg.pricePerKm);
  const time = round2(safeDuration * cfg.pricePerMin);
  const baseSubtotal = base + distance + time;

  const peakSurcharge = round2(baseSubtotal * (peak - 1));
  const nightSurcharge = round2(baseSubtotal * (night - 1));

  // Weather is applied AFTER peak/night so a doubling weather rule
  // doubles the post-surge subtotal — never the bare meter — but BEFORE
  // the minimum-fare floor, exactly as the task requires.
  const surgedSubtotal = baseSubtotal + peakSurcharge + nightSurcharge;
  const weatherMult = Math.max(1, weather?.multiplier ?? 1);
  const weatherFixed = Math.max(0, weather?.fixed ?? 0);
  const weatherSurcharge = round2(
    surgedSubtotal * (weatherMult - 1) + weatherFixed,
  );

  // Airport pickup/dropoff surcharges apply after weather and before the
  // minimum-fare floor. Multiplier rules are computed against the
  // pre-airport (post-weather) subtotal so the two sides don't compound on
  // one another.
  const postWeatherSubtotal = round2(surgedSubtotal + weatherSurcharge);
  const airportPickupSurcharge = applyAirportSide(
    postWeatherSubtotal,
    airport?.pickup ?? null,
  );
  const airportDropoffSurcharge = applyAirportSide(
    postWeatherSubtotal,
    airport?.dropoff ?? null,
  );
  let subtotal = round2(
    postWeatherSubtotal + airportPickupSurcharge + airportDropoffSurcharge,
  );

  const waitMinutesBilled = Math.max(0, Math.ceil(waitingMin));
  const waitingFee = round2(
    waitMinutesBilled * (cfg.inTransitWaitingFeePerMin ?? 0),
  );

  let total = round2(subtotal + waitingFee);
  const minimumFare = cfg.minimumFare ?? 0;
  let minimumApplied = false;
  if (total < minimumFare) {
    total = round2(minimumFare);
    minimumApplied = true;
  }

  const isPool = !!cfg.poolEnabled;
  if (isPool && seats > 1) {
    // Pool fares are quoted per-seat — split the trip total across seats.
    total = round2(total / seats);
  }

  const breakdown: FareBreakdown = {
    currency: FARE_CURRENCY,
    base,
    distance,
    distanceKm: round2(safeDistance),
    pricePerKm: cfg.pricePerKm,
    time,
    durationMin: Math.round(safeDuration),
    pricePerMin: cfg.pricePerMin,
    peakMultiplier: peak,
    peakSurcharge,
    nightMultiplier: night,
    nightSurcharge,
    subtotal,
    minimumFare: round2(minimumFare),
    minimumApplied,
    waitingMin: waitMinutesBilled,
    waitingFee,
    fareModel: cfg.fareModelStrategy,
    pool: isPool,
    total,
  };
  if (weather && weatherSurcharge > 0) {
    breakdown.weatherSurcharge = weatherSurcharge;
    breakdown.weatherMultiplier = weatherMult;
    breakdown.weatherReason = weather.reason;
    breakdown.weatherRuleName = weather.ruleName;
  }
  if (airport?.pickup && airportPickupSurcharge > 0) {
    breakdown.airportPickupSurcharge = airportPickupSurcharge;
    breakdown.airportPickupName = airport.pickup.airportName;
  }
  if (airport?.dropoff && airportDropoffSurcharge > 0) {
    breakdown.airportDropoffSurcharge = airportDropoffSurcharge;
    breakdown.airportDropoffName = airport.dropoff.airportName;
  }
  return breakdown;
}

export interface BidBounds {
  /** Suggested fare drivers see as anchor. */
  suggested: number;
  /** Lowest valid bid (or fixed amount when fareModel === "fixed"). */
  min: number;
  /** Highest valid bid. */
  max: number;
  /** When the fare model is "fixed", the only acceptable amount. */
  fixedAmount: number | null;
  fareModel: "incremental" | "fixed";
  pool: boolean;
}

/** Computes the bid bounds drivers must respect for the given route + category.
 * Incremental categories allow bids in a band around the suggestion; fixed and
 * pool categories require an exact match. */
export function computeBidBounds(
  vt: VehicleType | null,
  distanceKm: number,
  durationMin: number,
  at: Date = new Date(),
  airport: ComputeFareInput["airport"] = null,
): BidBounds {
  const breakdown = computeFareBreakdown({
    vehicleType: vt,
    distanceKm,
    durationMin,
    at,
    airport,
  });
  const cfg = vt ?? FALLBACK_PRICING;
  const fixed = cfg.fareModelStrategy === "fixed" || cfg.poolEnabled;

  if (fixed) {
    return {
      suggested: breakdown.total,
      min: breakdown.total,
      max: breakdown.total,
      fixedAmount: breakdown.total,
      fareModel: cfg.fareModelStrategy,
      pool: !!cfg.poolEnabled,
    };
  }

  // Incremental: allow ±40% with the minimum fare as a hard floor.
  const min = round2(Math.max(breakdown.minimumFare, breakdown.total * 0.6));
  const max = round2(Math.max(min + 1, breakdown.total * 1.6));
  return {
    suggested: breakdown.total,
    min,
    max,
    fixedAmount: null,
    fareModel: cfg.fareModelStrategy,
    pool: false,
  };
}

/** Validates a driver's bid against the category's fare model. Returns null
 * when valid, otherwise an error code. */
export function validateBid(
  vt: VehicleType | null,
  amount: number,
  distanceKm: number,
  durationMin: number,
  at: Date = new Date(),
  airport: ComputeFareInput["airport"] = null,
):
  | null
  | { code: "below_minimum" | "above_maximum" | "must_match_fixed"; bounds: BidBounds } {
  const bounds = computeBidBounds(vt, distanceKm, durationMin, at, airport);
  if (bounds.fixedAmount != null) {
    // 1¢ tolerance for floating math.
    if (Math.abs(amount - bounds.fixedAmount) > 0.01) {
      return { code: "must_match_fixed", bounds };
    }
    return null;
  }
  if (amount < bounds.min - 0.01) return { code: "below_minimum", bounds };
  if (amount > bounds.max + 0.01) return { code: "above_maximum", bounds };
  return null;
}

/** Cancellation fee — charges configured charge after the grace window has
 * passed, otherwise free. */
export function computeCancellationFee(
  vt: VehicleType | null,
  requestedAt: Date,
  cancelledAt: Date = new Date(),
): number {
  const cfg = vt ?? FALLBACK_PRICING;
  const grace = cfg.cancellationTimeLimitMin ?? 0;
  const elapsedMin = (cancelledAt.getTime() - requestedAt.getTime()) / 60000;
  if (elapsedMin <= grace) return 0;
  return round2(cfg.cancellationCharge ?? 0);
}

/** Builds the final fare for a completed ride using the category's pricing
 * rules with the actual driven distance/duration. The breakdown reflects
 * base + distance + time + peak/night surcharges + in-transit waiting fee,
 * floored to the configured minimum fare. Pool fares are split per-seat.
 *
 * The agreed bid is recorded separately on the ride (and surfaced as
 * `agreedBid` for the receipt) but the rider invoice is metered from the
 * configured rules so peak/night/min/waiting always apply consistently. */
export function buildFinalFareBreakdown(
  vt: VehicleType | null,
  bidAmount: number,
  distanceKm: number,
  durationMin: number,
  waitingMin: number,
  at: Date,
  seats: number = 1,
  weather: ComputeFareInput["weather"] = null,
  airport: ComputeFareInput["airport"] = null,
): FareBreakdown {
  const breakdown = computeFareBreakdown({
    vehicleType: vt,
    distanceKm,
    durationMin,
    at,
    waitingMin,
    seats,
    weather,
    airport,
  });
  return {
    ...breakdown,
    agreedBid: round2(bidAmount),
  };
}
