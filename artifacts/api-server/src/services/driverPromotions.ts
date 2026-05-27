import {
  db,
  driverPromotionsTable,
  driverPromotionProgressTable,
  driverPromotionTripLogsTable,
  walletTransactionsTable,
  usersTable,
  ridesTable,
  serviceAreasTable,
  type DriverPromotion,
} from "@workspace/db";
import { and, eq, lte, gte, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendPushFromTemplate } from "./../lib/push";
import { pointInPolygon } from "../lib/geo";

export interface CycleWindow {
  start: Date;
  end: Date;
}

/**
 * Resolves the active cycle window for a promotion at a given moment.
 *
 * - `none` → fixed window = [startAt, endAt].
 * - `daily` → 24h window starting from the same time-of-day as startAt that
 *    contains `at`.
 * - `weekly` → 7d window aligned on the same weekday/time as startAt that
 *    contains `at`.
 *
 * Returns `null` when `at` falls outside the promotion's overall start/end
 * envelope.
 */
export function currentCycleWindow(
  p: Pick<DriverPromotion, "startAt" | "endAt" | "repeatType">,
  at: Date,
): CycleWindow | null {
  if (at < p.startAt || at >= p.endAt) return null;
  if (p.repeatType === "none") {
    return { start: new Date(p.startAt), end: new Date(p.endAt) };
  }
  const periodMs =
    p.repeatType === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const elapsed = at.getTime() - p.startAt.getTime();
  const cycleIdx = Math.floor(elapsed / periodMs);
  const start = new Date(p.startAt.getTime() + cycleIdx * periodMs);
  let end = new Date(start.getTime() + periodMs);
  if (end > p.endAt) end = new Date(p.endAt);
  return { start, end };
}

export async function getActivePromotionsAt(at: Date): Promise<DriverPromotion[]> {
  return db
    .select()
    .from(driverPromotionsTable)
    .where(
      and(
        eq(driverPromotionsTable.isActive, true),
        lte(driverPromotionsTable.startAt, at),
        gte(driverPromotionsTable.endAt, at),
      ),
    );
}

export function isDriverEligible(
  promotion: DriverPromotion,
  driverId: string,
): boolean {
  if (promotion.driverScope === "all") return true;
  return (promotion.eligibleDriverIds ?? []).includes(driverId);
}

/**
 * Resolves the pickup service area id for a ride by point-in-polygon check
 * against active service-area geo fences. Returns null when coordinates are
 * unavailable or no matching polygon exists.
 */
export async function resolveRideServiceAreaId(
  pickupLat: number | null,
  pickupLng: number | null,
): Promise<string | null> {
  if (pickupLat == null || pickupLng == null) return null;
  const areas = await db
    .select({
      id: serviceAreasTable.id,
      polygonJson: serviceAreasTable.polygonJson,
    })
    .from(serviceAreasTable)
    .where(
      and(
        eq(serviceAreasTable.active, true),
        eq(serviceAreasTable.type, "service_area"),
      ),
    );
  for (const a of areas) {
    if (pointInPolygon(pickupLng, pickupLat, a.polygonJson)) return a.id;
  }
  return null;
}

export function isRideEligible(
  promotion: DriverPromotion,
  ride: {
    vehicleTypeId: string | null;
    pickupServiceAreaId?: string | null;
  },
): boolean {
  if (promotion.vehicleTypeId && promotion.vehicleTypeId !== ride.vehicleTypeId)
    return false;
  if (promotion.serviceAreaId) {
    if (ride.pickupServiceAreaId !== promotion.serviceAreaId) return false;
  }
  return true;
}

interface RecordTripArgs {
  ride: {
    id: string;
    acceptedDriverId: string;
    vehicleTypeId: string | null;
    pickupLat?: number | null;
    pickupLng?: number | null;
  };
  completedAt: Date;
}

