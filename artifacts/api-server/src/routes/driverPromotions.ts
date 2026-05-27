import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  driverPromotionsTable,
  driverPromotionProgressTable,
  driverPromotionTripLogsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAdmin, requireUser } from "../middlewares/auth";
import {
  getDriverPromotionViews,
  getDriverPromotionDetail,
  getPromotionSummary,
  getPromotionTripLogs,
  notifyPromotionStart,
} from "../services/driverPromotions";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const promotionInputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  bonusAmount: z.number().positive(),
  requiredTrips: z.number().int().min(1).max(500),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  repeatType: z.enum(["none", "daily", "weekly"]).default("none"),
  serviceAreaId: z.string().uuid().nullable().optional(),
  vehicleTypeId: z.string().uuid().nullable().optional(),
  driverScope: z.enum(["all", "selected"]).default("all"),
  eligibleDriverIds: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true),
});

function serialize(p: typeof driverPromotionsTable.$inferSelect) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    bonusAmount: p.bonusAmount,
    requiredTrips: p.requiredTrips,
    startAt: p.startAt.toISOString(),
    endAt: p.endAt.toISOString(),
    repeatType: p.repeatType,
    serviceAreaId: p.serviceAreaId,
    vehicleTypeId: p.vehicleTypeId,
    driverScope: p.driverScope,
    eligibleDriverIds: p.eligibleDriverIds ?? [],
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/admin/driver-promotions", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(driverPromotionsTable)
    .orderBy(desc(driverPromotionsTable.createdAt));
  res.json({ promotions: rows.map(serialize) });
});

router.post("/admin/driver-promotions", requireAdmin, async (req, res): Promise<void> => {
  const parsed = promotionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);
  if (endAt <= startAt) {
    res.status(400).json({ error: "end_before_start" });
    return;
  }
  const [row] = await db
    .insert(driverPromotionsTable)
    .values({
      title: data.title,
      description: data.description ?? null,
      bonusAmount: data.bonusAmount,
      requiredTrips: data.requiredTrips,
      startAt,
      endAt,
      repeatType: data.repeatType,
      serviceAreaId: data.serviceAreaId ?? null,
      vehicleTypeId: data.vehicleTypeId ?? null,
      driverScope: data.driverScope,
      eligibleDriverIds: data.eligibleDriverIds,
      isActive: data.isActive,
      createdByAdminId: req.adminId ?? null,
    })
    .returning();
  // Notify eligible drivers asynchronously when the promotion is live.
  if (row.isActive && row.startAt <= new Date() && row.endAt > new Date()) {
    void notifyPromotionStart(row);
  }
  res.json({ promotion: serialize(row) });
});

router.put("/admin/driver-promotions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = promotionInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.bonusAmount !== undefined) update.bonusAmount = data.bonusAmount;
  if (data.requiredTrips !== undefined) update.requiredTrips = data.requiredTrips;
  if (data.startAt !== undefined) update.startAt = new Date(data.startAt);
  if (data.endAt !== undefined) update.endAt = new Date(data.endAt);
  if (data.repeatType !== undefined) update.repeatType = data.repeatType;
  if (data.serviceAreaId !== undefined) update.serviceAreaId = data.serviceAreaId;
  if (data.vehicleTypeId !== undefined) update.vehicleTypeId = data.vehicleTypeId;
  if (data.driverScope !== undefined) update.driverScope = data.driverScope;
  if (data.eligibleDriverIds !== undefined) update.eligibleDriverIds = data.eligibleDriverIds;
  if (data.isActive !== undefined) update.isActive = data.isActive;

  const [existing] = await db
    .select()
    .from(driverPromotionsTable)
    .where(eq(driverPromotionsTable.id, id.data))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [row] = await db
    .update(driverPromotionsTable)
    .set(update)
    .where(eq(driverPromotionsTable.id, id.data))
    .returning();

  // Fire start notification if the promotion is being activated for the first
  // time (was inactive, now active and within window). The push lib dedups by
  // user/ticket so duplicate sends here are still cheap.
  if (
    row.isActive &&
    !existing.isActive &&
    row.startAt <= new Date() &&
    row.endAt > new Date()
  ) {
    void notifyPromotionStart(row);
  }
  res.json({ promotion: serialize(row) });
});

