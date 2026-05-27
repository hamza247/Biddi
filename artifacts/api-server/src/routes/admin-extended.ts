import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import {
  db,
  usersTable,
  ridesTable,
  vehiclesTable,
  bidsTable,
  vehicleTypesTable,
  vehicleTypeServiceAreasTable,
  serviceAreasTable,
  countriesTable,
  deletedCountryCodesTable,
  appClassesTable,
  GEO_FENCE_TYPES,
  appBannersTable,
  cancellationReasonsTable,
  notificationTemplatesTable,
  rewardLevelsTable,
  restrictedAreasTable,
  RESTRICT_AREA_VALUES,
  RESTRICT_TYPE_VALUES,
  safetyAlertsTable,
  weatherSurchargeRulesTable,
  weatherReadingsCacheTable,
  type WeatherConditions,
  couponsTable,
  airportSurchargesTable,
  AIRPORT_SURCHARGE_TYPES,
  driverTrailPointsTable,
} from "@workspace/db";
import { pointInPolygon } from "../lib/geo";
import { getLiveDriverIdSet, getLiveDriversSnapshot } from "../lib/io";
import {
  and,
  eq,
  desc,
  sql,
  gte,
  lte,
  count,
  sum,
  avg,
  ne,
  inArray,
} from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import { sendEmail } from "../lib/email";
import { getConfig } from "../lib/settings";
import {
  bulkEnrichWithPlatformCurrency,
  enrichWithPlatformCurrency,
  getDisplayCurrencyCode,
} from "../lib/displayAmount";
import { enrichFareBreakdown } from "../lib/currency";
import type { FareBreakdown } from "@workspace/db";

const router: IRouter = Router();

// ─── DRIVER TRAIL ─────────────────────────────────────────────────────────────
// Returns the GPS trail for a driver's current active ride from the DB.
// An optional `?rideId=` query param scopes the result to a specific trip;
// if omitted the endpoint returns the most recent trail for any ride that
// has points in driver_trail_points.
// Points are ordered oldest-first (recordedAt ASC); limited to 200 points
// so the polyline stays manageable.  Returns an empty array when no trail
// is found (driver has never been on an active ride since last restart or
// has no ride in progress).

router.get("/admin/drivers/:id/trail", requireAdmin, async (req, res) => {
  const driverId = req.params.id;
  if (!driverId || typeof driverId !== "string") {
    res.status(400).json({ error: "invalid_driver_id" });
    return;
  }
  // Resolve the rideId to query.  Always validate against active statuses
  // so the endpoint is strictly scoped to in-progress trips regardless of
  // whether the caller supplied ?rideId= or we auto-resolved it.
  const requestedRideId = typeof req.query.rideId === "string" ? req.query.rideId : null;
  const activeRide = await db
    .select({ id: ridesTable.id })
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.acceptedDriverId, driverId),
        inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
        ...(requestedRideId ? [eq(ridesTable.id, requestedRideId)] : []),
      ),
    )
    .limit(1);
  const rideId = activeRide[0]?.id ?? null;
  if (!rideId) {
    res.json({ points: [], rideId: null });
    return;
  }
  // Query the most recent 200 points (DESC) then reverse so the polyline
  // is drawn oldest-first (chronological order).  This ensures long trips
  // show recent track context rather than the stale trip-start segment.
  const rows = await db
    .select({
      lat: driverTrailPointsTable.lat,
      lng: driverTrailPointsTable.lng,
      ts: driverTrailPointsTable.recordedAt,
    })
    .from(driverTrailPointsTable)
    .where(
      and(
        eq(driverTrailPointsTable.driverId, driverId),
        eq(driverTrailPointsTable.rideId, rideId),
      ),
    )
    .orderBy(desc(driverTrailPointsTable.recordedAt))
    .limit(200);
  rows.reverse();
  res.json({
    points: rows.map((r) => ({ lat: r.lat, lng: r.lng, ts: r.ts.getTime() })),
    rideId,
  });
});

// ─── BIDS ────────────────────────────────────────────────────────────────────

router.get("/admin/bids", requireAdmin, async (req, res) => {
  const status = req.query.status as string | undefined;
  const validStatuses = ["active", "accepted", "rejected", "cancelled", "expired"] as const;
  const where = status && (validStatuses as readonly string[]).includes(status)
    ? eq(bidsTable.status, status as (typeof validStatuses)[number])
    : undefined;

  const rows = await db
    .select({
      bid: bidsTable,
      driver: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone },
      ride: {
        id: ridesTable.id,
        pickupLabel: ridesTable.pickupLabel,
        dropoffLabel: ridesTable.dropoffLabel,
        status: ridesTable.status,
        initialFare: ridesTable.initialFare,
      },
    })
    .from(bidsTable)
    .leftJoin(usersTable, eq(usersTable.id, bidsTable.driverId))
    .leftJoin(ridesTable, eq(ridesTable.id, bidsTable.rideId))
    .where(where)
    .orderBy(desc(bidsTable.createdAt))
    .limit(200);

  return res.json({
    bids: rows.map(({ bid, driver, ride }) => ({
      id: bid.id,
      rideId: bid.rideId,
      ridePickup: ride?.pickupLabel ?? "",
      rideDropoff: ride?.dropoffLabel ?? "",
      rideStatus: ride?.status ?? "",
      riderInitialFare: ride?.initialFare ?? null,
      driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || driver.phone : "Unknown",
      driverPhone: driver?.phone ?? "",
      amount: bid.amount,
      etaMin: bid.etaMin,
      note: bid.note,
      status: bid.status,
      expiresAt: bid.expiresAt,
      createdAt: bid.createdAt,
    })),
  });
});

// ─── BIDDING POSTS ───────────────────────────────────────────────────────────
//
// Admin visibility into the inDrive-style bidding flow: list of rides that
// are or were in `status='bidding'` along with the offer count + rider's
// initialFare + post-level expiry. Companion to /admin/bids which focuses
// on the offers themselves.

router.get("/admin/bidding/posts", requireAdmin, async (req, res) => {
  // Default view shows currently-active bidding posts; pass ?status=all to
  // include posts that already transitioned out (driver_arriving, cancelled,
  // etc.). Note: once a post is accepted the ride moves to driver_arriving —
  // we keep that visible here because the bid history lives on the same row.
  const status = req.query.status as string | undefined;
  const validRideStatuses = [
    "bidding",
    "driver_arriving",
    "in_progress",
    "completed",
    "cancelled",
  ] as const;
  let where;
  if (status === "all") {
    where = undefined;
  } else if (status && (validRideStatuses as readonly string[]).includes(status)) {
    where = eq(ridesTable.status, status as (typeof validRideStatuses)[number]);
  } else {
    where = eq(ridesTable.status, "bidding" as const);
  }

  const rows = await db
    .select({
      ride: ridesTable,
      rider: {
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
      },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(where)
    .orderBy(desc(ridesTable.createdAt))
    .limit(200);

  // Per-post offer counts. One round-trip rather than N+1 by aggregating
  // on the bids table and joining client-side.
  const rideIds = rows.map((r) => r.ride.id);
  const offerCounts =
    rideIds.length > 0
      ? await db
          .select({
            rideId: bidsTable.rideId,
            total: count(bidsTable.id),
            active: sum(sql<number>`CASE WHEN ${bidsTable.status} = 'active' THEN 1 ELSE 0 END`),
            accepted: sum(sql<number>`CASE WHEN ${bidsTable.status} = 'accepted' THEN 1 ELSE 0 END`),
          })
          .from(bidsTable)
          .where(inArray(bidsTable.rideId, rideIds))
          .groupBy(bidsTable.rideId)
      : [];
  const offerByRide = new Map(offerCounts.map((o) => [o.rideId, o]));

  return res.json({
    posts: rows.map(({ ride, rider }) => {
      const counts = offerByRide.get(ride.id);
      return {
        id: ride.id,
        rideStatus: ride.status,
        riderName: rider
          ? `${rider.firstName} ${rider.lastName}`.trim() || rider.phone
          : "Unknown",
        riderPhone: rider?.phone ?? "",
        pickupLabel: ride.pickupLabel,
        dropoffLabel: ride.dropoffLabel,
        estimatedDistanceKm: ride.estimatedDistanceKm,
        estimatedDurationMin: ride.estimatedDurationMin,
        initialFare: ride.initialFare,
        biddingExpiresAt: ride.biddingExpiresAt,
        offerCount: Number(counts?.total ?? 0),
        activeOfferCount: Number(counts?.active ?? 0),
        acceptedBidId: ride.acceptedBidId,
        acceptedDriverId: ride.acceptedDriverId,
        cancelledBy: ride.cancelledBy,
        cancellationReason: ride.cancellationReason,
        createdAt: ride.createdAt,
        updatedAt: ride.updatedAt,
      };
    }),
  });
});

/**
 * Admin force-cancels a stuck bidding post. Used when expiry didn't run, a
 * rider is unreachable, or a duplicate ride needs to be cleaned up. Also
 * cancels all active bids on the post so drivers don't see stale offers.
 */
router.post("/admin/bidding/posts/:rideId/cancel", requireAdmin, async (req, res) => {
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, req.params.rideId as string))
    .limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.status !== "bidding") {
    return res.status(409).json({ error: "not_bidding", currentStatus: ride.status });
  }

  const reason = (req.body?.reason as string | undefined)?.slice(0, 200) ?? "admin_cancelled";

  await db.transaction(async (tx) => {
    await tx
      .update(ridesTable)
      .set({
        status: "cancelled",
        cancelledBy: "system",
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(ridesTable.id, ride.id));
    await tx
      .update(bidsTable)
      .set({ status: "cancelled" })
      .where(and(eq(bidsTable.rideId, ride.id), eq(bidsTable.status, "active")));
  });

  return res.json({ ok: true });
});

/**
 * Admin force-cancels a single bidding offer. Lets operators clear out
 * problematic bids (offensive notes, abusive amounts, stuck states) without
 * waiting for the expiry sweep.
 */
router.post("/admin/bidding/offers/:bidId/cancel", requireAdmin, async (req, res) => {
  const [bid] = await db
    .select()
    .from(bidsTable)
    .where(eq(bidsTable.id, req.params.bidId as string))
    .limit(1);
  if (!bid) return res.status(404).json({ error: "not_found" });
  if (bid.status !== "active") {
    return res.status(409).json({ error: "not_active", currentStatus: bid.status });
  }

  await db
    .update(bidsTable)
    .set({ status: "cancelled" })
    .where(eq(bidsTable.id, bid.id));

  return res.json({ ok: true });
});

router.get("/admin/bidding/posts/:rideId", requireAdmin, async (req, res) => {
  const [row] = await db
    .select({
      ride: ridesTable,
      rider: {
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
      },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(eq(ridesTable.id, req.params.rideId as string))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });

  const offers = await db
    .select({
      bid: bidsTable,
      driver: {
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        driverRating: usersTable.rating,
      },
    })
    .from(bidsTable)
    .leftJoin(usersTable, eq(usersTable.id, bidsTable.driverId))
    .where(eq(bidsTable.rideId, req.params.rideId as string))
    .orderBy(desc(bidsTable.createdAt));

  return res.json({
    post: {
      id: row.ride.id,
      rideStatus: row.ride.status,
      riderName: row.rider
        ? `${row.rider.firstName} ${row.rider.lastName}`.trim() || row.rider.phone
        : "Unknown",
      riderPhone: row.rider?.phone ?? "",
      pickupLabel: row.ride.pickupLabel,
      pickupAddress: row.ride.pickupAddress,
      dropoffLabel: row.ride.dropoffLabel,
      dropoffAddress: row.ride.dropoffAddress,
      estimatedDistanceKm: row.ride.estimatedDistanceKm,
      estimatedDurationMin: row.ride.estimatedDurationMin,
      initialFare: row.ride.initialFare,
      biddingExpiresAt: row.ride.biddingExpiresAt,
      acceptedBidId: row.ride.acceptedBidId,
      acceptedDriverId: row.ride.acceptedDriverId,
      cancelledBy: row.ride.cancelledBy,
      cancellationReason: row.ride.cancellationReason,
      createdAt: row.ride.createdAt,
      updatedAt: row.ride.updatedAt,
    },
    offers: offers.map(({ bid, driver }) => ({
      id: bid.id,
      driverId: bid.driverId,
      driverName: driver
        ? `${driver.firstName} ${driver.lastName}`.trim() || driver.phone
        : "Unknown",
      driverPhone: driver?.phone ?? "",
      driverRating: driver?.driverRating ?? null,
      amount: bid.amount,
      etaMin: bid.etaMin,
      note: bid.note,
      status: bid.status,
      expiresAt: bid.expiresAt,
      createdAt: bid.createdAt,
    })),
  });
});