/**
 * Records a completed trip against every active, eligible driver promotion
 * for the trip's driver. For each matching promotion, the trip log insert,
 * progress upsert and (when threshold is met) reward credit run inside a
 * single transaction so partial failures cannot undercount progress.
 *
 * Idempotent per (promotion, ride, cycleStart) thanks to the unique
 * constraint on `driver_promotion_trip_logs`. Re-running for the same ride
 * is a no-op.
 */
export async function recordTripForPromotions(
  args: RecordTripArgs,
): Promise<void> {
  const { ride, completedAt } = args;
  if (!ride.acceptedDriverId) return;

  let active: DriverPromotion[];
  try {
    active = await getActivePromotionsAt(completedAt);
  } catch (err) {
    logger.error({ err, rideId: ride.id }, "[promotions] failed to load active promotions");
    return;
  }
  if (active.length === 0) return;

  // Resolve pickup service area only when at least one promotion needs it.
  let pickupServiceAreaId: string | null = null;
  if (active.some((p) => !!p.serviceAreaId)) {
    try {
      pickupServiceAreaId = await resolveRideServiceAreaId(
        ride.pickupLat ?? null,
        ride.pickupLng ?? null,
      );
    } catch (err) {
      logger.warn(
        { err, rideId: ride.id },
        "[promotions] failed to resolve pickup service area",
      );
    }
  }

  for (const promotion of active) {
    try {
      if (!isDriverEligible(promotion, ride.acceptedDriverId)) continue;
      if (!isRideEligible(promotion, { vehicleTypeId: ride.vehicleTypeId, pickupServiceAreaId })) continue;
      const cycle = currentCycleWindow(promotion, completedAt);
      if (!cycle) continue;

      const result = await db.transaction(async (tx) => {
        // Insert trip log; relies on unique (promotion_id, ride_id,
        // cycle_start) for idempotency. If a duplicate races in, bail out.
        const inserted = await tx
          .insert(driverPromotionTripLogsTable)
          .values({
            promotionId: promotion.id,
            driverId: ride.acceptedDriverId,
            rideId: ride.id,
            cycleStart: cycle.start,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) return null;

        // Upsert+increment the progress row in the same tx so log and counter
        // stay consistent.
        await tx
          .insert(driverPromotionProgressTable)
          .values({
            promotionId: promotion.id,
            driverId: ride.acceptedDriverId,
            cycleStart: cycle.start,
            cycleEnd: cycle.end,
            completedTrips: 1,
          })
          .onConflictDoUpdate({
            target: [
              driverPromotionProgressTable.promotionId,
              driverPromotionProgressTable.driverId,
              driverPromotionProgressTable.cycleStart,
            ],
            set: {
              completedTrips: sql`${driverPromotionProgressTable.completedTrips} + 1`,
              updatedAt: new Date(),
            },
          });

        const [progress] = await tx
          .select()
          .from(driverPromotionProgressTable)
          .where(
            and(
              eq(driverPromotionProgressTable.promotionId, promotion.id),
              eq(driverPromotionProgressTable.driverId, ride.acceptedDriverId),
              eq(driverPromotionProgressTable.cycleStart, cycle.start),
            ),
          )
          .limit(1);
        if (!progress) return null;

        let nearJustNotified = false;
        const remaining = promotion.requiredTrips - progress.completedTrips;
        if (
          remaining === 1 &&
          promotion.requiredTrips > 1 &&
          !progress.nearCompletionNotifiedAt
        ) {
          await tx
            .update(driverPromotionProgressTable)
            .set({ nearCompletionNotifiedAt: new Date() })
            .where(eq(driverPromotionProgressTable.id, progress.id));
          nearJustNotified = true;
        }

        // Threshold reached → claim+credit atomically in the same tx.
        let creditedJustNow = false;
        if (
          progress.completedTrips >= promotion.requiredTrips &&
          !progress.rewardCredited
        ) {
          const amount = Math.round(promotion.bonusAmount * 100) / 100;
          if (Number.isFinite(amount) && amount > 0) {
            const [claimed] = await tx
              .update(driverPromotionProgressTable)
              .set({
                rewardCredited: true,
                creditedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(driverPromotionProgressTable.id, progress.id),
                  eq(driverPromotionProgressTable.rewardCredited, false),
                ),
              )
              .returning();
            if (claimed) {
              await tx.insert(walletTransactionsTable).values({
                driverId: ride.acceptedDriverId,
                type: "promotion_bonus",
                amount,
                note: `Promotion bonus: ${promotion.title}`,
              });
              await tx
                .update(usersTable)
                .set({
                  walletBalance: sql`(${usersTable.walletBalance}::numeric + ${amount})::text`,
                })
                .where(eq(usersTable.id, ride.acceptedDriverId));
              creditedJustNow = true;
            }
          }
        }

        return { nearJustNotified, creditedJustNow };
      });

      if (!result) continue;

      // Push notifications fire after the tx commits so we don't notify on
      // rolled-back state. Failures here are best-effort and never throw up.
      if (result.nearJustNotified) {
        void sendPushFromTemplate(
          ride.acceptedDriverId,
          "promotion_near_completion",
          "Almost there!",
          `One more trip to earn $${promotion.bonusAmount.toFixed(2)} from "${promotion.title}".`,
          {
            promotionTitle: promotion.title,
            bonus: promotion.bonusAmount.toFixed(2),
            remaining: "1",
          },
          { type: "promotion_near_completion", promotionId: promotion.id },
        ).catch((err) => {
          logger.warn(
            { err, promotionId: promotion.id, driverId: ride.acceptedDriverId },
            "[promotions] near-completion push failed",
          );
        });
      }
      if (result.creditedJustNow) {
        const amount = Math.round(promotion.bonusAmount * 100) / 100;
        void sendPushFromTemplate(
          ride.acceptedDriverId,
          "promotion_bonus_earned",
          "Promotion bonus earned!",
          `You earned $${amount.toFixed(2)} from "${promotion.title}". It's been added to your wallet.`,
          {
            promotionTitle: promotion.title,
            bonus: amount.toFixed(2),
          },
          { type: "promotion_bonus_earned", promotionId: promotion.id },
        ).catch((err) => {
          logger.warn(
            { err, promotionId: promotion.id, driverId: ride.acceptedDriverId },
            "[promotions] bonus-earned push failed",
          );
        });
      }
    } catch (err) {
      logger.error(
        { err, rideId: ride.id, promotionId: promotion.id },
        "[promotions] failed to record trip for promotion",
      );
    }
  }
}

/**
 * Notifies eligible drivers that a new promotion has started. Bounded by the
 * promotion's vehicle-type filter (drivers who own at least one vehicle of
 * the matching type). Service-area filters do not gate the start push since
 * driver locations can change over time, but we tag the push payload with
 * the area so clients can suppress out-of-zone banners locally if needed.
 */
export async function notifyPromotionStart(
  promotion: DriverPromotion,
): Promise<void> {
  let driverIds: string[] = [];
  try {
    if (
      promotion.driverScope === "selected" &&
      promotion.eligibleDriverIds &&
      promotion.eligibleDriverIds.length > 0
    ) {
      driverIds = [...promotion.eligibleDriverIds];
    } else if (promotion.vehicleTypeId) {
      // Limit to approved drivers who own a vehicle of the required type.
      const rows = await db.execute<{ id: string }>(sql`
        SELECT DISTINCT u.id
        FROM users u
        INNER JOIN vehicles v ON v.driver_id = u.id
        WHERE u.driver_status = 'approved'
          AND v.vehicle_type_id = ${promotion.vehicleTypeId}
      `);
      const list = (rows as unknown as { rows?: { id: string }[] }).rows
        ?? (rows as unknown as { id: string }[]);
      driverIds = (Array.isArray(list) ? list : []).map((r) => r.id);
    } else {
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.driverStatus, "approved"));
      driverIds = rows.map((r) => r.id);
    }
  } catch (err) {
    logger.error({ err, promotionId: promotion.id }, "[promotions] failed to load drivers for start notification");
    return;
  }

  for (const driverId of driverIds) {
    void sendPushFromTemplate(
      driverId,
      "promotion_started",
      "New promotion available",
      `${promotion.title} — earn $${promotion.bonusAmount.toFixed(2)} for ${promotion.requiredTrips} trip${promotion.requiredTrips === 1 ? "" : "s"}.`,
      {
        promotionTitle: promotion.title,
        bonus: promotion.bonusAmount.toFixed(2),
        trips: String(promotion.requiredTrips),
      },
      { type: "promotion_started", promotionId: promotion.id, serviceAreaId: promotion.serviceAreaId ?? null },
    ).catch((err) => {
      logger.warn(
        { err, promotionId: promotion.id, driverId },
        "[promotions] start push failed",
      );
    });
  }
}