router.delete("/admin/driver-promotions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  await db
    .delete(driverPromotionsTable)
    .where(eq(driverPromotionsTable.id, id.data));
  res.json({ ok: true });
});

router.get("/admin/driver-promotions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const [row] = await db
    .select()
    .from(driverPromotionsTable)
    .where(eq(driverPromotionsTable.id, id.data))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ promotion: serialize(row) });
});

router.get("/admin/driver-promotions/:id/summary", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const summary = await getPromotionSummary(id.data);
    res.json({ summary });
  } catch (err) {
    logger.error({ err, promotionId: id.data }, "[promotions] summary failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/driver-promotions/:id/trip-logs", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  try {
    const logs = await getPromotionTripLogs(id.data, limit);
    res.json({ logs });
  } catch (err) {
    logger.error({ err, promotionId: id.data }, "[promotions] trip-logs failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/driver-promotions/:id/progress", requireAdmin, async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const rows = await db
    .select({
      progress: driverPromotionProgressTable,
      driverFirstName: usersTable.firstName,
      driverLastName: usersTable.lastName,
      driverPhone: usersTable.phone,
    })
    .from(driverPromotionProgressTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, driverPromotionProgressTable.driverId),
    )
    .where(eq(driverPromotionProgressTable.promotionId, id.data))
    .orderBy(desc(driverPromotionProgressTable.cycleStart));
  res.json({
    progress: rows.map((r) => ({
      id: r.progress.id,
      driverId: r.progress.driverId,
      driverName: `${r.driverFirstName ?? ""} ${r.driverLastName ?? ""}`.trim() || null,
      driverPhone: r.driverPhone,
      cycleStart: r.progress.cycleStart.toISOString(),
      cycleEnd: r.progress.cycleEnd.toISOString(),
      completedTrips: r.progress.completedTrips,
      rewardCredited: r.progress.rewardCredited,
      creditedAt: r.progress.creditedAt?.toISOString() ?? null,
    })),
  });
});

router.get("/driver/promotions/:id", requireUser, async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = z.string().uuid().safeParse((req.params.id as string));
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const detail = await getDriverPromotionDetail(req.userId, id.data, new Date());
    if (!detail) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      promotion: {
        id: detail.promotion.id,
        title: detail.promotion.title,
        description: detail.promotion.description,
        bonusAmount: detail.promotion.bonusAmount,
        requiredTrips: detail.promotion.requiredTrips,
        startAt: detail.promotion.startAt.toISOString(),
        endAt: detail.promotion.endAt.toISOString(),
        repeatType: detail.promotion.repeatType,
        cycleStart: detail.cycleStart?.toISOString() ?? null,
        cycleEnd: detail.cycleEnd?.toISOString() ?? null,
        completedTrips: detail.completedTrips,
        remaining: detail.remaining,
        rewardCredited: detail.rewardCredited,
        state: detail.state,
        serviceAreaId: detail.promotion.serviceAreaId,
        serviceAreaName: detail.serviceAreaName,
        serviceAreaPolygonJson: detail.serviceAreaPolygonJson,
        vehicleTypeId: detail.promotion.vehicleTypeId,
      },
    });
  } catch (err) {
    logger.error({ err, driverId: req.userId, id: id.data }, "[promotions] driver detail failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/driver/promotions", requireUser, async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const views = await getDriverPromotionViews(req.userId, new Date());
    res.json({
      promotions: views.map((v) => ({
        id: v.promotion.id,
        title: v.promotion.title,
        description: v.promotion.description,
        bonusAmount: v.promotion.bonusAmount,
        requiredTrips: v.promotion.requiredTrips,
        startAt: v.promotion.startAt.toISOString(),
        endAt: v.promotion.endAt.toISOString(),
        repeatType: v.promotion.repeatType,
        cycleStart: v.cycleStart?.toISOString() ?? null,
        cycleEnd: v.cycleEnd?.toISOString() ?? null,
        completedTrips: v.completedTrips,
        remaining: v.remaining,
        rewardCredited: v.rewardCredited,
        state: v.state,
        serviceAreaId: v.promotion.serviceAreaId,
        vehicleTypeId: v.promotion.vehicleTypeId,
      })),
    });
  } catch (err) {
    logger.error({ err, driverId: req.userId }, "[promotions] driver list failed");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