// ─── TRIPS ───────────────────────────────────────────────────────────────────

router.get("/admin/trips", requireAdmin, async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const tripStatuses = ["driver_arriving", "in_progress", "completed", "cancelled"] as const;
  const where = statusFilter && tripStatuses.includes(statusFilter as any)
    ? eq(ridesTable.status, statusFilter as typeof tripStatuses[number])
    : undefined;

  const rows = await db
    .select({
      ride: ridesTable,
      rider: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(
      where ?? and(
        ne(ridesTable.status, "bidding" as any),
      )
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(200);

  const driverIds = rows.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string; phone: string }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  // Pre-convert every trip's finalAmount into the platform display currency
  // server-side so the admin trips table renders the envelope directly
  // (no client-side FX math, no symbol/amount mismatch).
  const finalDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((r) => r.ride.finalAmount ?? null),
  );

  return res.json({
    trips: rows.map(({ ride, rider }, i) => {
      const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
      return {
        id: ride.id,
        riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() || rider.phone : "Unknown",
        riderPhone: rider?.phone ?? "",
        driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || driver.phone : "-",
        driverPhone: driver?.phone ?? "",
        pickup: ride.pickupLabel,
        pickupAddress: ride.pickupAddress,
        dropoff: ride.dropoffLabel,
        dropoffAddress: ride.dropoffAddress,
        distanceKm: ride.estimatedDistanceKm,
        finalAmount: ride.finalAmount,
        finalAmountDisplay: finalDisplays[i],
        vehicleClass: ride.vehicleClass,
        status: ride.status,
        ratingScore: ride.ratingScore,
        createdAt: ride.createdAt,
        updatedAt: ride.updatedAt,
      };
    }),
  });
});

router.get("/admin/trips/:tripId", requireAdmin, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.tripId as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
  const driver = ride.acceptedDriverId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ride.acceptedDriverId)).limit(1))[0]
    : null;
  const bids = await db.select().from(bidsTable).where(eq(bidsTable.rideId, ride.id)).orderBy(desc(bidsTable.createdAt));
  const [safetyAlert] = await db
    .select({ id: safetyAlertsTable.id, status: safetyAlertsTable.status, createdAt: safetyAlertsTable.createdAt })
    .from(safetyAlertsTable)
    .where(eq(safetyAlertsTable.rideId, ride.id))
    .orderBy(desc(safetyAlertsTable.createdAt))
    .limit(1);
  // Surface the attached coupon's code/description so the trip drawer shows
  // which promo the rider applied without needing a second fetch.
  const coupon = ride.couponId
    ? (await db.select().from(couponsTable).where(eq(couponsTable.id, ride.couponId)).limit(1))[0] ?? null
    : null;

  // Server-side display envelopes so the trip detail drawer / fare breakdown
  // table never needs client-side FX math and never mislabels USD with a
  // foreign symbol.
  const code = await getDisplayCurrencyCode();
  const finalAmountDisplay = await enrichWithPlatformCurrency(ride.finalAmount);
  const fareBreakdownDisplay = await enrichFareBreakdown(
    ride.fareBreakdown as Record<string, unknown> | null,
    code,
  );

  return res.json({
    trip: {
      ...ride,
      rider,
      driver,
      bids,
      safetyAlert: safetyAlert ?? null,
      coupon: coupon
        ? { id: coupon.id, code: coupon.code, description: coupon.description, discountType: coupon.discountType, discountValue: coupon.discountValue }
        : null,
      finalAmountDisplay,
      fareBreakdownDisplay,
    },
  });
});

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface InvoiceData {
  tripId: string;
  tripDate: string;
  tripTime: string;
  riderName: string;
  driverName: string;
  vehicleCategory: string | null;
  distanceKm: string;
  pickup: string;
  dropoff: string;
  currency: string;
  fareItems: Array<{ label: string; amount: number }>;
  /** Coupon discount line — rendered as a negative-amount row beneath the
   * fare items when the rider redeemed a coupon. NULL otherwise. */
  coupon: { code: string; discount: number } | null;
  total: number;
  commission: number;
  driverEarning: number;
  paymentMethod: string;
}