export interface DriverPromotionView {
  promotion: DriverPromotion;
  cycleStart: Date | null;
  cycleEnd: Date | null;
  completedTrips: number;
  rewardCredited: boolean;
  remaining: number;
  state: "in_progress" | "earned" | "expired" | "scheduled";
}

function deriveState(
  cycle: CycleWindow | null,
  rewardCredited: boolean,
  at: Date,
): DriverPromotionView["state"] {
  if (rewardCredited) return "earned";
  if (!cycle) return "scheduled";
  if (cycle.end <= at) return "expired";
  return "in_progress";
}

/**
 * Returns every active promotion the driver is eligible for, with current
 * cycle progress applied. Used by the driver-facing Quests screen.
 */
export async function getDriverPromotionViews(
  driverId: string,
  at: Date,
): Promise<DriverPromotionView[]> {
  const promos = await getActivePromotionsAt(at);
  const views: DriverPromotionView[] = [];
  for (const p of promos) {
    if (!isDriverEligible(p, driverId)) continue;
    const cycle = currentCycleWindow(p, at);
    let completedTrips = 0;
    let rewardCredited = false;
    if (cycle) {
      const [progress] = await db
        .select()
        .from(driverPromotionProgressTable)
        .where(
          and(
            eq(driverPromotionProgressTable.promotionId, p.id),
            eq(driverPromotionProgressTable.driverId, driverId),
            eq(driverPromotionProgressTable.cycleStart, cycle.start),
          ),
        )
        .limit(1);
      if (progress) {
        completedTrips = progress.completedTrips;
        rewardCredited = progress.rewardCredited;
      }
    }
    views.push({
      promotion: p,
      cycleStart: cycle?.start ?? null,
      cycleEnd: cycle?.end ?? null,
      completedTrips,
      rewardCredited,
      remaining: Math.max(0, p.requiredTrips - completedTrips),
      state: deriveState(cycle, rewardCredited, at),
    });
  }
  views.sort((a, b) => {
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    const ae = a.cycleEnd?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const be = b.cycleEnd?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ae - be;
  });
  return views;
}

