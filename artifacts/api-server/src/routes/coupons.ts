import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  couponsTable,
  couponRedemptionsTable,
  ridesTable,
  usersTable,
  vehicleTypesTable,
} from "@workspace/db";
import { requireAdmin, requireUser } from "../middlewares/auth";
import {
  computeCouponDiscount,
  loadCouponByCode,
  loadRiderCountryCode,
  validateCoupon,
} from "../lib/coupons";
import {
  computeFareBreakdown,
  loadVehicleType,
  pickVehicleType,
} from "../lib/pricing";

const router: IRouter = Router();

// ─── ADMIN CRUD ──────────────────────────────────────────────────────────────

const couponInputSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Code must be alphanumeric (with - or _)"),
  description: z.string().max(280).optional().nullable(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().positive().max(100000),
  maxDiscount: z.number().positive().max(100000).optional().nullable(),
  minTripAmount: z.number().nonnegative().max(100000).optional().nullable(),
  usageLimitTotal: z.number().int().positive().max(1_000_000).optional().nullable(),
  usageLimitPerUser: z.number().int().positive().max(1000).optional().nullable(),
  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  firstRideOnly: z.boolean().optional(),
  countryCodes: z.array(z.string().min(1).max(8)).optional().nullable(),
  vehicleTypeIds: z.array(z.string().uuid()).optional().nullable(),
  active: z.boolean().optional(),
});

router.get("/admin/coupons", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(couponsTable)
    .orderBy(desc(couponsTable.createdAt));
  return res.json({ coupons: rows });
});

router.post("/admin/coupons", requireAdmin, async (req, res) => {
  const parsed = couponInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", issues: parsed.error.flatten() });
  }
  const data = parsed.data;
  if (data.discountType === "percentage" && data.discountValue > 100) {
    return res.status(400).json({ error: "invalid_input", message: "Percentage discount cannot exceed 100" });
  }
  try {
    const [created] = await db
      .insert(couponsTable)
      .values({
        code: data.code.trim(),
        description: data.description ?? null,
        discountType: data.discountType,
        discountValue: data.discountValue,
        maxDiscount: data.maxDiscount ?? null,
        minTripAmount: data.minTripAmount ?? null,
        usageLimitTotal: data.usageLimitTotal ?? null,
        usageLimitPerUser: data.usageLimitPerUser ?? null,
        validFrom: data.validFrom ? new Date(data.validFrom) : null,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        firstRideOnly: data.firstRideOnly ?? false,
        countryCodes: data.countryCodes ?? null,
        vehicleTypeIds: data.vehicleTypeIds ?? null,
        active: data.active ?? true,
      })
      .returning();
    return res.status(201).json({ coupon: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (/unique/i.test(msg) && /code/i.test(msg)) {
      return res.status(409).json({ error: "code_taken", message: "A coupon with this code already exists." });
    }
    req.log.error({ err }, "[coupons] create failed");
    return res.status(500).json({ error: "create_failed" });
  }
});

router.patch("/admin/coupons/:id", requireAdmin, async (req, res) => {
  const parsed = couponInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", issues: parsed.error.flatten() });
  }
  const data = parsed.data;
  if (
    data.discountType === "percentage" &&
    data.discountValue != null &&
    data.discountValue > 100
  ) {
    return res.status(400).json({ error: "invalid_input", message: "Percentage discount cannot exceed 100" });
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.code !== undefined) update.code = data.code.trim();
  if (data.description !== undefined) update.description = data.description;
  if (data.discountType !== undefined) update.discountType = data.discountType;
  if (data.discountValue !== undefined) update.discountValue = data.discountValue;
  if (data.maxDiscount !== undefined) update.maxDiscount = data.maxDiscount;
  if (data.minTripAmount !== undefined) update.minTripAmount = data.minTripAmount;
  if (data.usageLimitTotal !== undefined) update.usageLimitTotal = data.usageLimitTotal;
  if (data.usageLimitPerUser !== undefined) update.usageLimitPerUser = data.usageLimitPerUser;
  if (data.validFrom !== undefined) update.validFrom = data.validFrom ? new Date(data.validFrom) : null;
  if (data.validUntil !== undefined) update.validUntil = data.validUntil ? new Date(data.validUntil) : null;
  if (data.firstRideOnly !== undefined) update.firstRideOnly = data.firstRideOnly;
  if (data.countryCodes !== undefined) update.countryCodes = data.countryCodes;
  if (data.vehicleTypeIds !== undefined) update.vehicleTypeIds = data.vehicleTypeIds;
  if (data.active !== undefined) update.active = data.active;

  try {
    const [updated] = await db
      .update(couponsTable)
      .set(update)
      .where(eq(couponsTable.id, (req.params.id as string)))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ coupon: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (/unique/i.test(msg) && /code/i.test(msg)) {
      return res.status(409).json({ error: "code_taken", message: "A coupon with this code already exists." });
    }
    req.log.error({ err, couponId: (req.params.id as string) }, "[coupons] update failed");
    return res.status(500).json({ error: "update_failed" });
  }
});