async function buildInvoiceData(tripId: string): Promise<InvoiceData | null> {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripId)).limit(1);
  if (!ride || ride.status !== "completed") return null;

  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
  const driver = ride.acceptedDriverId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ride.acceptedDriverId)).limit(1))[0]
    : null;

  const COMMISSION = 0.15;
  const fb: FareBreakdown | null = ride.fareBreakdown ?? null;
  // Invoice always renders in the platform display currency. Convert each
  // numeric line item server-side so fare items, coupon discount, total and
  // commission/driver-earning sub-rows are all consistent with the symbol
  // shown next to them. No hardcoded "MAD" anywhere.
  const code = await getDisplayCurrencyCode();
  const fbConverted = (await enrichFareBreakdown(
    (fb ?? {}) as Record<string, unknown>,
    code,
  )) as (Record<string, unknown> & { displaySymbol: string; currency: string }) | null;
  const currency = fbConverted?.currency ?? code;
  const totalEnv = await enrichWithPlatformCurrency(ride.finalAmount ?? 0);
  const total = totalEnv.displayAmount;
  const commission = Math.round(total * COMMISSION * 100) / 100;
  const driverEarning = Math.round((total - commission) * 100) / 100;

  // Read the converted line items from the enrichFareBreakdown result so
  // every visible amount on the invoice matches `currency` exactly.
  const fbc = (fbConverted ?? {}) as Record<string, unknown>;
  const num = (k: string): number | null => {
    const v = fbc[k];
    return typeof v === "number" ? v : null;
  };
  const fareItems: Array<{ label: string; amount: number }> = [];
  if (num("base") != null) fareItems.push({ label: "Base fare", amount: num("base") as number });
  if (num("distance") != null) fareItems.push({ label: `Distance (${(fb?.distanceKm ?? ride.estimatedDistanceKm).toFixed(1)} km)`, amount: num("distance") as number });
  if (num("time") != null) fareItems.push({ label: `Time (${fb?.durationMin ?? ride.estimatedDurationMin} min)`, amount: num("time") as number });
  if (num("peakSurcharge") != null && (num("peakSurcharge") as number) > 0) fareItems.push({ label: "Peak surcharge", amount: num("peakSurcharge") as number });
  if (num("nightSurcharge") != null && (num("nightSurcharge") as number) > 0) fareItems.push({ label: "Night surcharge", amount: num("nightSurcharge") as number });
  if (num("weatherSurcharge") != null && (num("weatherSurcharge") as number) > 0) {
    const ruleName = fb?.weatherRuleName ? ` (${fb.weatherRuleName})` : "";
    fareItems.push({ label: `Weather surcharge${ruleName}`, amount: num("weatherSurcharge") as number });
  }
  if (num("airportPickupSurcharge") != null && (num("airportPickupSurcharge") as number) > 0) {
    const name = fb?.airportPickupName ? ` (${fb.airportPickupName})` : "";
    fareItems.push({ label: `Airport pickup surcharge${name}`, amount: num("airportPickupSurcharge") as number });
  }
  if (num("airportDropoffSurcharge") != null && (num("airportDropoffSurcharge") as number) > 0) {
    const name = fb?.airportDropoffName ? ` (${fb.airportDropoffName})` : "";
    fareItems.push({ label: `Airport dropoff surcharge${name}`, amount: num("airportDropoffSurcharge") as number });
  }
  if (num("waitingFee") != null && (num("waitingFee") as number) > 0) fareItems.push({ label: `Waiting fee (${fb?.waitingMin ?? 0} min)`, amount: num("waitingFee") as number });

  // Prefer the coupon snapshot stored on the ride (set during /complete) so
  // the invoice doesn't break if the coupon row is later edited or removed.
  // Note: coupon discount is converted into the display currency too.
  const couponDiscountUsd = ride.couponDiscount ?? fb?.couponDiscount ?? null;
  const couponCode = fb?.couponCode ?? null;
  const couponDiscount = couponDiscountUsd != null
    ? (await enrichWithPlatformCurrency(couponDiscountUsd)).displayAmount
    : null;
  const coupon = couponDiscount != null && couponDiscount > 0 && couponCode
    ? { code: couponCode, discount: couponDiscount }
    : null;

  return {
    tripId: ride.id,
    tripDate: new Date(ride.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    tripTime: new Date(ride.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    riderName: rider ? `${rider.firstName ?? ""} ${rider.lastName ?? ""}`.trim() || rider.phone : "Rider",
    driverName: driver ? `${driver.firstName ?? ""} ${driver.lastName ?? ""}`.trim() || driver.phone : "-",
    vehicleCategory: ride.vehicleClass ? ride.vehicleClass.charAt(0).toUpperCase() + ride.vehicleClass.slice(1) : null,
    distanceKm: ride.estimatedDistanceKm.toFixed(1),
    pickup: ride.pickupAddress || ride.pickupLabel,
    dropoff: ride.dropoffAddress || ride.dropoffLabel,
    currency,
    fareItems,
    coupon,
    total,
    commission,
    driverEarning,
    paymentMethod: ride.paymentMethod === "card" ? "Card" : "Cash",
  };
}

function buildInvoiceHtml(inv: InvoiceData): string {
  const htmlLine = (label: string, value: string) =>
    `<div class="info-row"><span class="info-label">${escHtml(label)}</span><span class="info-val">${escHtml(value)}</span></div>`;
  const fareRow = (label: string, amount: number) =>
    `<tr><td>${escHtml(label)}</td><td>${escHtml(amount.toFixed(2) + " " + inv.currency)}</td></tr>`;

  const fareRows = inv.fareItems.map(({ label, amount }) => fareRow(label, amount)).join("\n          ");
  const couponRow = inv.coupon
    ? `<tr class="coupon-row"><td>Coupon (${escHtml(inv.coupon.code)})</td><td>${escHtml("-" + inv.coupon.discount.toFixed(2) + " " + inv.currency)}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Biddi Ride Invoice</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #111827; color: #fff; padding: 28px 32px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; }
    .header p { margin: 0; font-size: 13px; color: #9ca3af; }
    .body { padding: 28px 32px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 10px; }
    .info-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .info-label { font-size: 12px; color: #6b7280; min-width: 90px; padding-top: 2px; }
    .info-val { font-size: 13px; color: #111827; font-weight: 500; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; padding: 6px 0; border-bottom: 1px solid #e5e7eb; }
    th:last-child, td:last-child { text-align: right; }
    td { padding: 8px 0; color: #374151; border-bottom: 1px solid #f3f4f6; }
    .total-row td { font-weight: 700; color: #111827; border-top: 2px solid #e5e7eb; border-bottom: none; font-size: 14px; padding-top: 12px; }
    .footer { background: #f9fafb; padding: 16px 32px; text-align: center; font-size: 11px; color: #9ca3af; }
    .badge { display: inline-block; background: #d1fae5; color: #065f46; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 99px; }
    .coupon-row td { color: #047857; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Ride Invoice</h1>
      <p>Trip ID: ${escHtml(inv.tripId)}</p>
    </div>
    <div class="body">
      <p class="section-title">Ride Summary</p>
      ${htmlLine("Date", `${inv.tripDate} at ${inv.tripTime}`)}
      ${htmlLine("Rider", inv.riderName)}
      ${htmlLine("Driver", inv.driverName)}
      ${inv.vehicleCategory ? htmlLine("Category", inv.vehicleCategory) : ""}
      ${htmlLine("Distance", `${inv.distanceKm} km`)}
      <div class="info-row"><span class="info-label">Status</span><span class="info-val"><span class="badge">Completed</span></span></div>
      <hr class="divider" />
      <p class="section-title">Route</p>
      ${htmlLine("Pickup", inv.pickup)}
      ${htmlLine("Dropoff", inv.dropoff)}
      <hr class="divider" />
      <p class="section-title">Fare Breakdown</p>
      <table>
        <thead>
          <tr><th>Item</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${fareRows}
          ${couponRow}
          <tr class="total-row"><td>Total</td><td>${escHtml(inv.total.toFixed(2) + " " + inv.currency)}</td></tr>
        </tbody>
      </table>
      <hr class="divider" />
      ${htmlLine("Payment", inv.paymentMethod)}
    </div>
    <div class="footer">Thank you for riding with Biddi &mdash; ${escHtml(inv.tripDate)}</div>
  </div>
</body>
</html>`;
}

// ─── INVOICE EMAIL PREVIEW ────────────────────────────────────────────────────

router.get("/admin/invoice-email-preview", requireAdmin, (_req, res) => {
  const sampleInv: InvoiceData = {
    tripId: "preview-00000000",
    tripDate: "27 Apr 2026",
    tripTime: "14:35",
    riderName: "Sample Rider",
    driverName: "Sample Driver",
    vehicleCategory: "Economy",
    distanceKm: "12.4",
    pickup: "123 Main Street, Downtown",
    dropoff: "Casablanca Airport (CMN), Terminal 1",
    fareItems: [
      { label: "Base fare", amount: 15 },
      { label: "Distance (12.4 km)", amount: 37.2 },
      { label: "Booking fee", amount: 5 },
    ],
    total: 57.2,
    commission: 8.58,
    driverEarning: 48.62,
    paymentMethod: "Card",
    currency: "USD",
    coupon: { code: "WELCOME10", discount: 5.7 },
  };
  const html = buildInvoiceHtml(sampleInv);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

router.post("/admin/trips/:tripId/email-invoice", requireAdmin, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.tripId as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.status !== "completed") return res.status(422).json({ error: "not_completed", message: "Invoices can only be sent for completed rides." });

  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
  if (!rider?.email) return res.status(422).json({ error: "rider_no_email", message: "Rider has no email address on file." });

  const inv = await buildInvoiceData((req.params.tripId as string));
  if (!inv) return res.status(422).json({ error: "not_completed", message: "Invoices can only be sent for completed rides." });

  const html = buildInvoiceHtml(inv);

  try {
    await sendEmail({
      to: rider.email,
      subject: `Your Biddi ride invoice — ${inv.tripDate}`,
      html,
    });
    return res.json({ ok: true, sentTo: rider.email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email.";
    return res.status(500).json({ error: "email_failed", message });
  }
});

// ─── INVOICE PDF ─────────────────────────────────────────────────────────────

router.get("/admin/trips/:tripId/invoice.pdf", requireAdmin, async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, (req.params.tripId as string))).limit(1);
  if (!ride) return res.status(404).json({ error: "not_found" });

  const inv = await buildInvoiceData((req.params.tripId as string));
  if (!inv) return res.status(422).json({ error: "not_completed", message: "Invoices can only be generated for completed rides." });

  const fmt = (n: number) => `${n.toFixed(2)} ${inv.currency}`;

  const doc = new PDFDocument({ margin: 50, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${inv.tripId.slice(0, 8)}.pdf"`);
  doc.pipe(res);

  // ── Header ──
  doc.rect(0, 0, doc.page.width, 80).fill("#111827");
  doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text("Ride Invoice", 50, 25);
  doc.fillColor("#9ca3af").fontSize(10).font("Helvetica").text(`Trip ID: ${inv.tripId}`, 50, 52);

  doc.moveDown(3);
  doc.fillColor("#111827");

  // ── Section helper ──
  const sectionTitle = (title: string) => {
    doc.fillColor("#6b7280").fontSize(9).font("Helvetica-Bold").text(title.toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.3);
  };

  const infoRow = (label: string, value: string) => {
    const y = doc.y;
    doc.fillColor("#6b7280").fontSize(10).font("Helvetica").text(label, 50, y, { width: 120 });
    doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold").text(value, 180, y, { width: 330 });
    doc.moveDown(0.6);
  };

  const divider = () => {
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
    doc.moveDown(0.8);
  };

  // ── Ride Summary ──
  sectionTitle("Ride Summary");
  infoRow("Date", `${inv.tripDate} at ${inv.tripTime}`);
  infoRow("Rider", inv.riderName);
  infoRow("Driver", inv.driverName);
  if (inv.vehicleCategory) infoRow("Category", inv.vehicleCategory);
  infoRow("Distance", `${inv.distanceKm} km`);
  infoRow("Status", "Completed");

  divider();

  // ── Route ──
  sectionTitle("Route");
  infoRow("Pickup", inv.pickup);
  infoRow("Dropoff", inv.dropoff);

  divider();

  // ── Fare Breakdown ──
  sectionTitle("Fare Breakdown");

  const colLabel = 50;
  const colAmount = doc.page.width - 50 - 120;

  // Table header
  doc.fillColor("#6b7280").fontSize(9).font("Helvetica-Bold");
  doc.text("Item", colLabel, doc.y, { width: colAmount - colLabel });
  doc.text("Amount", colAmount, doc.y - doc.currentLineHeight(), { width: 120, align: "right" });
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(0.5);

  // Fare rows
  for (const { label, amount } of inv.fareItems) {
    const y = doc.y;
    doc.fillColor("#374151").fontSize(10).font("Helvetica").text(label, colLabel, y, { width: colAmount - colLabel });
    doc.text(fmt(amount), colAmount, y, { width: 120, align: "right" });
    doc.moveDown(0.6);
  }

  // Coupon discount row (rendered green like the HTML invoice)
  if (inv.coupon) {
    const y = doc.y;
    doc.fillColor("#047857").fontSize(10).font("Helvetica-Bold").text(`Coupon (${inv.coupon.code})`, colLabel, y, { width: colAmount - colLabel });
    doc.text(`-${fmt(inv.coupon.discount)}`, colAmount, y, { width: 120, align: "right" });
    doc.moveDown(0.6);
  }

  // Total row
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#111827").lineWidth(2).stroke();
  doc.moveDown(0.5);
  const totalY = doc.y;
  doc.fillColor("#111827").fontSize(12).font("Helvetica-Bold").text("Total", colLabel, totalY, { width: colAmount - colLabel });
  doc.text(`${inv.total.toFixed(2)} ${inv.currency}`, colAmount, totalY, { width: 120, align: "right" });
  doc.moveDown(1);

  // Commission breakdown
  const subY = doc.y;
  doc.fillColor("#6b7280").fontSize(9).font("Helvetica").text(`Commission (15%): ${fmt(inv.commission)}`, colLabel, subY);
  doc.text(`Driver earning: ${fmt(inv.driverEarning)}`, colLabel);
  doc.text(`Payment: ${inv.paymentMethod}`, colLabel);

  divider();

  // ── Footer ──
  doc.fillColor("#9ca3af").fontSize(9).font("Helvetica").text(`Thank you for riding with Biddi — ${inv.tripDate}`, { align: "center" });

  doc.end();
  return;
});

// ─── PAYMENTS ────────────────────────────────────────────────────────────────

router.get("/admin/payments", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      ride: ridesTable,
      rider: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(eq(ridesTable.status, "completed"))
    .orderBy(desc(ridesTable.createdAt))
    .limit(200);

  const driverIds = rows.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string; phone: string }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  const COMMISSION = 0.15;

  // Convert each row's amounts into the platform display currency once,
  // server-side, so the payments table and KPI cards always render in
  // exact agreement with the symbol the operator sees.
  const amountDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((r) => r.ride.finalAmount ?? 0),
  );
  const commissionDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((r) => Math.round((r.ride.finalAmount ?? 0) * COMMISSION * 100) / 100),
  );
  const earningDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((r) => {
      const amount = r.ride.finalAmount ?? 0;
      const commission = Math.round(amount * COMMISSION * 100) / 100;
      return Math.round((amount - commission) * 100) / 100;
    }),
  );

  const payments = rows.map(({ ride, rider }, i) => {
    const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
    const amount = ride.finalAmount ?? 0;
    const commission = Math.round(amount * COMMISSION * 100) / 100;
    const driverEarning = Math.round((amount - commission) * 100) / 100;
    return {
      id: ride.id,
      tripId: ride.id,
      riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() || rider.phone : "Unknown",
      driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || driver.phone : "-",
      amount,
      amountDisplay: amountDisplays[i],
      adminCommission: commission,
      adminCommissionDisplay: commissionDisplays[i],
      driverEarning,
      driverEarningDisplay: earningDisplays[i],
      method: "cash",
      status: amount > 0 ? "paid" : "pending",
      createdAt: ride.createdAt,
    };
  });

  const totalAmount = payments.reduce((s, p) => s + p.amount, 0);
  const totalCommission = payments.reduce((s, p) => s + p.adminCommission, 0);
  const totalDriverEarning = payments.reduce((s, p) => s + p.driverEarning, 0);
  const pendingCash = payments
    .filter((p) => p.status === "pending")
    .reduce((s, p) => s + p.amount, 0);

  const [
    grossRideValueDisplay,
    adminCommissionDisplay,
    driverEarningsDisplay,
    pendingCashDisplay,
  ] = await bulkEnrichWithPlatformCurrency([
    totalAmount,
    totalCommission,
    totalDriverEarning,
    pendingCash,
  ]);

  return res.json({
    payments,
    summary: {
      grossRideValue: totalAmount,
      grossRideValueDisplay,
      adminCommission: totalCommission,
      adminCommissionDisplay,
      driverEarnings: totalDriverEarning,
      driverEarningsDisplay,
      pendingCash,
      pendingCashDisplay,
    },
    displayCurrency: grossRideValueDisplay.displayCurrency,
    displaySymbol: grossRideValueDisplay.displaySymbol,
  });
});

// ─── REVIEWS ─────────────────────────────────────────────────────────────────