export async function getDriverPromotionDetail(
  driverId: string,
  promotionId: string,
  at: Date,
): Promise<
  | (DriverPromotionView & {
      serviceAreaName: string | null;
      serviceAreaPolygonJson: string | null;
    })
  | null
> {
  const [p] = await db
    .select()
    .from(driverPromotionsTable)
    .where(eq(driverPromotionsTable.id, promotionId))
    .limit(1);
  if (!p) return null;
  if (!isDriverEligible(p, driverId)) return null;
  const cycle = currentCycleWindow(p, at);
  let completedTrips = 0;
  let rewardCredited = false;
  if (cycle) {
    const [progress] = await db
      .select()
      .from(driverPromotionProgressTable)
      .where(
        and(
          eq(driverPromotionProgressTable.promotionId, p.id),
          eq(driverPromotionProgressTable.driverId, driverId),
          eq(driverPromotionProgressTable.cycleStart, cycle.start),
        ),
      )
      .limit(1);
    if (progress) {
      completedTrips = progress.completedTrips;
      rewardCredited = progress.rewardCredited;
    }
  }
  let serviceAreaName: string | null = null;
  let serviceAreaPolygonJson: string | null = null;
  if (p.serviceAreaId) {
    const [sa] = await db
      .select({
        name: serviceAreasTable.name,
        polygonJson: serviceAreasTable.polygonJson,
      })
      .from(serviceAreasTable)
      .where(eq(serviceAreasTable.id, p.serviceAreaId))
      .limit(1);
    if (sa) {
      serviceAreaName = sa.name;
      serviceAreaPolygonJson = sa.polygonJson;
    }
  }
  return {
    promotion: p,
    cycleStart: cycle?.start ?? null,
    cycleEnd: cycle?.end ?? null,
    completedTrips,
    rewardCredited,
    remaining: Math.max(0, p.requiredTrips - completedTrips),
    state: deriveState(cycle, rewardCredited, at),
    serviceAreaName,
    serviceAreaPolygonJson,
  };
}