/**
 * GET /admin/coupons/:id/stats
 * Drill-in view for a single coupon: aggregate totals (redemptions count,
 * total discount given, total trip revenue the coupon was applied to) plus a
 * daily time series and the most recent redemption rows joined with rider +
 * trip info. Used by the admin coupons page detail dialog.
 */
router.get("/admin/coupons/:id/stats", requireAdmin, async (req, res) => {
  const id = (req.params.id as string);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }
  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.id, id))
    .limit(1);
  if (!coupon) return res.status(404).json({ error: "not_found" });

  const [summary] = await db
    .select({
      totalRedemptions: sql<number>`count(*)::int`,
      totalDiscount: sql<number>`coalesce(sum(${couponRedemptionsTable.discountAmount}), 0)::float8`,
      totalRevenue: sql<number>`coalesce(sum(${ridesTable.finalAmount}), 0)::float8`,
      uniqueRiders: sql<number>`count(distinct ${couponRedemptionsTable.userId})::int`,
      firstRedeemedAt: sql<string | null>`min(${couponRedemptionsTable.redeemedAt})`,
      lastRedeemedAt: sql<string | null>`max(${couponRedemptionsTable.redeemedAt})`,
    })
    .from(couponRedemptionsTable)
    .leftJoin(ridesTable, eq(ridesTable.id, couponRedemptionsTable.rideId))
    .where(eq(couponRedemptionsTable.couponId, id));

  const dailySeries = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${couponRedemptionsTable.redeemedAt}), 'YYYY-MM-DD')`,
      redemptions: sql<number>`count(*)::int`,
      discount: sql<number>`coalesce(sum(${couponRedemptionsTable.discountAmount}), 0)::float8`,
    })
    .from(couponRedemptionsTable)
    .where(
      and(
        eq(couponRedemptionsTable.couponId, id),
        sql`${couponRedemptionsTable.redeemedAt} >= now() - interval '90 days'`,
      ),
    )
    .groupBy(sql`date_trunc('day', ${couponRedemptionsTable.redeemedAt})`)
    .orderBy(sql`date_trunc('day', ${couponRedemptionsTable.redeemedAt})`);

  const recent = await db
    .select({
      id: couponRedemptionsTable.id,
      rideId: couponRedemptionsTable.rideId,
      userId: couponRedemptionsTable.userId,
      discountAmount: couponRedemptionsTable.discountAmount,
      redeemedAt: couponRedemptionsTable.redeemedAt,
      riderFirstName: usersTable.firstName,
      riderLastName: usersTable.lastName,
      riderPhone: usersTable.phone,
      pickupLabel: ridesTable.pickupLabel,
      dropoffLabel: ridesTable.dropoffLabel,
      finalAmount: ridesTable.finalAmount,
      rideStatus: ridesTable.status,
    })
    .from(couponRedemptionsTable)
    .leftJoin(usersTable, eq(usersTable.id, couponRedemptionsTable.userId))
    .leftJoin(ridesTable, eq(ridesTable.id, couponRedemptionsTable.rideId))
    .where(eq(couponRedemptionsTable.couponId, id))
    .orderBy(desc(couponRedemptionsTable.redeemedAt))
    .limit(100);

  return res.json({
    coupon,
    summary: summary ?? {
      totalRedemptions: 0,
      totalDiscount: 0,
      totalRevenue: 0,
      uniqueRiders: 0,
      firstRedeemedAt: null,
      lastRedeemedAt: null,
    },
    dailySeries,
    recent,
  });
});

/**
 * GET /admin/coupons/:id/redemptions.csv
 * Full per-redemption export for finance reconciliation. No row cap — finance
 * needs every line. Returns text/csv with a sensible filename.
 */
router.get("/admin/coupons/:id/redemptions.csv", requireAdmin, async (req, res) => {
  const id = (req.params.id as string);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }
  const [coupon] = await db
    .select({ code: couponsTable.code })
    .from(couponsTable)
    .where(eq(couponsTable.id, id))
    .limit(1);
  if (!coupon) return res.status(404).json({ error: "not_found" });

  const rows = await db
    .select({
      redeemedAt: couponRedemptionsTable.redeemedAt,
      rideId: couponRedemptionsTable.rideId,
      userId: couponRedemptionsTable.userId,
      discountAmount: couponRedemptionsTable.discountAmount,
      riderFirstName: usersTable.firstName,
      riderLastName: usersTable.lastName,
      riderPhone: usersTable.phone,
      pickupLabel: ridesTable.pickupLabel,
      dropoffLabel: ridesTable.dropoffLabel,
      finalAmount: ridesTable.finalAmount,
      rideStatus: ridesTable.status,
    })
    .from(couponRedemptionsTable)
    .leftJoin(usersTable, eq(usersTable.id, couponRedemptionsTable.userId))
    .leftJoin(ridesTable, eq(ridesTable.id, couponRedemptionsTable.rideId))
    .where(eq(couponRedemptionsTable.couponId, id))
    .orderBy(desc(couponRedemptionsTable.redeemedAt));

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v);
    // Neutralize spreadsheet formula injection: prefix any value starting with
    // =, +, -, @, tab, or CR with a single quote so Excel/Sheets treats it as
    // text. User-controlled fields (rider name, pickup labels) are exported.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = [
    "redeemed_at",
    "ride_id",
    "user_id",
    "rider_name",
    "rider_phone",
    "pickup",
    "dropoff",
    "ride_status",
    "ride_total",
    "discount_amount",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const name = `${r.riderFirstName ?? ""} ${r.riderLastName ?? ""}`.trim();
    lines.push(
      [
        r.redeemedAt,
        r.rideId,
        r.userId,
        name,
        r.riderPhone,
        r.pickupLabel,
        r.dropoffLabel,
        r.rideStatus,
        r.finalAmount,
        r.discountAmount,
      ]
        .map(escape)
        .join(","),
    );
  }
  const safeCode = coupon.code.replace(/[^A-Za-z0-9_-]/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="coupon-${safeCode}-redemptions.csv"`,
  );
  return res.send(lines.join("\n") + "\n");
});