router.get("/admin/reviews", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      ride: ridesTable,
      rider: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(sql`${ridesTable.ratingScore} IS NOT NULL`)
    .orderBy(desc(ridesTable.createdAt))
    .limit(200);

  const driverIds = rows.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  return res.json({
    reviews: rows.map(({ ride, rider }) => {
      const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
      return {
        id: ride.id,
        tripId: ride.id,
        riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() : "Rider",
        driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() : "-",
        score: ride.ratingScore,
        createdAt: ride.createdAt,
      };
    }),
  });
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────

router.get("/admin/reports/overview", requireAdmin, async (req, res) => {
  const range = (req.query.range as string) ?? "30d";
  const days = range === "7d" ? 7 : range === "today" ? 1 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totals] = await db
    .select({
      total: count(ridesTable.id),
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')`,
      revenue: sum(ridesTable.finalAmount),
    })
    .from(ridesTable)
    .where(gte(ridesTable.createdAt, since));

  const dailyRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${ridesTable.createdAt})::date::text`,
      trips: count(ridesTable.id),
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')`,
      revenue: sum(ridesTable.finalAmount),
    })
    .from(ridesTable)
    .where(gte(ridesTable.createdAt, since))
    .groupBy(sql`date_trunc('day', ${ridesTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${ridesTable.createdAt})`);

  const activeDrivers = await db
    .select({ day: sql<string>`date_trunc('day', ${ridesTable.updatedAt})::date::text`, drivers: sql<number>`count(distinct ${ridesTable.acceptedDriverId})` })
    .from(ridesTable)
    .where(and(gte(ridesTable.createdAt, since), sql`${ridesTable.acceptedDriverId} IS NOT NULL`))
    .groupBy(sql`date_trunc('day', ${ridesTable.updatedAt})`)
    .orderBy(sql`date_trunc('day', ${ridesTable.updatedAt})`);

  // Resolve the platform's display currency and convert all monetary
  // values to it server-side. This keeps "Revenue (MAD/USD/EUR)" labels
  // and chart tooltips consistent with the operator's chosen display
  // currency without any client-side FX math.
  const { resolveDisplayCurrency, enrichAmount } = await import("../lib/currency");
  const { getDisplayCurrencyCode } = await import("../lib/displayAmount");
  const displayCode = await resolveDisplayCurrency(await getDisplayCurrencyCode());
  const totalRevenueUsd = Number(totals?.revenue ?? 0);
  const totalRevenueDisplay = await enrichAmount(totalRevenueUsd, displayCode);
  const dailyTrips = await Promise.all(
    dailyRows.map(async (r) => {
      const usd = Number(r.revenue ?? 0);
      const env = await enrichAmount(usd, displayCode);
      return {
        day: r.day,
        trips: Number(r.trips),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
        revenue: usd,
        revenueDisplay: env.displayAmount,
      };
    }),
  );

  return res.json({
    summary: {
      totalTrips: Number(totals?.total ?? 0),
      completedTrips: Number(totals?.completed ?? 0),
      cancelledTrips: Number(totals?.cancelled ?? 0),
      totalRevenue: totalRevenueUsd,
      totalRevenueDisplay,
    },
    displayCurrency: totalRevenueDisplay.displayCurrency,
    displaySymbol: totalRevenueDisplay.displaySymbol,
    dailyTrips,
    activeDriversByDay: activeDrivers.map((r) => ({ day: r.day, drivers: Number(r.drivers) })),
  });
});

// ─── LIVE MAP ────────────────────────────────────────────────────────────────

// Approved drivers whose last-known GPS fix is within this window are
// considered "recently offline" and surfaced to the admin live map so the
// admin can see where every recently-active driver was last seen, not just
// drivers currently streaming over socket. The window is admin-configurable
// (driverOfflineWindowHours, default 6h) so day-only fleets can use a shorter
// window and 24/7 fleets can use a longer one without redeploying. Bounds
// match the PUT /admin/settings schema (1–48h); we still defensively clamp
// here in case stored data drifts outside that range.
const OFFLINE_WINDOW_MIN_HOURS = 1;
const OFFLINE_WINDOW_MAX_HOURS = 48;

router.get("/admin/live-map", requireAdmin, async (_req, res) => {
  const cfg = await getConfig();
  const offlineWindowHours = Math.min(
    OFFLINE_WINDOW_MAX_HOURS,
    Math.max(OFFLINE_WINDOW_MIN_HOURS, Number(cfg.driverOfflineWindowHours) || 6),
  );
  const offlineWindowMs = offlineWindowHours * 60 * 60 * 1000;
  const activeRides = await db
    .select({
      ride: ridesTable,
      rider: { firstName: usersTable.firstName, lastName: usersTable.lastName },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(sql`${ridesTable.status} IN ('bidding','driver_arriving','in_progress')`)
    .orderBy(desc(ridesTable.createdAt))
    .limit(50);

  const driverIds = activeRides.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string; phone: string }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  const [counts] = await db
    .select({
      total: count(usersTable.id),
      online: sql<number>`count(*) filter (where ${usersTable.driverOnline} = true)`,
    })
    .from(usersTable)
    .where(eq(usersTable.driverStatus, "approved"));

  // Approved drivers who are currently online AND have no active ride
  // (bidding / driver_arriving / in_progress). These are the drivers
  // immediately available for dispatch. We compute this server-side so
  // the frontend does not have to cross-reference the rides list itself.
  const [availableCount] = await db
    .select({ available: count(usersTable.id) })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.driverStatus, "approved"),
        eq(usersTable.driverOnline, true),
        sql`${usersTable.id} NOT IN (
          SELECT ${ridesTable.acceptedDriverId}
          FROM ${ridesTable}
          WHERE ${ridesTable.status} IN ('bidding','driver_arriving','in_progress')
          AND ${ridesTable.acceptedDriverId} IS NOT NULL
        )`,
      ),
    );

  // Approved drivers with a recent last-known GPS fix who are NOT currently
  // in the live socket map. The frontend optionally renders these as faded
  // "not available" markers so admins can still see where each driver was
  // last seen across the fleet.
  const offlineCutoff = new Date(Date.now() - offlineWindowMs);
  const liveIds = getLiveDriverIdSet();
  const offlineRows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      lastKnownLat: usersTable.lastKnownLat,
      lastKnownLng: usersTable.lastKnownLng,
      lastKnownAt: usersTable.lastKnownAt,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      plate: vehiclesTable.plate,
    })
    .from(usersTable)
    .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
    .where(
      and(
        eq(usersTable.driverStatus, "approved"),
        // No `lastKnownLat IS NOT NULL` filter — we deliberately keep
        // approved drivers with missing coordinates in the response so the
        // admin list can show them with a "Location unavailable" badge.
        // Only the marker layer on the frontend gates on coordinate
        // validity. We still require lastKnownAt to be recent so the list
        // doesn't fill up with drivers who haven't opened the app in days.
        gte(usersTable.lastKnownAt, offlineCutoff),
      ),
    )
    .limit(500);
  // Strict coord validity gate matches the frontend `isValidCoordinate`
  // helper — finite numbers, in range, and non-(0,0). When a driver fails
  // the gate we still return the row (so the admin list shows them with a
  // "location unavailable" marker) but with lat/lng nulled out — the
  // frontend uses null coords as the signal to skip marker rendering while
  // keeping the row in the unified driver list.
  // NOTE: Drizzle returns numeric(8,6) / real columns as strings in some
  // PostgreSQL driver configurations. We explicitly cast through Number()
  // here so the plottable gate never silently rejects valid-looking coords
  // that arrived as "31.79" instead of 31.79.
  const isPlottable = (lat: number | null, lng: number | null): boolean => {
    if (lat == null || lng == null) return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
  };
  const offlineDrivers = offlineRows
    .filter((r) => !liveIds.has(r.id))
    .map((r) => {
      // Explicit Number() cast to handle the case where Drizzle returns the
      // column value as a string (e.g. "31.79") instead of a JS number.
      const rawLat = r.lastKnownLat != null ? Number(r.lastKnownLat) : null;
      const rawLng = r.lastKnownLng != null ? Number(r.lastKnownLng) : null;
      const plottable = isPlottable(rawLat, rawLng);
      return {
        id: r.id,
        name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Driver",
        phone: r.phone ?? null,
        vehicle: r.make && r.model ? `${r.make} ${r.model}`.trim() : null,
        plate: r.plate ?? null,
        lat: plottable ? rawLat : null,
        lng: plottable ? rawLng : null,
        lastSeenAt: r.lastKnownAt ? r.lastKnownAt.getTime() : Date.now(),
      };
    });

  // Live drivers — same shape as the socket `drivers:snapshot` payload.
  // Returned by REST too so the admin live map can fall back to polling
  // this endpoint when the socket is disconnected. The set is filtered
  // server-side to coordinates that pass the strict validity gate.
  const liveDrivers = getLiveDriversSnapshot();

  const countsSummary = {
    totalDrivers: Number(counts?.total ?? 0),
    onlineDrivers: Number(counts?.online ?? 0),
    activeRides: activeRides.length,
    availableDrivers: Number(availableCount?.available ?? 0),
  };
  return res.json({
    // `counts` is the existing field name consumed by the frontend.
    // `stats` is documented in the God's View API contract — expose both
    // so any client depending on either field name keeps working.
    counts: countsSummary,
    stats: countsSummary,
    activeRides: activeRides.map(({ ride, rider }) => {
      const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
      return {
        id: ride.id,
        driverId: ride.acceptedDriverId ?? null,
        riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() : "Rider",
        driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() : null,
        status: ride.status,
        pickup: { lat: ride.pickupLat, lng: ride.pickupLng, label: ride.pickupLabel },
        dropoff: { lat: ride.dropoffLat, lng: ride.dropoffLng, label: ride.dropoffLabel },
      };
    }),
    offlineDrivers,
    liveDrivers,
  });
});

// ─── HEAT VIEW ───────────────────────────────────────────────────────────────

