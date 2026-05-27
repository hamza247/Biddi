import { Router, type IRouter } from "express";
import {
  db,
  safetyAlertsTable,
  ridesTable,
  usersTable,
  adminsTable,
} from "@workspace/db";
import { and, eq, desc, asc, count } from "drizzle-orm";
import { requireUser, requireAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { emitToAdmins } from "../lib/io";

const router: IRouter = Router();

/**
 * POST /api/rides/:id/safety-alert
 * Trigger a safety alert for a trip. Authenticated user must be the rider or
 * the driver on the ride.
 */
router.post("/rides/:id/safety-alert", requireUser, async (req, res) => {
  const rideId = (req.params.id as string);
  const userId = req.userId!;

  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, rideId))
    .limit(1);

  if (!ride) return res.status(404).json({ error: "ride_not_found" });

  const isParticipant =
    ride.riderId === userId || ride.acceptedDriverId === userId;
  if (!isParticipant)
    return res.status(403).json({ error: "not_a_participant" });

  if (!["driver_arriving", "in_progress"].includes(ride.status)) {
    return res.status(400).json({ error: "ride_not_active" });
  }

  const existing = await db
    .select()
    .from(safetyAlertsTable)
    .where(
      and(
        eq(safetyAlertsTable.rideId, rideId),
        eq(safetyAlertsTable.triggeredById, userId),
        eq(safetyAlertsTable.status, "active"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return res.json({ alert: existing[0] });
  }

  const [alert] = await db
    .insert(safetyAlertsTable)
    .values({ rideId, triggeredById: userId })
    .returning();

  logger.info({ alertId: alert.id, rideId, userId }, "safety_alert_triggered");

  // Fetch triggeredBy user details to enrich the socket event.
  // If the lookup fails, fall back to null fields so the emit still fires.
  let triggeredByUser: {
    firstName: string | null;
    lastName: string | null;
    countryCode: string;
    phone: string | null;
  } | undefined;
  try {
    const rows = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        countryCode: usersTable.countryCode,
        phone: usersTable.phone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    triggeredByUser = rows[0];
  } catch (err) {
    logger.error({ err, alertId: alert.id }, "failed to fetch user for safety alert socket event");
  }

  emitToAdmins("safety:alert", {
    id: alert.id,
    rideId: alert.rideId,
    status: alert.status,
    createdAt: alert.createdAt,
    triggeredByName: triggeredByUser?.firstName ?? null,
    triggeredByLastName: triggeredByUser?.lastName ?? null,
    triggeredByCountryCode: triggeredByUser?.countryCode ?? null,
    triggeredByPhone: triggeredByUser?.phone ?? null,
  });

  return res.status(201).json({ alert });
});

/**
 * DELETE /api/rides/:id/safety-alert
 * Cancel (self-resolve) a safety alert the current user triggered.
 */
router.delete("/rides/:id/safety-alert", requireUser, async (req, res) => {
  const rideId = (req.params.id as string);
  const userId = req.userId!;

  const [alert] = await db
    .select()
    .from(safetyAlertsTable)
    .where(
      and(
        eq(safetyAlertsTable.rideId, rideId),
        eq(safetyAlertsTable.triggeredById, userId),
        eq(safetyAlertsTable.status, "active"),
      ),
    )
    .limit(1);

  if (!alert) return res.status(404).json({ error: "alert_not_found" });

  const [resolved] = await db
    .update(safetyAlertsTable)
    .set({ status: "resolved", resolvedById: null, resolvedAt: new Date() })
    .where(eq(safetyAlertsTable.id, alert.id))
    .returning();

  logger.info({ alertId: alert.id, rideId, userId }, "safety_alert_cancelled");

  return res.json({ alert: resolved });
});

/**
 * GET /api/safety-alerts
 * Admin-only. Returns all safety alerts (active + resolved) with pagination
 * and optional status filter. Includes triggeredBy user and resolvedBy admin info.
 */
router.get("/safety-alerts", requireAdmin, async (req, res) => {
  const status = req.query.status as string | undefined;
  const sort = req.query.sort === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = (page - 1) * limit;

  const triggeredBy = usersTable;
  const resolvedByAdmin = adminsTable;

  const conditions = [];
  if (status === "active" || status === "resolved") {
    conditions.push(eq(safetyAlertsTable.status, status));
  }

  const orderFn = sort === "asc" ? asc : desc;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(safetyAlertsTable)
    .where(whereClause);

  const alerts = await db
    .select({
      id: safetyAlertsTable.id,
      rideId: safetyAlertsTable.rideId,
      status: safetyAlertsTable.status,
      createdAt: safetyAlertsTable.createdAt,
      resolvedAt: safetyAlertsTable.resolvedAt,
      triggeredByName: triggeredBy.firstName,
      triggeredByLastName: triggeredBy.lastName,
      triggeredByCountryCode: triggeredBy.countryCode,
      triggeredByPhone: triggeredBy.phone,
      resolvedByName: resolvedByAdmin.name,
    })
    .from(safetyAlertsTable)
    .leftJoin(triggeredBy, eq(triggeredBy.id, safetyAlertsTable.triggeredById))
    .leftJoin(resolvedByAdmin, eq(resolvedByAdmin.id, safetyAlertsTable.resolvedById))
    .where(whereClause)
    .orderBy(orderFn(safetyAlertsTable.createdAt))
    .limit(limit)
    .offset(offset);

  return res.json({ alerts, page, limit, total });
});

/**
 * GET /api/safety-alerts/active
 * Admin-only. Returns all unresolved safety alerts with trip and user info.
 */
router.get("/safety-alerts/active", requireAdmin, async (req, res) => {
  const triggeredBy = usersTable;

  const alerts = await db
    .select({
      id: safetyAlertsTable.id,
      rideId: safetyAlertsTable.rideId,
      status: safetyAlertsTable.status,
      createdAt: safetyAlertsTable.createdAt,
      triggeredByName: triggeredBy.firstName,
      triggeredByLastName: triggeredBy.lastName,
      triggeredByCountryCode: triggeredBy.countryCode,
      triggeredByPhone: triggeredBy.phone,
    })
    .from(safetyAlertsTable)
    .leftJoin(triggeredBy, eq(triggeredBy.id, safetyAlertsTable.triggeredById))
    .where(eq(safetyAlertsTable.status, "active"))
    .orderBy(desc(safetyAlertsTable.createdAt));

  return res.json({ alerts });
});

/**
 * PATCH /api/safety-alerts/:id/resolve
 * Admin-only. Marks a safety alert as resolved.
 */
router.patch("/safety-alerts/:id/resolve", requireAdmin, async (req, res) => {
  const alertId = (req.params.id as string);

  const [alert] = await db
    .select()
    .from(safetyAlertsTable)
    .where(eq(safetyAlertsTable.id, alertId))
    .limit(1);

  if (!alert) return res.status(404).json({ error: "alert_not_found" });
  if (alert.status === "resolved")
    return res.status(400).json({ error: "already_resolved" });

  const adminId = req.adminId;

  const [resolved] = await db
    .update(safetyAlertsTable)
    .set({
      status: "resolved",
      resolvedById: adminId ?? null,
      resolvedAt: new Date(),
    })
    .where(eq(safetyAlertsTable.id, alertId))
    .returning();

  logger.info({ alertId, adminId }, "safety_alert_resolved_by_admin");

  return res.json({ alert: resolved });
});

export default router;