router.delete("/admin/coupons/:id", requireAdmin, async (req, res) => {
  // Soft "delete" via inactivation when redemptions exist so historical
  // invoices keep their coupon link. Hard delete only when unused.
  const [{ value } = { value: 0 }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(couponRedemptionsTable)
    .where(eq(couponRedemptionsTable.couponId, (req.params.id as string)));
  if (Number(value) > 0) {
    const [updated] = await db
      .update(couponsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(couponsTable.id, (req.params.id as string)))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, deactivated: true });
  }
  const result = await db
    .delete(couponsTable)
    .where(eq(couponsTable.id, (req.params.id as string)))
    .returning({ id: couponsTable.id });
  if (result.length === 0) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true, deactivated: false });
});

// ─── RIDER VALIDATION ────────────────────────────────────────────────────────

/**
 * POST /coupons/validate
 * Rider-side preview: given a code + estimated trip context, returns the
 * projected discount or a typed failure code. The same checks run inside the
 * completion transaction so concurrent completions can't exceed caps.
 */
router.post("/coupons/validate", requireUser, async (req, res) => {
  const parsed = z
    .object({
      code: z.string().min(1).max(40),
      vehicleTypeId: z.string().uuid().optional().nullable(),
      vehicleClass: z.string().max(40).optional().nullable(),
      estimatedDistanceKm: z.number().positive().max(10000).optional(),
      estimatedDurationMin: z.number().int().positive().max(10000).optional(),
      estimatedSubtotal: z.number().nonnegative().max(1_000_000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const coupon = await loadCouponByCode(parsed.data.code);

  // Resolve a subtotal: prefer one provided by the client, otherwise compute
  // from the chosen category and route. Falls back to picking by class.
  let subtotal = parsed.data.estimatedSubtotal ?? 0;
  let vehicleTypeRow = parsed.data.vehicleTypeId
    ? await loadVehicleType(parsed.data.vehicleTypeId)
    : null;
  if (!vehicleTypeRow) {
    vehicleTypeRow = await pickVehicleType(parsed.data.vehicleClass ?? null);
  }
  if (subtotal === 0 && parsed.data.estimatedDistanceKm) {
    const breakdown = computeFareBreakdown({
      vehicleType: vehicleTypeRow,
      distanceKm: parsed.data.estimatedDistanceKm,
      durationMin: parsed.data.estimatedDurationMin ?? Math.max(6, Math.round(parsed.data.estimatedDistanceKm * 3)),
    });
    subtotal = breakdown.total;
  }

  const riderCountryCode = await loadRiderCountryCode(req.userId!);
  const result = await validateCoupon({
    coupon,
    riderId: req.userId!,
    riderCountryCode,
    vehicleTypeId: vehicleTypeRow?.id ?? parsed.data.vehicleTypeId ?? null,
    estimatedSubtotal: subtotal,
  });
  if (!result.ok) {
    return res.status(422).json({ error: result.code });
  }

  return res.json({
    couponId: result.coupon.id,
    code: result.coupon.code,
    description: result.coupon.description,
    discountType: result.coupon.discountType,
    discountValue: result.coupon.discountValue,
    maxDiscount: result.coupon.maxDiscount,
    discount: result.discount,
    estimatedSubtotal: subtotal,
  });
});

export default router;

// Re-export helpers used by other route files for the completion transaction.
export { computeCouponDiscount };