router.get("/admin/heat-view", requireAdmin, async (req, res) => {
  const range = (req.query.range as string) ?? "today";
  const type = (req.query.type as string) ?? "ride_requests";
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const statusFilter =
    type === "completed" ? eq(ridesTable.status, "completed")
      : type === "cancelled" ? eq(ridesTable.status, "cancelled")
      : undefined;

  const cells = await db
    .select({
      lat: sql<number>`ROUND(${ridesTable.pickupLat}::numeric, 2)`,
      lng: sql<number>`ROUND(${ridesTable.pickupLng}::numeric, 2)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(ridesTable)
    .where(
      and(
        gte(ridesTable.createdAt, since),
        sql`${ridesTable.pickupLat} IS NOT NULL`,
        sql`${ridesTable.pickupLng} IS NOT NULL`,
        statusFilter,
      )
    )
    .groupBy(
      sql`ROUND(${ridesTable.pickupLat}::numeric, 2)`,
      sql`ROUND(${ridesTable.pickupLng}::numeric, 2)`,
    )
    .orderBy(sql`COUNT(*) DESC`);

  return res.json({
    cells: cells.map((c) => ({
      lat: Number(c.lat),
      lng: Number(c.lng),
      count: Number(c.count),
    })),
  });
});

// ─── HEAT VIEW PICKUP HOTSPOTS ───────────────────────────────────────────────

router.get("/admin/heat-view/pickups", requireAdmin, async (req, res) => {
  const range = (req.query.range as string) ?? "today";
  const type = (req.query.type as string) ?? "ride_requests";
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const statusFilter =
    type === "completed" ? eq(ridesTable.status, "completed")
      : type === "cancelled" ? eq(ridesTable.status, "cancelled")
      : undefined;

  const cells = await db
    .select({
      lat: sql<number>`ROUND(${ridesTable.pickupLat}::numeric, 2)`,
      lng: sql<number>`ROUND(${ridesTable.pickupLng}::numeric, 2)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(ridesTable)
    .where(
      and(
        gte(ridesTable.createdAt, since),
        sql`${ridesTable.pickupLat} IS NOT NULL`,
        sql`${ridesTable.pickupLng} IS NOT NULL`,
        statusFilter,
      )
    )
    .groupBy(
      sql`ROUND(${ridesTable.pickupLat}::numeric, 2)`,
      sql`ROUND(${ridesTable.pickupLng}::numeric, 2)`,
    )
    .orderBy(sql`COUNT(*) DESC`);

  return res.json({
    cells: cells.map((c) => ({
      lat: Number(c.lat),
      lng: Number(c.lng),
      count: Number(c.count),
    })),
  });
});

// ─── HEAT VIEW DROPOFF HOTSPOTS ──────────────────────────────────────────────

router.get("/admin/heat-view/dropoffs", requireAdmin, async (req, res) => {
  const range = (req.query.range as string) ?? "today";
  const type = (req.query.type as string) ?? "ride_requests";
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const statusFilter =
    type === "completed" ? eq(ridesTable.status, "completed")
      : type === "cancelled" ? eq(ridesTable.status, "cancelled")
      : undefined;

  const cells = await db
    .select({
      lat: sql<number>`ROUND(${ridesTable.dropoffLat}::numeric, 2)`,
      lng: sql<number>`ROUND(${ridesTable.dropoffLng}::numeric, 2)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(ridesTable)
    .where(
      and(
        gte(ridesTable.createdAt, since),
        sql`${ridesTable.dropoffLat} IS NOT NULL`,
        sql`${ridesTable.dropoffLng} IS NOT NULL`,
        statusFilter,
      )
    )
    .groupBy(
      sql`ROUND(${ridesTable.dropoffLat}::numeric, 2)`,
      sql`ROUND(${ridesTable.dropoffLng}::numeric, 2)`,
    )
    .orderBy(sql`COUNT(*) DESC`);

  return res.json({
    cells: cells.map((c) => ({
      lat: Number(c.lat),
      lng: Number(c.lng),
      count: Number(c.count),
    })),
  });
});

// ─── HEAT VIEW ROUTE POINTS ───────────────────────────────────────────────────

function decodePolylineServer(encoded: string): [number, number][] {
  if (!encoded) return [];
  const coords: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

router.get("/admin/heat-view/routes", requireAdmin, async (req, res) => {
  const range = (req.query.range as string) ?? "today";
  const type = (req.query.type as string) ?? "ride_requests";
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const statusFilter =
    type === "completed" ? eq(ridesTable.status, "completed")
      : type === "cancelled" ? eq(ridesTable.status, "cancelled")
      : undefined;

  const rows = await db
    .select({ routePolyline: ridesTable.routePolyline })
    .from(ridesTable)
    .where(
      and(
        gte(ridesTable.createdAt, since),
        sql`${ridesTable.routePolyline} IS NOT NULL`,
        statusFilter,
      )
    )
    .limit(500);

  const SAMPLE_EVERY = 3;
  const points: [number, number, number][] = [];

  for (const row of rows) {
    if (!row.routePolyline) continue;
    const decoded = decodePolylineServer(row.routePolyline);
    for (let i = 0; i < decoded.length; i += SAMPLE_EVERY) {
      points.push([decoded[i][0], decoded[i][1], 1]);
    }
  }

  return res.json({ points });
});

// ─── HEAT VIEW CELL DRILL-DOWN ────────────────────────────────────────────────

router.get("/admin/heat-view/cell", requireAdmin, async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const range = (req.query.range as string) ?? "today";
  const type = (req.query.type as string) ?? "ride_requests";

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: "invalid_params", message: "lat and lng are required" });
  }

  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const statusFilter =
    type === "completed" ? eq(ridesTable.status, "completed")
      : type === "cancelled" ? eq(ridesTable.status, "cancelled")
      : undefined;

  const rows = await db
    .select({
      ride: {
        id: ridesTable.id,
        status: ridesTable.status,
        pickupLabel: ridesTable.pickupLabel,
        dropoffLabel: ridesTable.dropoffLabel,
        finalAmount: ridesTable.finalAmount,
        createdAt: ridesTable.createdAt,
        acceptedDriverId: ridesTable.acceptedDriverId,
      },
      rider: {
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
      },
    })
    .from(ridesTable)
    .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
    .where(
      and(
        gte(ridesTable.createdAt, since),
        sql`ROUND(${ridesTable.pickupLat}::numeric, 2) = ${lat}`,
        sql`ROUND(${ridesTable.pickupLng}::numeric, 2) = ${lng}`,
        statusFilter,
      )
    )
    .orderBy(desc(ridesTable.createdAt))
    .limit(50);

  const driverIds = rows.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string; phone: string }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  // Pre-convert every drilled-down ride's finalAmount so the heat-view cell
  // popover never has to do client-side FX math and never mislabels USD
  // with a foreign symbol.
  const cellDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((r) => r.ride.finalAmount ?? null),
  );

  return res.json({
    rides: rows.map(({ ride, rider }, i) => {
      const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
      return {
        id: ride.id,
        status: ride.status,
        pickupLabel: ride.pickupLabel,
        dropoffLabel: ride.dropoffLabel,
        finalAmount: ride.finalAmount,
        finalAmountDisplay: cellDisplays[i],
        createdAt: ride.createdAt,
        riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() || rider.phone : "Unknown",
        driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || driver.phone : null,
      };
    }),
  });
});

// ─── APP CLASS KEYS ──────────────────────────────────────────────────────────

const slugRegex = /^[a-z0-9_]+$/;

const appClassCreateSchema = z.object({
  slug: z.string().min(1).max(50).regex(slugRegex, "slug must be lowercase letters, numbers or underscores"),
  label: z.string().min(1).max(100),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "colorHex must be a valid hex color").optional().nullable(),
});

const appClassUpdateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "colorHex must be a valid hex color").optional().nullable(),
});

router.get("/admin/app-classes", requireAdmin, async (_req, res) => {
  const classes = await db
    .select()
    .from(appClassesTable)
    .orderBy(appClassesTable.createdAt);

  const usageMap: Record<string, { id: string; name: string }[]> = {};
  if (classes.length > 0) {
    const slugs = classes.map((c) => c.slug);
    const rows = await db
      .select({ classKey: vehicleTypesTable.classKey, id: vehicleTypesTable.id, name: vehicleTypesTable.name })
      .from(vehicleTypesTable)
      .where(inArray(vehicleTypesTable.classKey, slugs));
    for (const r of rows) {
      if (!r.classKey) continue;
      if (!usageMap[r.classKey]) usageMap[r.classKey] = [];
      usageMap[r.classKey].push({ id: r.id, name: r.name });
    }
  }

  return res.json({
    appClasses: classes.map((c) => {
      const vehicleTypes = usageMap[c.slug] ?? [];
      return {
        ...c,
        vehicleTypeCount: vehicleTypes.length,
        vehicleTypeNames: vehicleTypes.map((t) => t.name),
      };
    }),
  });
});

router.post("/admin/app-classes", requireAdmin, async (req, res) => {
  const parsed = appClassCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }

  const existing = await db
    .select({ id: appClassesTable.id })
    .from(appClassesTable)
    .where(eq(appClassesTable.slug, parsed.data.slug))
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "conflict", message: "a class key with this slug already exists" });
  }

  const [created] = await db.insert(appClassesTable).values(parsed.data).returning();
  return res.status(201).json({ appClass: created });
});

router.patch("/admin/app-classes/:id", requireAdmin, async (req, res) => {
  const parsed = appClassUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }

  const fields = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "invalid_input", message: "at least one field (label, colorHex) must be provided" });
  }

  const [existing] = await db
    .select()
    .from(appClassesTable)
    .where(eq(appClassesTable.id, (req.params.id as string)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const [updated] = await db
    .update(appClassesTable)
    .set(fields)
    .where(eq(appClassesTable.id, (req.params.id as string)))
    .returning();
  return res.json({ appClass: updated });
});

router.delete("/admin/app-classes/:id", requireAdmin, async (req, res) => {
  const [existing] = await db
    .select()
    .from(appClassesTable)
    .where(eq(appClassesTable.id, (req.params.id as string)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const [inUse] = await db
    .select({ cnt: count(vehicleTypesTable.id) })
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.classKey, existing.slug));
  const inUseCount = Number(inUse?.cnt ?? 0);
  if (inUseCount > 0) {
    const affectedTypes = await db
      .select({ id: vehicleTypesTable.id, name: vehicleTypesTable.name })
      .from(vehicleTypesTable)
      .where(eq(vehicleTypesTable.classKey, existing.slug));
    return res.status(409).json({
      error: "in_use",
      message: `This class key is used by ${inUseCount} vehicle type(s). Remove it from those types before deleting.`,
      affectedVehicleTypes: affectedTypes.map((t) => ({ id: t.id, name: t.name })),
    });
  }

  await db.delete(appClassesTable).where(eq(appClassesTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── SERVICE CATEGORIES (formerly Vehicle Types) ─────────────────────────────

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const peakWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(TIME_REGEX, "expected HH:MM"),
  endTime: z.string().regex(TIME_REGEX, "expected HH:MM"),
  multiplier: z.number().gt(1),
}).superRefine((w, ctx) => {
  if (w.startTime >= w.endTime) {
    // Peak windows are intra-day. Use night charges for overnight windows.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endTime"],
      message: "end time must be after start time (use night charges for overnight)",
    });
  }
  const uniqueDays = new Set(w.days);
  if (uniqueDays.size !== w.days.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["days"],
      message: "duplicate days are not allowed",
    });
  }
});

const vehicleTypeBaseSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional().nullable(),
  vehicleCategory: z.enum(["car", "moto"]).default("car"),
  poolEnabled: z.boolean().default(false),
  wheelchairAccess: z.boolean().default(false),
  assistAvailable: z.boolean().default(false),
  petFriendly: z.boolean().default(false),
  fareModelStrategy: z.enum(["incremental", "fixed"]).default("incremental"),
  pricePerKm: z.number().min(0),
  pricePerMin: z.number().min(0),
  baseFare: z.number().min(0),
  minimumFare: z.number().min(0),
  commissionPercent: z.number().min(0).max(100),
  cancellationTimeLimitMin: z.number().int().min(0).default(0),
  cancellationCharge: z.number().min(0).default(0),
  waitingTimeLimitMin: z.number().int().min(0).default(0),
  waitingCharge: z.number().min(0).default(0),
  inTransitWaitingFeePerMin: z.number().min(0).default(0),
  personCapacity: z.number().int().positive(),
  peakSurchargeEnabled: z.boolean().default(false),
  peakSurchargeWindows: z.array(peakWindowSchema).default([]),
  nightChargeEnabled: z.boolean().default(false),
  nightChargeStart: z.string().regex(TIME_REGEX).nullable().optional(),
  nightChargeEnd: z.string().regex(TIME_REGEX).nullable().optional(),
  nightChargeMultiplier: z.number().min(1).default(1.25),
  displayOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  iconUrl: z.string().max(2000).refine(
    (v) => v.startsWith("/api/storage/objects/uploads/"),
    { message: "iconUrl must be a canonical storage path starting with /api/storage/objects/uploads/" }
  ),
  classKey: z.string().regex(/^[a-z0-9_]+$/, "classKey must be lowercase letters, numbers or underscores").optional().nullable(),
  serviceAreaIds: z.array(z.string().uuid()).min(1, "select at least one location"),
});

function validateBusinessRules(d: {
  poolEnabled?: boolean;
  fareModelStrategy?: "incremental" | "fixed";
  nightChargeEnabled?: boolean;
  nightChargeStart?: string | null;
  nightChargeEnd?: string | null;
  nightChargeMultiplier?: number;
}): string | null {
  if (d.poolEnabled && d.fareModelStrategy && d.fareModelStrategy !== "fixed") {
    return "pool requires fixed fare model";
  }
  if (d.nightChargeEnabled) {
    if (!d.nightChargeStart || !d.nightChargeEnd) {
      return "night charge requires start and end times";
    }
    if (d.nightChargeStart === d.nightChargeEnd) {
      return "night charge start and end must differ";
    }
    if ((d.nightChargeMultiplier ?? 1) <= 1) {
      return "night charge multiplier must be greater than 1";
    }
  }
  return null;
}

async function loadVehicleTypeWithAreas(id: string) {
  const [vt] = await db
    .select()
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.id, id))
    .limit(1);
  if (!vt) return null;
  const links = await db
    .select({ serviceAreaId: vehicleTypeServiceAreasTable.serviceAreaId })
    .from(vehicleTypeServiceAreasTable)
    .where(eq(vehicleTypeServiceAreasTable.vehicleTypeId, id));
  return { ...vt, serviceAreaIds: links.map((l) => l.serviceAreaId) };
}

async function loadAllVehicleTypes() {
  const types = await db
    .select()
    .from(vehicleTypesTable)
    .orderBy(vehicleTypesTable.displayOrder);
  if (types.length === 0) return [];
  const links = await db.select().from(vehicleTypeServiceAreasTable);
  const linksByType = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByType.get(l.vehicleTypeId) ?? [];
    arr.push(l.serviceAreaId);
    linksByType.set(l.vehicleTypeId, arr);
  }
  return types.map((t) => ({
    ...t,
    serviceAreaIds: linksByType.get(t.id) ?? [],
  }));
}

/** Public — mobile app uses this to get icons + capability flags without auth.
 *  Optional ?lat=&lng= filters to categories whose service areas contain that
 *  point. When no polygon is set on a service area we treat it as open and
 *  the category is always available there. */
router.get("/vehicle-types", async (req, res) => {
  const types = await db
    .select()
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.active, true))
    .orderBy(vehicleTypesTable.displayOrder);

  if (types.length === 0) return res.json({ vehicleTypes: [] });

  const links = await db
    .select()
    .from(vehicleTypeServiceAreasTable);
  const linksByType = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByType.get(l.vehicleTypeId) ?? [];
    arr.push(l.serviceAreaId);
    linksByType.set(l.vehicleTypeId, arr);
  }
  const areas = await db
    .select()
    .from(serviceAreasTable)
    .where(eq(serviceAreasTable.active, true));
  const areaById = new Map(areas.map((a) => [a.id, a]));

  const latRaw = typeof req.query.lat === "string" ? parseFloat(req.query.lat) : NaN;
  const lngRaw = typeof req.query.lng === "string" ? parseFloat(req.query.lng) : NaN;
  const hasPoint = Number.isFinite(latRaw) && Number.isFinite(lngRaw);

  const matchesLocation = (typeId: string): boolean => {
    if (!hasPoint) return true;
    const ids = linksByType.get(typeId) ?? [];
    if (ids.length === 0) return true; // unrestricted category
    return ids.some((id) => {
      const a = areaById.get(id);
      if (!a) return false;
      // Open service area (no polygon drawn) matches everywhere.
      if (!a.polygonJson || a.polygonJson.trim() === "") return true;
      return pointInPolygon(latRaw, lngRaw, a.polygonJson);
    });
  };

  const filtered = types.filter((t) => matchesLocation(t.id));

  const allClasses = await db
    .select({ slug: appClassesTable.slug, label: appClassesTable.label, colorHex: appClassesTable.colorHex })
    .from(appClassesTable);
  const classBySlug = new Map(allClasses.map((c) => [c.slug, c]));

  return res.json({
    vehicleTypes: filtered.map((t) => {
      const cls = t.classKey ? classBySlug.get(t.classKey) : undefined;
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        classKey: t.classKey,
        classLabel: cls?.label ?? null,
        classColorHex: cls?.colorHex ?? null,
        iconUrl: t.iconUrl,
        active: t.active,
        displayOrder: t.displayOrder,
        vehicleCategory: t.vehicleCategory,
        personCapacity: t.personCapacity,
        poolEnabled: t.poolEnabled,
        wheelchairAccess: t.wheelchairAccess,
        petFriendly: t.petFriendly,
        assistAvailable: t.assistAvailable,
        baseFare: t.baseFare,
        pricePerKm: t.pricePerKm,
        pricePerMin: t.pricePerMin,
        minimumFare: t.minimumFare,
        serviceAreaIds: linksByType.get(t.id) ?? [],
      };
    }),
  });
});

router.get("/admin/vehicle-types", requireAdmin, async (_req, res) => {
  const vehicleTypes = await loadAllVehicleTypes();
  return res.json({ vehicleTypes });
});

router.get("/admin/vehicle-types/:id", requireAdmin, async (req, res) => {
  const vt = await loadVehicleTypeWithAreas((req.params.id as string));
  if (!vt) return res.status(404).json({ error: "not_found" });
  return res.json({ vehicleType: vt });
});

router.post("/admin/vehicle-types", requireAdmin, async (req, res) => {
  const parsed = vehicleTypeBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  const ruleErr = validateBusinessRules(parsed.data);
  if (ruleErr) return res.status(400).json({ error: "invalid_input", message: ruleErr });

  const { serviceAreaIds, ...row } = parsed.data;

  // Verify classKey exists in app_classes table
  if (row.classKey) {
    const validClass = await db
      .select({ id: appClassesTable.id })
      .from(appClassesTable)
      .where(eq(appClassesTable.slug, row.classKey))
      .limit(1);
    if (validClass.length === 0) {
      return res.status(400).json({ error: "invalid_input", message: `unknown class key: ${row.classKey}` });
    }
  }

  // Verify service areas exist
  const existing = await db
    .select({ id: serviceAreasTable.id })
    .from(serviceAreasTable)
    .where(inArray(serviceAreasTable.id, serviceAreaIds));
  if (existing.length !== serviceAreaIds.length) {
    return res.status(400).json({ error: "invalid_input", message: "unknown service area id" });
  }

  const [created] = await db.insert(vehicleTypesTable).values(row).returning();
  if (serviceAreaIds.length > 0) {
    await db.insert(vehicleTypeServiceAreasTable).values(
      serviceAreaIds.map((serviceAreaId) => ({
        vehicleTypeId: created.id,
        serviceAreaId,
      })),
    );
  }
  const full = await loadVehicleTypeWithAreas(created.id);
  return res.status(201).json({ vehicleType: full });
});

router.patch("/admin/vehicle-types/:id", requireAdmin, async (req, res) => {
  const parsed = vehicleTypeBaseSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }

  const [existing] = await db
    .select()
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.id, (req.params.id as string)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const { serviceAreaIds, ...rowUpdates } = parsed.data;

  // Verify supplied service area IDs exist before doing anything else
  if (serviceAreaIds !== undefined) {
    if (serviceAreaIds.length === 0) {
      return res.status(400).json({ error: "invalid_input", message: "at least one location required" });
    }
    const existingAreas = await db
      .select({ id: serviceAreasTable.id })
      .from(serviceAreasTable)
      .where(inArray(serviceAreasTable.id, serviceAreaIds));
    if (existingAreas.length !== serviceAreaIds.length) {
      return res.status(400).json({ error: "invalid_input", message: "unknown service area id" });
    }
  }

  // Verify classKey exists in app_classes table when provided
  if (rowUpdates.classKey) {
    const validClass = await db
      .select({ id: appClassesTable.id })
      .from(appClassesTable)
      .where(eq(appClassesTable.slug, rowUpdates.classKey))
      .limit(1);
    if (validClass.length === 0) {
      return res.status(400).json({ error: "invalid_input", message: `unknown class key: ${rowUpdates.classKey}` });
    }
  }

  // Compute the merged state (request overrides + persisted fallbacks)
  // and validate ALL invariants against that merged state — never trust
  // the partial subset alone, otherwise a PATCH could leave the row in
  // an invalid state by omitting required fields.
  const mergedIconUrl = rowUpdates.iconUrl ?? existing.iconUrl;
  let mergedAreaIds: string[];
  if (serviceAreaIds !== undefined) {
    mergedAreaIds = serviceAreaIds;
  } else {
    const links = await db
      .select({ serviceAreaId: vehicleTypeServiceAreasTable.serviceAreaId })
      .from(vehicleTypeServiceAreasTable)
      .where(eq(vehicleTypeServiceAreasTable.vehicleTypeId, (req.params.id as string)));
    mergedAreaIds = links.map((l) => l.serviceAreaId);
  }

  if (!mergedIconUrl || mergedIconUrl.trim().length === 0) {
    return res.status(400).json({ error: "invalid_input", message: "iconUrl is required" });
  }
  if (mergedAreaIds.length === 0) {
    return res.status(400).json({ error: "invalid_input", message: "at least one location required" });
  }

  const merged = {
    poolEnabled: rowUpdates.poolEnabled ?? existing.poolEnabled,
    fareModelStrategy: rowUpdates.fareModelStrategy ?? existing.fareModelStrategy,
    nightChargeEnabled: rowUpdates.nightChargeEnabled ?? existing.nightChargeEnabled,
    nightChargeStart: rowUpdates.nightChargeStart ?? existing.nightChargeStart,
    nightChargeEnd: rowUpdates.nightChargeEnd ?? existing.nightChargeEnd,
    nightChargeMultiplier:
      rowUpdates.nightChargeMultiplier ?? existing.nightChargeMultiplier,
  };
  const ruleErr = validateBusinessRules(merged);
  if (ruleErr) return res.status(400).json({ error: "invalid_input", message: ruleErr });

  if (Object.keys(rowUpdates).length > 0) {
    await db
      .update(vehicleTypesTable)
      .set({ ...rowUpdates, updatedAt: new Date() })
      .where(eq(vehicleTypesTable.id, (req.params.id as string)));
  }

  if (serviceAreaIds !== undefined) {
    await db
      .delete(vehicleTypeServiceAreasTable)
      .where(eq(vehicleTypeServiceAreasTable.vehicleTypeId, (req.params.id as string)));
    await db.insert(vehicleTypeServiceAreasTable).values(
      serviceAreaIds.map((serviceAreaId) => ({
        vehicleTypeId: (req.params.id as string),
        serviceAreaId,
      })),
    );
  }

  const full = await loadVehicleTypeWithAreas((req.params.id as string));
  return res.json({ vehicleType: full });
});

router.delete("/admin/vehicle-types/:id", requireAdmin, async (req, res) => {
  await db.delete(vehicleTypesTable).where(eq(vehicleTypesTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── SERVICE AREAS / GEO FENCE ───────────────────────────────────────────────

const geoFenceTypeEnum = z.enum(GEO_FENCE_TYPES);

function unwrapGeometry(node: any): any {
  if (!node || typeof node !== "object") return undefined;
  const t = node.type;
  if (t === "Feature") return unwrapGeometry(node.geometry);
  if (t === "FeatureCollection") {
    if (!Array.isArray(node.features) || node.features.length === 0) return undefined;
    return unwrapGeometry(node.features[0]);
  }
  return node;
}

function isPosition(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

function isLinearRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  if (!ring.every(isPosition)) return false;
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygonCoords(coords: unknown): boolean {
  return Array.isArray(coords) && coords.length > 0 && coords.every(isLinearRing);
}

function validatePolygonJson(value: unknown): { ok: true; serialized: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, serialized: null };
  let parsed: any = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return { ok: false }; }
  }
  if (!parsed || typeof parsed !== "object") return { ok: false };
  // Accept a bare Polygon/MultiPolygon geometry, a Feature wrapping one, or a
  // FeatureCollection whose first feature wraps one. The geometry must have
  // a coordinate array shaped like real linear rings (>=4 positions, ring
  // closes on itself, every position is [lon, lat] numbers).
  const geom = unwrapGeometry(parsed);
  if (!geom || typeof geom !== "object") return { ok: false };
  const t = geom.type;
  if (t === "Polygon") {
    if (!isPolygonCoords(geom.coordinates)) return { ok: false };
  } else if (t === "MultiPolygon") {
    if (
      !Array.isArray(geom.coordinates) ||
      geom.coordinates.length === 0 ||
      !geom.coordinates.every(isPolygonCoords)
    ) return { ok: false };
  } else {
    return { ok: false };
  }
  return { ok: true, serialized: JSON.stringify(parsed) };
}

router.get("/admin/service-areas", requireAdmin, async (req, res) => {
  const typeRaw = typeof req.query.type === "string" ? req.query.type : undefined;
  const country = typeof req.query.country === "string" && req.query.country ? req.query.country : undefined;
  const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const conds = [];
  if (typeRaw && (GEO_FENCE_TYPES as readonly string[]).includes(typeRaw)) {
    conds.push(eq(serviceAreasTable.type, typeRaw as (typeof GEO_FENCE_TYPES)[number]));
  }
  if (country) conds.push(eq(serviceAreasTable.country, country));
  if (statusRaw === "active") conds.push(eq(serviceAreasTable.active, true));
  else if (statusRaw === "inactive") conds.push(eq(serviceAreasTable.active, false));
  if (q.length > 0) conds.push(sql`lower(${serviceAreasTable.name}) like ${"%" + q.toLowerCase() + "%"}`);

  const areas = await db
    .select()
    .from(serviceAreasTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(serviceAreasTable.createdAt));
  return res.json({ serviceAreas: areas });
});

const serviceAreaSchema = z.object({
  name: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default("Morocco"),
  type: geoFenceTypeEnum.default("service_area"),
  polygonJson: z.union([z.string(), z.record(z.any()), z.null()]).optional(),
  active: z.boolean().default(true),
});

router.post("/admin/service-areas", requireAdmin, async (req, res) => {
  const parsed = serviceAreaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const polyCheck = validatePolygonJson(parsed.data.polygonJson);
  if (!polyCheck.ok) return res.status(400).json({ error: "invalid_polygon" });
  const [created] = await db
    .insert(serviceAreasTable)
    .values({ ...parsed.data, polygonJson: polyCheck.serialized })
    .returning();
  return res.status(201).json({ serviceArea: created });
});

router.get("/admin/service-areas/:id", requireAdmin, async (req, res) => {
  const [area] = await db.select().from(serviceAreasTable).where(eq(serviceAreasTable.id, (req.params.id as string))).limit(1);
  if (!area) return res.status(404).json({ error: "not_found" });
  return res.json({ serviceArea: area });
});

router.patch("/admin/service-areas/:id", requireAdmin, async (req, res) => {
  const parsed = serviceAreaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (Object.prototype.hasOwnProperty.call(parsed.data, "polygonJson")) {
    const polyCheck = validatePolygonJson(parsed.data.polygonJson);
    if (!polyCheck.ok) return res.status(400).json({ error: "invalid_polygon" });
    update.polygonJson = polyCheck.serialized;
  }
  const [updated] = await db
    .update(serviceAreasTable)
    .set(update)
    .where(eq(serviceAreasTable.id, (req.params.id as string)))
    .returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ serviceArea: updated });
});

router.delete("/admin/service-areas/:id", requireAdmin, async (req, res) => {
  await db.delete(serviceAreasTable).where(eq(serviceAreasTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── COUNTRIES ───────────────────────────────────────────────────────────────

router.get("/admin/countries", requireAdmin, async (req, res) => {
  const onlyActive = req.query.active === "true";
  const rows = await db
    .select()
    .from(countriesTable)
    .where(onlyActive ? eq(countriesTable.active, true) : undefined)
    .orderBy(countriesTable.name);
  return res.json({ countries: rows });
});

const countrySchema = z.object({
  name: z.string().min(1).max(100),
  isoCode: z.string().min(2).max(3),
  active: z.boolean().default(true),
});

function isDuplicateError(err: any): boolean {
  const code = err?.code ?? err?.cause?.code ?? err?.original?.code;
  return code === "23505";
}

router.post("/admin/countries", requireAdmin, async (req, res) => {
  const parsed = countrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const isoCode = parsed.data.isoCode.toUpperCase();
  try {
    const [created] = await db
      .insert(countriesTable)
      .values({ ...parsed.data, isoCode })
      .returning();
    // If this ISO was previously tombstoned via DELETE, clear that record so
    // the seed step is allowed to re-create it again later if the admin
    // removes the row a different way (e.g. raw SQL).
    await db
      .delete(deletedCountryCodesTable)
      .where(eq(deletedCountryCodesTable.isoCode, isoCode));
    return res.status(201).json({ country: created });
  } catch (err: any) {
    if (isDuplicateError(err)) return res.status(409).json({ error: "duplicate_name" });
    throw err;
  }
});

router.patch("/admin/countries/:id", requireAdmin, async (req, res) => {
  const parsed = countrySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (typeof update.isoCode === "string") update.isoCode = (update.isoCode as string).toUpperCase();
  try {
    const [updated] = await db
      .update(countriesTable)
      .set(update)
      .where(eq(countriesTable.id, (req.params.id as string)))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ country: updated });
  } catch (err: any) {
    if (isDuplicateError(err)) return res.status(409).json({ error: "duplicate_name" });
    throw err;
  }
});

router.delete("/admin/countries/:id", requireAdmin, async (req, res) => {
  // Look up the row first so we can record its ISO code as a tombstone — that
  // way the geo-fence seed won't silently re-create it on the next API server
  // restart. We do this even if the country was already gone (defensive).
  const [existing] = await db
    .select({ isoCode: countriesTable.isoCode })
    .from(countriesTable)
    .where(eq(countriesTable.id, (req.params.id as string)))
    .limit(1);
  await db.delete(countriesTable).where(eq(countriesTable.id, (req.params.id as string)));
  if (existing?.isoCode) {
    const isoCode = existing.isoCode.toUpperCase();
    await db
      .insert(deletedCountryCodesTable)
      .values({ isoCode })
      .onConflictDoNothing({ target: deletedCountryCodesTable.isoCode });
  }
  return res.json({ ok: true });
});

// ─── REWARD LEVELS ────────────────────────────────────────────────────────────

router.get("/admin/reward-levels", requireAdmin, async (_req, res) => {
  const levels = await db.select().from(rewardLevelsTable).orderBy(rewardLevelsTable.minimumTrips);
  return res.json({ rewardLevels: levels });
});

const rewardLevelSchema = z.object({
  name: z.string().min(1).max(50),
  minimumTrips: z.number().int().min(0),
  minimumRating: z.number().min(0).max(5),
  maxCancellationRate: z.number().min(0).max(100),
  minAcceptanceRate: z.number().min(0).max(100),
  rewardAmount: z.number().min(0),
  active: z.boolean().default(true),
});

router.post("/admin/reward-levels", requireAdmin, async (req, res) => {
  const parsed = rewardLevelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [created] = await db.insert(rewardLevelsTable).values(parsed.data).returning();
  return res.status(201).json({ rewardLevel: created });
});

router.patch("/admin/reward-levels/:id", requireAdmin, async (req, res) => {
  const parsed = rewardLevelSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db.update(rewardLevelsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(rewardLevelsTable.id, (req.params.id as string))).returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ rewardLevel: updated });
});

router.delete("/admin/reward-levels/:id", requireAdmin, async (req, res) => {
  await db.delete(rewardLevelsTable).where(eq(rewardLevelsTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── APP CONTENT — BANNERS ───────────────────────────────────────────────────

router.get("/admin/content/banners", requireAdmin, async (_req, res) => {
  const banners = await db.select().from(appBannersTable).orderBy(appBannersTable.displayOrder);
  return res.json({ banners });
});

router.post("/admin/content/banners", requireAdmin, async (req, res) => {
  const parsed = z.object({
    title: z.string().min(1),
    imageUrl: z.string().optional(),
    placement: z.enum(["rider_home", "driver_home", "onboarding"]).default("rider_home"),
    active: z.boolean().default(true),
    displayOrder: z.number().int().default(0),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [created] = await db.insert(appBannersTable).values(parsed.data).returning();
  return res.status(201).json({ banner: created });
});

router.patch("/admin/content/banners/:id", requireAdmin, async (req, res) => {
  const parsed = z.object({
    title: z.string().min(1).optional(),
    imageUrl: z.string().optional(),
    placement: z.enum(["rider_home", "driver_home", "onboarding"]).optional(),
    active: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db.update(appBannersTable).set(parsed.data).where(eq(appBannersTable.id, (req.params.id as string))).returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ banner: updated });
});

router.delete("/admin/content/banners/:id", requireAdmin, async (req, res) => {
  await db.delete(appBannersTable).where(eq(appBannersTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── APP CONTENT — CANCELLATION REASONS ──────────────────────────────────────

router.get("/admin/content/cancellation-reasons", requireAdmin, async (_req, res) => {
  const reasons = await db.select().from(cancellationReasonsTable).orderBy(cancellationReasonsTable.createdAt);
  return res.json({ reasons });
});

router.post("/admin/content/cancellation-reasons", requireAdmin, async (req, res) => {
  const parsed = z.object({
    text: z.string().min(1),
    appliesTo: z.enum(["rider", "driver", "both"]).default("both"),
    active: z.boolean().default(true),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [created] = await db.insert(cancellationReasonsTable).values(parsed.data).returning();
  return res.status(201).json({ reason: created });
});

router.patch("/admin/content/cancellation-reasons/:id", requireAdmin, async (req, res) => {
  const parsed = z.object({ text: z.string().optional(), appliesTo: z.enum(["rider", "driver", "both"]).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db.update(cancellationReasonsTable).set(parsed.data).where(eq(cancellationReasonsTable.id, (req.params.id as string))).returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ reason: updated });
});

router.delete("/admin/content/cancellation-reasons/:id", requireAdmin, async (req, res) => {
  await db.delete(cancellationReasonsTable).where(eq(cancellationReasonsTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── NOTIFICATION TEMPLATES ───────────────────────────────────────────────────

router.get("/admin/notification-templates", requireAdmin, async (_req, res) => {
  const templates = await db.select().from(notificationTemplatesTable).orderBy(notificationTemplatesTable.type);
  return res.json({ templates });
});

router.post("/admin/notification-templates", requireAdmin, async (req, res) => {
  const parsed = z.object({
    type: z.enum(["sms", "email", "push"]),
    key: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    active: z.boolean().default(true),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [created] = await db.insert(notificationTemplatesTable).values(parsed.data).returning();
  return res.status(201).json({ template: created });
});

router.patch("/admin/notification-templates/:id", requireAdmin, async (req, res) => {
  const parsed = z.object({
    type: z.enum(["sms", "email", "push"]).optional(),
    key: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db.update(notificationTemplatesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(notificationTemplatesTable.id, (req.params.id as string))).returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ template: updated });
});

router.delete("/admin/notification-templates/:id", requireAdmin, async (req, res) => {
  await db.delete(notificationTemplatesTable).where(eq(notificationTemplatesTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── RESTRICTED AREAS ─────────────────────────────────────────────────────────

const restrictedAreaSchema = z.object({
  serviceAreaId: z.string().uuid(),
  restrictArea: z.enum(RESTRICT_AREA_VALUES).default("pickup"),
  restrictType: z.enum(RESTRICT_TYPE_VALUES).default("disallowed"),
  active: z.boolean().default(true),
});

router.get("/admin/restricted-areas", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: restrictedAreasTable.id,
      serviceAreaId: restrictedAreasTable.serviceAreaId,
      serviceAreaName: serviceAreasTable.name,
      restrictArea: restrictedAreasTable.restrictArea,
      restrictType: restrictedAreasTable.restrictType,
      active: restrictedAreasTable.active,
      createdAt: restrictedAreasTable.createdAt,
      updatedAt: restrictedAreasTable.updatedAt,
    })
    .from(restrictedAreasTable)
    .leftJoin(serviceAreasTable, eq(serviceAreasTable.id, restrictedAreasTable.serviceAreaId))
    .orderBy(desc(restrictedAreasTable.createdAt));
  return res.json({ restrictedAreas: rows });
});

router.post("/admin/restricted-areas", requireAdmin, async (req, res) => {
  const parsed = restrictedAreaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [created] = await db.insert(restrictedAreasTable).values(parsed.data).returning();
  const [withArea] = await db
    .select({
      id: restrictedAreasTable.id,
      serviceAreaId: restrictedAreasTable.serviceAreaId,
      serviceAreaName: serviceAreasTable.name,
      restrictArea: restrictedAreasTable.restrictArea,
      restrictType: restrictedAreasTable.restrictType,
      active: restrictedAreasTable.active,
      createdAt: restrictedAreasTable.createdAt,
      updatedAt: restrictedAreasTable.updatedAt,
    })
    .from(restrictedAreasTable)
    .leftJoin(serviceAreasTable, eq(serviceAreasTable.id, restrictedAreasTable.serviceAreaId))
    .where(eq(restrictedAreasTable.id, created.id))
    .limit(1);
  return res.status(201).json({ restrictedArea: withArea });
});

router.patch("/admin/restricted-areas/:id", requireAdmin, async (req, res) => {
  const parsed = restrictedAreaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db
    .update(restrictedAreasTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(restrictedAreasTable.id, (req.params.id as string)))
    .returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ restrictedArea: updated });
});

router.delete("/admin/restricted-areas/:id", requireAdmin, async (req, res) => {
  await db.delete(restrictedAreasTable).where(eq(restrictedAreasTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── WEATHER SURCHARGE RULES ─────────────────────────────────────────────────

const weatherConditionsSchema: z.ZodType<WeatherConditions> = z.object({
  rainMmGte: z.number().nonnegative().nullable().optional(),
  snowMmGte: z.number().nonnegative().nullable().optional(),
  tempCLte: z.number().nullable().optional(),
  tempCGte: z.number().nullable().optional(),
  windMsGte: z.number().nonnegative().nullable().optional(),
  weatherMain: z.array(z.string()).nullable().optional(),
});

const HHMM_RE = /^(\d{2}):(\d{2})$/;

const weatherRuleSchema = z
  .object({
    name: z.string().min(1).max(120),
    scope: z.enum(["country", "service_area"]),
    countryIso: z.string().min(2).max(3).nullable().optional(),
    serviceAreaId: z.string().uuid().nullable().optional(),
    conditions: weatherConditionsSchema.default({}),
    kind: z.enum(["multiplier", "fixed"]).default("multiplier"),
    value: z.number().min(0),
    startTime: z
      .string()
      .regex(HHMM_RE, "must be HH:MM")
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(HHMM_RE, "must be HH:MM")
      .nullable()
      .optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine(
    (d) =>
      (d.scope === "country" && !!d.countryIso) ||
      (d.scope === "service_area" && !!d.serviceAreaId),
    { message: "scope target is required" },
  )
  .refine(
    (d) => d.kind !== "multiplier" || d.value >= 1,
    { message: "multiplier rules must have value >= 1" },
  );

const weatherRulePatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    scope: z.enum(["country", "service_area"]),
    countryIso: z.string().min(2).max(3).nullable().optional(),
    serviceAreaId: z.string().uuid().nullable().optional(),
    conditions: weatherConditionsSchema.default({}),
    kind: z.enum(["multiplier", "fixed"]).default("multiplier"),
    value: z.number().min(0),
    startTime: z
      .string()
      .regex(HHMM_RE, "must be HH:MM")
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(HHMM_RE, "must be HH:MM")
      .nullable()
      .optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    active: z.boolean().default(true),
  })
  .partial();

function hasAnyCondition(c: WeatherConditions | undefined | null): boolean {
  if (!c) return false;
  return (
    c.rainMmGte != null ||
    c.snowMmGte != null ||
    c.tempCGte != null ||
    c.tempCLte != null ||
    c.windMsGte != null ||
    (Array.isArray(c.weatherMain) && c.weatherMain.length > 0)
  );
}

router.get("/admin/weather-surcharge-rules", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(weatherSurchargeRulesTable)
    .orderBy(desc(weatherSurchargeRulesTable.createdAt));
  return res.json({ rules: rows });
});

router.post("/admin/weather-surcharge-rules", requireAdmin, async (req, res) => {
  const parsed = weatherRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  if (!hasAnyCondition(parsed.data.conditions)) {
    return res.status(400).json({
      error: "invalid_input",
      message: "At least one weather condition is required.",
    });
  }
  const value = {
    ...parsed.data,
    countryIso: parsed.data.countryIso?.toUpperCase() ?? null,
    serviceAreaId: parsed.data.serviceAreaId ?? null,
    startTime: parsed.data.startTime ?? null,
    endTime: parsed.data.endTime ?? null,
    daysOfWeek: parsed.data.daysOfWeek ?? null,
  };
  const [created] = await db.insert(weatherSurchargeRulesTable).values(value).returning();
  return res.status(201).json({ rule: created });
});

router.patch("/admin/weather-surcharge-rules/:id", requireAdmin, async (req, res) => {
  const parsed = weatherRulePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  const [existing] = await db
    .select()
    .from(weatherSurchargeRulesTable)
    .where(eq(weatherSurchargeRulesTable.id, (req.params.id as string)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (typeof update.countryIso === "string") {
    update.countryIso = (update.countryIso as string).toUpperCase();
  }
  if (parsed.data.conditions !== undefined && !hasAnyCondition(parsed.data.conditions)) {
    return res.status(400).json({
      error: "invalid_input",
      message: "At least one weather condition is required.",
    });
  }
  const [updated] = await db
    .update(weatherSurchargeRulesTable)
    .set(update)
    .where(eq(weatherSurchargeRulesTable.id, (req.params.id as string)))
    .returning();
  return res.json({ rule: updated });
});

router.delete("/admin/weather-surcharge-rules/:id", requireAdmin, async (req, res) => {
  await db
    .delete(weatherSurchargeRulesTable)
    .where(eq(weatherSurchargeRulesTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

// ─── AIRPORT SURCHARGES ──────────────────────────────────────────────────────

/** List airport zones — service-area rows of type `airport_surcharge` that
 * have a center+radius set. Used by the admin dropdown when adding a new
 * surcharge so operators only pick from configured airports. */
router.get("/admin/airport-locations", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(serviceAreasTable)
    .where(eq(serviceAreasTable.type, "airport_surcharge"))
    .orderBy(serviceAreasTable.name);
  // Only return rows that actually have center+radius — incomplete rows
  // would not match anything in the haversine check anyway.
  const usable = rows.filter(
    (r) => r.centerLat != null && r.centerLng != null && r.radiusM != null,
  );
  return res.json({ airports: usable });
});

const airportLocationSchema = z.object({
  name: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default("Morocco"),
  centerLat: z.number().gte(-90).lte(90),
  centerLng: z.number().gte(-180).lte(180),
  radiusM: z.number().int().positive().max(50_000),
  active: z.boolean().default(true),
});

router.post("/admin/airport-locations", requireAdmin, async (req, res) => {
  const parsed = airportLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  const [created] = await db
    .insert(serviceAreasTable)
    .values({
      ...parsed.data,
      type: "airport_surcharge",
      polygonJson: null,
    })
    .returning();
  return res.status(201).json({ airport: created });
});

const airportSurchargeBaseSchema = z.object({
  airportLocationId: z.string().uuid(),
  vehicleTypeId: z.string().uuid(),
  surchargeType: z.enum(AIRPORT_SURCHARGE_TYPES).default("multiplier"),
  // Values must be > 0. For multiplier rules, 1 means "no surcharge" (the
  // subtotal is multiplied by 1). For fixed rules, callers should send the
  // exact extra amount to add per side.
  pickupSurchargeValue: z.number().positive().max(1_000_000),
  dropoffSurchargeValue: z.number().positive().max(1_000_000),
  active: z.boolean().default(true),
});

router.get("/admin/airport-surcharges", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: airportSurchargesTable.id,
      airportLocationId: airportSurchargesTable.airportLocationId,
      airportName: serviceAreasTable.name,
      vehicleTypeId: airportSurchargesTable.vehicleTypeId,
      vehicleTypeName: vehicleTypesTable.name,
      surchargeType: airportSurchargesTable.surchargeType,
      pickupSurchargeValue: airportSurchargesTable.pickupSurchargeValue,
      dropoffSurchargeValue: airportSurchargesTable.dropoffSurchargeValue,
      active: airportSurchargesTable.active,
      createdAt: airportSurchargesTable.createdAt,
      updatedAt: airportSurchargesTable.updatedAt,
    })
    .from(airportSurchargesTable)
    .leftJoin(
      serviceAreasTable,
      eq(serviceAreasTable.id, airportSurchargesTable.airportLocationId),
    )
    .leftJoin(
      vehicleTypesTable,
      eq(vehicleTypesTable.id, airportSurchargesTable.vehicleTypeId),
    )
    .orderBy(desc(airportSurchargesTable.createdAt));
  return res.json({ surcharges: rows });
});

router.post("/admin/airport-surcharges", requireAdmin, async (req, res) => {
  const parsed = airportSurchargeBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  // Verify the referenced airport zone exists and is the right type, and the
  // vehicle type exists. Drizzle would surface a FK violation, but a 400 with
  // a typed message is friendlier than a 500.
  const [airport] = await db
    .select()
    .from(serviceAreasTable)
    .where(eq(serviceAreasTable.id, parsed.data.airportLocationId))
    .limit(1);
  if (!airport || airport.type !== "airport_surcharge") {
    return res.status(400).json({ error: "invalid_input", message: "unknown airport location" });
  }
  const [vt] = await db
    .select({ id: vehicleTypesTable.id })
    .from(vehicleTypesTable)
    .where(eq(vehicleTypesTable.id, parsed.data.vehicleTypeId))
    .limit(1);
  if (!vt) {
    return res.status(400).json({ error: "invalid_input", message: "unknown vehicle type" });
  }
  try {
    const [created] = await db
      .insert(airportSurchargesTable)
      .values(parsed.data)
      .returning();
    return res.status(201).json({ surcharge: created });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res
        .status(409)
        .json({ error: "duplicate", message: "Surcharge already exists for this airport + vehicle type" });
    }
    throw err;
  }
});

/** Fetch a single surcharge by id — used by the admin edit screen and any
 * deep links. Returns the row alongside the joined airport + vehicle type
 * names so the UI doesn't need a follow-up lookup. */
router.get("/admin/airport-surcharges/:id", requireAdmin, async (req, res) => {
  const [row] = await db
    .select({
      id: airportSurchargesTable.id,
      airportLocationId: airportSurchargesTable.airportLocationId,
      airportName: serviceAreasTable.name,
      vehicleTypeId: airportSurchargesTable.vehicleTypeId,
      vehicleTypeName: vehicleTypesTable.name,
      surchargeType: airportSurchargesTable.surchargeType,
      pickupSurchargeValue: airportSurchargesTable.pickupSurchargeValue,
      dropoffSurchargeValue: airportSurchargesTable.dropoffSurchargeValue,
      active: airportSurchargesTable.active,
      createdAt: airportSurchargesTable.createdAt,
      updatedAt: airportSurchargesTable.updatedAt,
    })
    .from(airportSurchargesTable)
    .leftJoin(
      serviceAreasTable,
      eq(serviceAreasTable.id, airportSurchargesTable.airportLocationId),
    )
    .leftJoin(
      vehicleTypesTable,
      eq(vehicleTypesTable.id, airportSurchargesTable.vehicleTypeId),
    )
    .where(eq(airportSurchargesTable.id, (req.params.id as string)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  return res.json({ surcharge: row });
});

/** Full replace — required by the contract. PATCH accepts partial updates
 * for incremental form saves; PUT enforces all fields. Both surface a 409
 * when the new (airport, vehicleType) pair collides with another row. */
router.put("/admin/airport-surcharges/:id", requireAdmin, async (req, res) => {
  const parsed = airportSurchargeBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  try {
    const [updated] = await db
      .update(airportSurchargesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(airportSurchargesTable.id, (req.params.id as string)))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ surcharge: updated });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res
        .status(409)
        .json({ error: "duplicate", message: "Surcharge already exists for this airport + vehicle type" });
    }
    throw err;
  }
});

router.patch("/admin/airport-surcharges/:id", requireAdmin, async (req, res) => {
  const parsed = airportSurchargeBaseSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
  }
  try {
    const [updated] = await db
      .update(airportSurchargesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(airportSurchargesTable.id, (req.params.id as string)))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ surcharge: updated });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res
        .status(409)
        .json({ error: "duplicate", message: "Surcharge already exists for this airport + vehicle type" });
    }
    throw err;
  }
});

router.patch("/admin/airport-surcharges/:id/status", requireAdmin, async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [updated] = await db
    .update(airportSurchargesTable)
    .set({ active: parsed.data.active, updatedAt: new Date() })
    .where(eq(airportSurchargesTable.id, (req.params.id as string)))
    .returning();
  if (!updated) return res.status(404).json({ error: "not_found" });
  return res.json({ surcharge: updated });
});

router.delete("/admin/airport-surcharges/:id", requireAdmin, async (req, res) => {
  await db
    .delete(airportSurchargesTable)
    .where(eq(airportSurchargesTable.id, (req.params.id as string)));
  return res.json({ ok: true });
});

/** Most recent weather observation per scope. Surfaced in the admin UI so
 * the operator can see what the polling job last fetched and confirm a
 * rule's thresholds line up with the live data. */
router.get("/admin/weather-readings", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(weatherReadingsCacheTable)
    .orderBy(desc(weatherReadingsCacheTable.fetchedAt))
    .limit(200);
  const latestByScope = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    if (!latestByScope.has(r.scope)) latestByScope.set(r.scope, r);
  }
  return res.json({ readings: Array.from(latestByScope.values()) });
});

export default router;