export interface PromotionSummary {
  totalProgressDrivers: number;
  totalCompletedDrivers: number;
  totalBonusPaidCount: number;
  totalBonusPaidAmount: number;
  totalTripsLogged: number;
}

export async function getPromotionSummary(promotionId: string): Promise<PromotionSummary> {
  const progress = await db
    .select({
      driverId: driverPromotionProgressTable.driverId,
      rewardCredited: driverPromotionProgressTable.rewardCredited,
    })
    .from(driverPromotionProgressTable)
    .where(eq(driverPromotionProgressTable.promotionId, promotionId));
  const distinctDrivers = new Set(progress.map((p) => p.driverId));
  const completedRows = progress.filter((p) => p.rewardCredited);
  const completedDrivers = new Set(completedRows.map((p) => p.driverId));

  const [tripCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(driverPromotionTripLogsTable)
    .where(eq(driverPromotionTripLogsTable.promotionId, promotionId));

  const [p] = await db
    .select({ bonusAmount: driverPromotionsTable.bonusAmount })
    .from(driverPromotionsTable)
    .where(eq(driverPromotionsTable.id, promotionId))
    .limit(1);
  const bonus = p?.bonusAmount ?? 0;
  const totalBonusPaidCount = completedRows.length;

  return {
    totalProgressDrivers: distinctDrivers.size,
    totalCompletedDrivers: completedDrivers.size,
    totalBonusPaidCount,
    totalBonusPaidAmount: Math.round(totalBonusPaidCount * bonus * 100) / 100,
    totalTripsLogged: Number(tripCount?.c ?? 0),
  };
}

export async function getPromotionTripLogs(
  promotionId: string,
  limit = 200,
): Promise<
  Array<{
    id: string;
    driverId: string;
    driverName: string | null;
    rideId: string;
    cycleStart: string;
    createdAt: string;
  }>
> {
  const rows = await db
    .select({
      log: driverPromotionTripLogsTable,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(driverPromotionTripLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, driverPromotionTripLogsTable.driverId))
    .where(eq(driverPromotionTripLogsTable.promotionId, promotionId))
    .orderBy(sql`${driverPromotionTripLogsTable.createdAt} DESC`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.log.id,
    driverId: r.log.driverId,
    driverName: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || null,
    rideId: r.log.rideId,
    cycleStart: r.log.cycleStart.toISOString(),
    createdAt: r.log.createdAt.toISOString(),
  }));
}

// Used by the trip-completion hook to satisfy the type checker.
export type _RidesTable = typeof ridesTable;
// Reserved import marker to keep tree-shaking happy if we later filter by
// driver-visible recently-completed trips.
export const _unused = { inArray };
