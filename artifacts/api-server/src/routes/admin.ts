import { Router, type IRouter } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  db,
  pool,
  adminsTable,
  usersTable,
  ridesTable,
  vehiclesTable,
  vehicleTypesTable,
  serviceAreasTable,
  bidsTable,
  earningsTable,
  placesTable,
  driverStatusHistoryTable,
  driverDestinationModesTable,
  pushTicketsTable,
  rideDispatchLogsTable,
  walletTransactionsTable,
  commissionExemptionsTable,
} from "@workspace/db";
import { and, eq, desc, lt, sql, inArray, lte, gte } from "drizzle-orm";
import { signAdminToken } from "../lib/auth";
import { requireAdmin } from "../middlewares/auth";
import {
  bulkEnrichWithPlatformCurrency,
  enrichWithPlatformCurrency,
  getDisplayCurrencyCode,
} from "../lib/displayAmount";
import { enrichAmount } from "../lib/currency";
import { toPublicUser, normalizeSubmittedDocs } from "../lib/serializers";
import { emitToUser, getIo, dropLiveDriver } from "../lib/io";
import { sendPushFromTemplate, getPushServiceHealth } from "../lib/push";
import { getDriverRates, computeDriverRatesBatch } from "../lib/driverStats";
import {
  computeDriverRating,
  computeDriverRatings,
  DEFAULT_DRIVER_RATING,
} from "../lib/driverRating";

const router: IRouter = Router();

router.post("/admin/login", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [admin] = await db
    .select()
    .from(adminsTable)
    .where(eq(adminsTable.email, parsed.data.email.toLowerCase()))
    .limit(1);
  if (!admin) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  return res.json({
    token: signAdminToken(admin.id),
    admin: { id: admin.id, email: admin.email, name: admin.name },
  });
});

router.get("/admin/me", requireAdmin, async (req, res) => {
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, req.adminId!)).limit(1);
  if (!admin) return res.status(404).json({ error: "not_found" });
  return res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
});

router.get("/admin/earnings", requireAdmin, async (req, res) => {
  const rangeRaw = parseInt(String(req.query.range));
  const range = [7, 30, 90].includes(rangeRaw) ? rangeRaw : 7;

  const earningsChartRaw = await db
    .select({
      date: sql<string>`date_trunc('day', ${earningsTable.createdAt})::date::text`,
      total: sql<number>`coalesce(sum(${earningsTable.amount}), 0)::float`,
    })
    .from(earningsTable)
    .where(sql`${earningsTable.createdAt} >= now() - (${range} * interval '1 day')`)
    .groupBy(sql`date_trunc('day', ${earningsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${earningsTable.createdAt})`);

  const chartData: { date: string; totalEarnings: number; outstandingAmount: number; orgOutstandingAmount: number }[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const found = earningsChartRaw.find((r) => r.date === dateStr);
    const total = found?.total ?? 0;
    chartData.push({
      date: dateStr,
      totalEarnings: total,
      outstandingAmount: Math.round(total * 0.15 * 100) / 100,
      orgOutstandingAmount: Math.round(total * 0.05 * 100) / 100,
    });
  }

  const totalEarnings = chartData.reduce((s, r) => s + r.totalEarnings, 0);
  return res.json({
    chartData,
    summary: {
      totalEarnings,
      outstandingAmount: Math.round(totalEarnings * 0.15 * 100) / 100,
      orgOutstandingAmount: Math.round(totalEarnings * 0.05 * 100) / 100,
    },
  });
});

router.get("/admin/stats", requireAdmin, async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    [{ totalUsers }],
    [{ pendingDrivers }],
    [{ approvedDrivers }],
    [{ activeDrivers }],
    [{ inactiveDrivers }],
    [{ totalRides }],
    [{ activeRides }],
    [{ completedRides }],
    [{ cancelledRides }],
    [{ totalRevenue }],
    [{ todayInProcess }],
    [{ todayCompleted }],
    [{ todayCancelled }],
    [{ todayEarnings }],
    recentRidesRaw,
    earningsChartRaw,
    earningsTodayHourlyRaw,
    [{ available }],
    [{ wayToPickup }],
    [{ wayToDropoff }],
  ] = await Promise.all([
    db.select({ totalUsers: sql<number>`count(*)::int` }).from(usersTable),
    db.select({ pendingDrivers: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.driverStatus, "pending")),
    db.select({ approvedDrivers: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.driverStatus, "approved")),
    db.select({ activeDrivers: sql<number>`count(*)::int` }).from(usersTable).where(and(eq(usersTable.driverStatus, "approved"), eq(usersTable.driverOnline, true))),
    db.select({ inactiveDrivers: sql<number>`count(*)::int` }).from(usersTable).where(and(eq(usersTable.driverStatus, "approved"), eq(usersTable.driverOnline, false))),
    db.select({ totalRides: sql<number>`count(*)::int` }).from(ridesTable),
    db.select({ activeRides: sql<number>`count(*)::int` }).from(ridesTable).where(sql`${ridesTable.status} in ('bidding','driver_arriving','in_progress')`),
    db.select({ completedRides: sql<number>`count(*)::int` }).from(ridesTable).where(eq(ridesTable.status, "completed")),
    db.select({ cancelledRides: sql<number>`count(*)::int` }).from(ridesTable).where(eq(ridesTable.status, "cancelled")),
    db.select({ totalRevenue: sql<number>`coalesce(sum(${earningsTable.amount}), 0)::float` }).from(earningsTable),
    db.select({ todayInProcess: sql<number>`count(*)::int` }).from(ridesTable).where(and(sql`${ridesTable.status} in ('bidding','driver_arriving','in_progress')`, sql`${ridesTable.createdAt} >= ${todayStart}`)),
    db.select({ todayCompleted: sql<number>`count(*)::int` }).from(ridesTable).where(and(eq(ridesTable.status, "completed"), sql`${ridesTable.createdAt} >= ${todayStart}`)),
    db.select({ todayCancelled: sql<number>`count(*)::int` }).from(ridesTable).where(and(eq(ridesTable.status, "cancelled"), sql`${ridesTable.createdAt} >= ${todayStart}`)),
    db.select({ todayEarnings: sql<number>`coalesce(sum(${earningsTable.amount}), 0)::float` }).from(earningsTable).where(sql`${earningsTable.createdAt} >= ${todayStart}`),
    db.select({
      ride: ridesTable,
      rider: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, rating: usersTable.rating, photoUrl: usersTable.photoUrl },
    }).from(ridesTable)
      .leftJoin(usersTable, eq(usersTable.id, ridesTable.riderId))
      .orderBy(desc(ridesTable.createdAt))
      .limit(10),
    db.select({
      date: sql<string>`date_trunc('day', ${earningsTable.createdAt})::date::text`,
      total: sql<number>`coalesce(sum(${earningsTable.amount}), 0)::float`,
    }).from(earningsTable)
      .where(sql`${earningsTable.createdAt} >= now() - interval '7 days'`)
      .groupBy(sql`date_trunc('day', ${earningsTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${earningsTable.createdAt})`),
    db.select({
      hour: sql<string>`to_char(date_trunc('hour', ${earningsTable.createdAt}), 'HH24:MI')`,
      total: sql<number>`coalesce(sum(${earningsTable.amount}), 0)::float`,
    }).from(earningsTable)
      .where(sql`${earningsTable.createdAt} >= ${todayStart}`)
      .groupBy(sql`date_trunc('hour', ${earningsTable.createdAt})`)
      .orderBy(sql`date_trunc('hour', ${earningsTable.createdAt})`),
    db.select({ available: sql<number>`count(*)::int` })
      .from(usersTable)
      .leftJoin(
        ridesTable,
        and(
          eq(ridesTable.acceptedDriverId, usersTable.id),
          sql`${ridesTable.status} in ('bidding', 'driver_arriving', 'in_progress')`,
        ),
      )
      .where(
        and(
          eq(usersTable.driverStatus, "approved"),
          eq(usersTable.driverOnline, true),
          sql`${ridesTable.id} is null`,
        ),
      ),
    db.select({ wayToPickup: sql<number>`count(distinct ${usersTable.id})::int` })
      .from(usersTable)
      .innerJoin(
        ridesTable,
        and(eq(ridesTable.acceptedDriverId, usersTable.id), eq(ridesTable.status, "driver_arriving")),
      )
      .where(and(eq(usersTable.driverStatus, "approved"), eq(usersTable.driverOnline, true))),
    db.select({ wayToDropoff: sql<number>`count(distinct ${usersTable.id})::int` })
      .from(usersTable)
      .innerJoin(
        ridesTable,
        and(eq(ridesTable.acceptedDriverId, usersTable.id), eq(ridesTable.status, "in_progress")),
      )
      .where(and(eq(usersTable.driverStatus, "approved"), eq(usersTable.driverOnline, true))),
  ]);

  const totalDrivers = approvedDrivers;

  const driverIds = recentRidesRaw.map((r) => r.ride.acceptedDriverId).filter(Boolean) as string[];
  let driverMap: Record<string, { firstName: string; lastName: string; rating: string; photoUrl: string | null }> = {};
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, rating: usersTable.rating, photoUrl: usersTable.photoUrl })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  }

  const recentDisplay = await bulkEnrichWithPlatformCurrency(
    recentRidesRaw.map(({ ride }) => ride.finalAmount ?? null),
  );
  const recentRides = recentRidesRaw.map(({ ride, rider }, idx) => {
    const driver = ride.acceptedDriverId ? driverMap[ride.acceptedDriverId] : null;
    return {
      id: ride.id,
      riderName: rider ? `${rider.firstName} ${rider.lastName}`.trim() || "Rider" : "Rider",
      riderRating: rider?.rating ?? "4.9",
      riderPhoto: rider?.photoUrl ?? null,
      driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() || "Driver" : null,
      driverRating: driver?.rating ?? "4.9",
      driverPhoto: driver?.photoUrl ?? null,
      serviceType: ride.vehicleClass ?? "ride",
      status: ride.status,
      finalAmount: ride.finalAmount ?? null,
      finalAmountDisplay: recentDisplay[idx],
      createdAt: ride.createdAt.toISOString(),
    };
  });

  const last7Days: { date: string; totalEarnings: number; outstandingAmount: number; orgOutstandingAmount: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const found = earningsChartRaw.find((r) => r.date === dateStr);
    const total = found?.total ?? 0;
    last7Days.push({
      date: dateStr,
      totalEarnings: total,
      outstandingAmount: Math.round(total * 0.15 * 100) / 100,
      orgOutstandingAmount: Math.round(total * 0.05 * 100) / 100,
    });
  }

  const todayChartData = earningsTodayHourlyRaw.map((r) => ({
    date: r.hour,
    totalEarnings: r.total,
    outstandingAmount: Math.round(r.total * 0.15 * 100) / 100,
    orgOutstandingAmount: Math.round(r.total * 0.05 * 100) / 100,
  }));

  // ---- Server health metrics ----
  // Push receipt poll interval is 900 000 ms (15 min). A ticket older than
  // 2× the interval (30 min) indicates the poller has missed it — treat as
  // a stalled job / high-queue-depth alert.
  const PUSH_POLL_INTERVAL_MS = 15 * 60 * 1000;
  const STALLED_TICKET_MS = 2 * PUSH_POLL_INTERVAL_MS;
  const stalledCutoff = new Date(Date.now() - STALLED_TICKET_MS);

  const [dbHealthy, [{ stalledTicketCount }]] = await Promise.all([
    pool.query("SELECT 1").then(() => true).catch(() => false),
    db
      .select({ stalledTicketCount: sql<number>`count(*)::int` })
      .from(pushTicketsTable)
      .where(lt(pushTicketsTable.createdAt, stalledCutoff)),
  ]);

  let socketHealthy = false;
  try {
    getIo();
    socketHealthy = true;
  } catch {
    socketHealthy = false;
  }

  // Push service is healthy if it has completed at least one poll in the last
  // 3× poll intervals (45 min), or hasn't polled yet (server just started).
  const { lastPollAt, receiptErrorCount } = getPushServiceHealth();
  const PUSH_HEALTHY_WINDOW_MS = 3 * PUSH_POLL_INTERVAL_MS;
  const pushHealthy =
    lastPollAt === null || Date.now() - lastPollAt.getTime() < PUSH_HEALTHY_WINDOW_MS;

  const healthySubsystems = [dbHealthy, socketHealthy, pushHealthy].filter(Boolean).length;

  return res.json({
    totalUsers,
    pendingDrivers,
    approvedDrivers,
    totalDrivers,
    activeDrivers,
    inactiveDrivers,
    totalRides,
    activeRides,
    completedRides,
    cancelledRides,
    totalRevenue,
    driverStatusCounts: {
      available,
      notAvailable: inactiveDrivers,
      wayToPickup,
      arrivedPickup: 0,
      wayToDropoff,
    },
    tripStats: {
      today: { inProcess: todayInProcess, completed: todayCompleted, cancelled: todayCancelled },
      total: { inProcess: activeRides, completed: completedRides, cancelled: cancelledRides },
    },
    earnings: {
      today: {
        totalEarnings: todayEarnings,
        outstandingAmount: Math.round(todayEarnings * 0.15 * 100) / 100,
        orgOutstandingAmount: Math.round(todayEarnings * 0.05 * 100) / 100,
      },
      total: {
        totalEarnings: totalRevenue,
        outstandingAmount: Math.round(totalRevenue * 0.15 * 100) / 100,
        orgOutstandingAmount: Math.round(totalRevenue * 0.05 * 100) / 100,
      },
      chartData: last7Days,
      todayChartData,
    },
    serverStats: {
      working: healthySubsystems,
      errors: receiptErrorCount,
      alerts: stalledTicketCount,
      lastUpdated: new Date().toISOString(),
    },
    recentRides,
  });
});

router.get("/admin/users", requireAdmin, async (_req, res) => {
  const list = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(200);
  const balances = await bulkEnrichWithPlatformCurrency(
    list.map((u) => parseFloat(u.walletBalance ?? "0")),
  );
  return res.json({
    users: list.map(toPublicUser).map((u, i) => ({
      ...u,
      createdAt: list[i].createdAt.toISOString(),
      walletBalanceDisplay: balances[i],
    })),
  });
});

router.get("/admin/drivers", requireAdmin, async (req, res) => {
  const status = z
    .enum(["all", "pending", "approved", "rejected", "suspended"])
    .catch("all")
    .parse(req.query.status);
  const baseQuery = db
    .select({
      user: usersTable,
      vehicle: vehiclesTable,
      vehicleTypeName: vehicleTypesTable.name,
      zoneName: serviceAreasTable.name,
    })
    .from(usersTable)
    .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
    .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
    .leftJoin(serviceAreasTable, eq(serviceAreasTable.id, vehiclesTable.zoneId));
  const rows =
    status === "all"
      ? await baseQuery
          .where(sql`${usersTable.driverStatus} <> 'not_applied'`)
          .orderBy(desc(usersTable.createdAt))
      : await baseQuery
          .where(eq(usersTable.driverStatus, status))
          .orderBy(desc(usersTable.createdAt));

  // Ratings are a secondary enrichment on top of the drivers list. If the
  // aggregation query fails for any reason we still want admins to see and
  // manage drivers, so fall back to each driver's stored rating instead of
  // failing the whole request. We surface a `ratingsDegraded` flag so the
  // UI can show a clear notice that the displayed rating is a stored
  // fallback instead of the freshly computed value.
  let ratingMap: Map<string, number>;
  let ratingsDegraded = false;
  try {
    ratingMap = await computeDriverRatings(
      rows.map(({ user }) => ({ id: user.id, rating: user.rating })),
    );
  } catch (err) {
    req.log.error({ err }, "computeDriverRatings failed; falling back to stored ratings");
    ratingsDegraded = true;
    ratingMap = new Map();
    for (const { user } of rows) {
      const stored = user.rating ? parseFloat(user.rating) : NaN;
      ratingMap.set(user.id, Number.isFinite(stored) ? stored : DEFAULT_DRIVER_RATING);
    }
  }

  // Acceptance & cancellation rates are a secondary enrichment, just like
  // ratings. If the batch query fails we still return the drivers list with
  // null rates so the table renders "—" instead of failing the whole
  // request, and we surface a `ratesDegraded` flag for the UI.
  let ratesMap: Awaited<ReturnType<typeof computeDriverRatesBatch>>;
  let ratesDegraded = false;
  try {
    ratesMap = await computeDriverRatesBatch(rows.map(({ user }) => user.id));
  } catch (err) {
    req.log.error({ err }, "computeDriverRatesBatch failed; rates omitted");
    ratesDegraded = true;
    ratesMap = new Map();
  }

  // Pre-convert every driver's wallet balance into the platform display
  // currency in a single batch so the admin drivers table can render
  // the server's display envelope directly (no client-side FX math).
  const walletDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map(({ user }) => parseFloat(user.walletBalance ?? "0")),
  );

  return res.json({
    ratingsDegraded,
    ratesDegraded,
    drivers: rows.map(({ user, vehicle, vehicleTypeName, zoneName }, i) => ({
      ...toPublicUser(user),
      rating: ratingMap.get(user.id) ?? DEFAULT_DRIVER_RATING,
      acceptanceRate: ratesMap.get(user.id)?.acceptanceRate ?? null,
      cancellationRate: ratesMap.get(user.id)?.cancellationRate ?? null,
      acceptanceSampleSize: ratesMap.get(user.id)?.dispatchedCount ?? 0,
      cancellationSampleSize: ratesMap.get(user.id)?.acceptedRidesCount ?? 0,
      createdAt: user.createdAt.toISOString(),
      walletBalanceDisplay: walletDisplays[i],
      vehicle: vehicle
        ? {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            color: vehicle.color,
            plate: vehicle.plate,
            vehicleTypeName: vehicleTypeName ?? null,
            zoneName: zoneName ?? null,
          }
        : null,
    })),
  });
});

router.get("/admin/users/:userId/places", requireAdmin, async (req, res) => {
  const rows = await db
    .select()
    .from(placesTable)
    .where(eq(placesTable.userId, (req.params.userId as string)))
    .orderBy(desc(placesTable.lastUsedAt))
    .limit(50);
  const serialize = (p: typeof placesTable.$inferSelect) => ({
    id: p.id,
    label: p.label,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    lastUsedAt: p.lastUsedAt.toISOString(),
  });
  return res.json({
    saved: rows.filter((r) => r.kind === "saved").map(serialize),
    recent: rows.filter((r) => r.kind === "recent").slice(0, 10).map(serialize),
  });
});

router.get("/admin/drivers/:userId", requireAdmin, async (req, res) => {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  const rows = await db
    .select({ vehicle: vehiclesTable, vehicleType: vehicleTypesTable })
    .from(vehiclesTable)
    .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
    .where(eq(vehiclesTable.userId, u.id))
    .limit(1);
  const row = rows[0] ?? null;
  const v = row?.vehicle ?? null;
  const vt = row?.vehicleType ?? null;

  const now = new Date();
  const [activeExemption] = await db
    .select({
      id: commissionExemptionsTable.id,
      startsAt: commissionExemptionsTable.startsAt,
      expiresAt: commissionExemptionsTable.expiresAt,
      grantedByAdminId: commissionExemptionsTable.grantedByAdminId,
      adminName: adminsTable.name,
    })
    .from(commissionExemptionsTable)
    .leftJoin(adminsTable, eq(adminsTable.id, commissionExemptionsTable.grantedByAdminId))
    .where(
      and(
        eq(commissionExemptionsTable.driverId, u.id),
        lte(commissionExemptionsTable.startsAt, now),
        gte(commissionExemptionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  const computedRating = await computeDriverRating(u.id, u.rating);
  const rates = await getDriverRates(u.id);

  const dmDisabled =
    u.destinationModeDisabledUntil &&
    u.destinationModeDisabledUntil.getTime() > Date.now()
      ? {
          disabledUntil: u.destinationModeDisabledUntil.toISOString(),
          disabledReason: u.destinationModeDisabledReason ?? null,
        }
      : null;

  return res.json({
    driver: {
      ...toPublicUser(u),
      rating: computedRating,
      acceptanceRate: rates.acceptanceRate,
      cancellationRate: rates.cancellationRate,
      acceptanceSampleSize: rates.dispatchedCount,
      acceptanceBidCount: rates.bidCount,
      cancellationSampleSize: rates.acceptedRidesCount,
      cancellationDriverCount: rates.cancelledByDriverCount,
      createdAt: u.createdAt.toISOString(),
      submittedDocuments: normalizeSubmittedDocs(u.submittedDocs),
      walletBalance: u.walletBalance ?? "0",
      walletBalanceDisplay: await enrichWithPlatformCurrency(parseFloat(u.walletBalance ?? "0")),
      destinationModeDisabled: dmDisabled,
      activeCommissionExemption: activeExemption
        ? {
            id: activeExemption.id,
            startsAt: activeExemption.startsAt.toISOString(),
            expiresAt: activeExemption.expiresAt.toISOString(),
            grantedByAdminName: activeExemption.adminName ?? null,
          }
        : null,
      vehicle: v
        ? {
            make: v.make,
            model: v.model,
            year: v.year,
            color: v.color,
            plate: v.plate,
            vehicleTypeId: v.vehicleTypeId ?? null,
            zoneId: v.zoneId ?? null,
            vehicleTypeName: vt?.name ?? null,
          }
        : null,
    },
  });
});

const adminDriverPatch = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  lastName: z.string().trim().max(40).optional(),
  driverStatus: z.enum(["not_applied", "pending", "approved", "rejected", "suspended"]).optional(),
  vehicleTypeId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  submittedDocs: z
    .array(
      z.object({
        type: z.string().trim().min(1).max(60),
        url: z.string().max(1000),
        contentType: z.string().max(100).optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        rejectionReason: z.string().trim().max(200).optional(),
      }),
    )
    .max(20)
    .optional(),
  vehicle: z
    .object({
      make: z.string().trim().min(1).max(40),
      model: z.string().trim().min(1).max(40),
      year: z.string().trim().min(2).max(6),
      color: z.string().trim().min(1).max(20),
      plate: z.string().trim().min(1).max(12),
    })
    .optional(),
});

router.patch("/admin/drivers/:userId", requireAdmin, async (req, res) => {
  const parsed = adminDriverPatch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { vehicle, vehicleTypeId, zoneId, submittedDocs, ...userPatch } = parsed.data;
  const [u] = await db
    .update(usersTable)
    .set({
      ...userPatch,
      ...(submittedDocs !== undefined ? { submittedDocs } : {}),
      ...(userPatch.driverStatus === "approved" ? { driverRejectionReason: null } : {}),
    })
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  if (!u) return res.status(404).json({ error: "not_found" });

  const hasCorePatch = !!vehicle;
  const hasCategoryPatch = vehicleTypeId !== undefined || zoneId !== undefined;

  if (hasCorePatch || hasCategoryPatch) {
    const existing = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.userId, u.id));

    const categoryFields = {
      ...(vehicleTypeId !== undefined ? { vehicleTypeId } : {}),
      ...(zoneId !== undefined ? { zoneId } : {}),
    };

    if (existing.length === 0) {
      if (hasCorePatch) {
        await db.insert(vehiclesTable).values({ userId: u.id, ...vehicle, ...categoryFields });
      } else if (vehicleTypeId !== null || zoneId !== null) {
        return res.status(422).json({
          error: "no_vehicle",
          message:
            "Please fill in the vehicle details (make, model, year, color, plate) before assigning a category or zone.",
        });
      }
    } else {
      const patch = { ...(vehicle ?? {}), ...categoryFields };
      await db.update(vehiclesTable).set(patch).where(eq(vehiclesTable.userId, u.id));
    }
  }
  return res.json({ user: toPublicUser(u) });
});

const docStatusBody = z.object({
  status: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().trim().max(200).optional(),
});

router.patch("/admin/drivers/:userId/documents/:docType", requireAdmin, async (req, res) => {
  const parsed = docStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });

  const docs = normalizeSubmittedDocs(u.submittedDocs);
  const docIndex = docs.findIndex((d) => d.type === (req.params.docType as string));
  if (docIndex === -1) return res.status(404).json({ error: "doc_not_found" });

  const { status, rejectionReason } = parsed.data;
  docs[docIndex] = {
    ...docs[docIndex],
    status,
    ...(rejectionReason ? { rejectionReason } : { rejectionReason: undefined }),
  };

  const [updated] = await db
    .update(usersTable)
    .set({ submittedDocs: docs })
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();

  return res.json({ submittedDocuments: normalizeSubmittedDocs(updated.submittedDocs) });
});

router.post("/admin/drivers/:userId/approve", requireAdmin, async (req, res) => {
  const u = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        driverStatus: usersTable.driverStatus,
        rating: usersTable.rating,
      })
      .from(usersTable)
      .where(eq(usersTable.id, (req.params.userId as string)))
      .limit(1);
    // When approving a pending driver for the first time, initialise the
    // stored rating to the default of 5.0 so they start with a clean slate
    // until they have rider feedback of their own. Re-approving a previously
    // rejected or suspended driver preserves whatever rating they had built
    // up before.
    const shouldInitRating =
      !!existing && existing.driverStatus === "pending";
    const [updated] = await tx
      .update(usersTable)
      .set({
        driverStatus: "approved",
        driverRejectionReason: null,
        ...(shouldInitRating
          ? { rating: DEFAULT_DRIVER_RATING.toFixed(1) }
          : {}),
      })
      .where(eq(usersTable.id, (req.params.userId as string)))
      .returning();
    if (!updated) return null;
    await tx.insert(driverStatusHistoryTable).values({
      driverId: updated.id,
      status: "approved",
      reason: null,
      changedByAdminId: req.adminId ?? null,
    });
    return updated;
  });
  if (!u) return res.status(404).json({ error: "not_found" });

  emitToUser(u.id, "user:status_changed", { driverStatus: "approved" });

  sendPushFromTemplate(
    u.id,
    "driver_approved",
    "Account Approved",
    "Your driver account has been approved. You can now go online and start accepting rides!",
    undefined,
    undefined,
    undefined,
    "driverApp",
  ).catch(() => {});

  return res.json({ user: toPublicUser(u) });
});

const rejectDriverBody = z.object({
  reason: z.string().trim().max(500).optional(),
});

router.post("/admin/drivers/:userId/reject", requireAdmin, async (req, res) => {
  const parsed = rejectDriverBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  const { reason } = parsed.data;

  const u = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(usersTable)
      .set({ driverStatus: "rejected", driverOnline: false, driverRejectionReason: reason ?? null })
      .where(eq(usersTable.id, (req.params.userId as string)))
      .returning();
    if (!updated) return null;
    await tx.insert(driverStatusHistoryTable).values({
      driverId: updated.id,
      status: "rejected",
      reason: reason ?? null,
      changedByAdminId: req.adminId ?? null,
    });
    return updated;
  });
  if (!u) return res.status(404).json({ error: "not_found" });

  emitToUser(u.id, "user:status_changed", { driverStatus: "rejected" });

  sendPushFromTemplate(
    u.id,
    "driver_rejected",
    "Application Rejected",
    "Your driver application has been rejected. Please re-upload your documents to try again.",
    { reason: reason ? ` Reason: ${reason}.` : "" },
    { type: "driver_rejected" },
    undefined,
    "driverApp",
  ).catch(() => {});

  return res.json({ user: toPublicUser(u) });
});

const suspendDriverBody = z.object({
  reason: z.string().trim().max(500).optional(),
});

router.post("/admin/drivers/:userId/suspend", requireAdmin, async (req, res) => {
  const parsed = suspendDriverBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  const { reason } = parsed.data;

  const u = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(usersTable)
      .set({ driverStatus: "suspended", driverOnline: false, driverSuspensionReason: reason ?? null })
      .where(eq(usersTable.id, (req.params.userId as string)))
      .returning();
    if (!updated) return null;
    await tx.insert(driverStatusHistoryTable).values({
      driverId: updated.id,
      status: "suspended",
      reason: reason ?? null,
      changedByAdminId: req.adminId ?? null,
    });
    return updated;
  });
  if (!u) return res.status(404).json({ error: "not_found" });

  emitToUser(u.id, "user:status_changed", { driverStatus: "suspended" });

  sendPushFromTemplate(
    u.id,
    "driver_suspended",
    "Account Suspended",
    "Your driver account has been suspended.{{reason}}",
    { reason: reason ? ` Reason: ${reason}.` : "" },
    { type: "driver_suspended" },
    undefined,
    "driverApp",
  ).catch(() => {});

  return res.json({ user: toPublicUser(u) });
});

router.post("/admin/drivers/:userId/force-offline", requireAdmin, async (req, res) => {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (!u.driverOnline) return res.status(409).json({ error: "already_offline" });

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(usersTable)
      .set({ driverOnline: false })
      .where(eq(usersTable.id, u.id))
      .returning();
    await tx.insert(driverStatusHistoryTable).values({
      driverId: u.id,
      status: u.driverStatus ?? "approved",
      action: "force_offline",
      changedByAdminId: req.adminId ?? null,
    });
    return rows;
  });

  dropLiveDriver(u.id);
  emitToUser(u.id, "admin:force_offline", {});

  return res.json({ user: toPublicUser(updated) });
});

router.post("/admin/drivers/:userId/switch-to-rider", requireAdmin, async (req, res) => {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (u.appMode !== "driver") return res.status(409).json({ error: "already_rider" });

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(usersTable)
      .set({ appMode: "rider", driverOnline: false })
      .where(eq(usersTable.id, u.id))
      .returning();
    await tx.insert(driverStatusHistoryTable).values({
      driverId: u.id,
      status: u.driverStatus ?? "approved",
      action: "switch_to_rider",
      changedByAdminId: req.adminId ?? null,
    });
    return rows;
  });

  dropLiveDriver(u.id);
  emitToUser(u.id, "admin:switch_to_rider", {});

  return res.json({ user: toPublicUser(updated) });
});

router.get(
  "/admin/drivers/:userId/destination-mode-stats",
  requireAdmin,
  async (req, res) => {
    const driverId = req.params.userId as string;
    const [u] = await db
      .select({
        id: usersTable.id,
        disabledUntil: usersTable.destinationModeDisabledUntil,
        disabledReason: usersTable.destinationModeDisabledReason,
      })
      .from(usersTable)
      .where(eq(usersTable.id, driverId))
      .limit(1);
    if (!u) return res.status(404).json({ error: "not_found" });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

    async function bucketCounts(since: Date) {
      const rows = await db
        .select({
          total: sql<number>`count(*)::int`,
          matched: sql<number>`count(${driverDestinationModesTable.completedTripId})::int`,
        })
        .from(driverDestinationModesTable)
        .where(
          and(
            eq(driverDestinationModesTable.driverId, driverId),
            gte(driverDestinationModesTable.createdAt, since),
          ),
        );
      const r = rows[0] ?? { total: 0, matched: 0 };
      return { total: r.total ?? 0, matched: r.matched ?? 0 };
    }

    const [last7d, last30d] = await Promise.all([
      bucketCounts(sevenDaysAgo),
      bucketCounts(thirtyDaysAgo),
    ]);

    const matchRate7d =
      last7d.total > 0 ? (last7d.matched / last7d.total) * 100 : null;
    const matchRate30d =
      last30d.total > 0 ? (last30d.matched / last30d.total) * 100 : null;

    const dmDisabled =
      u.disabledUntil && u.disabledUntil.getTime() > Date.now()
        ? {
            disabledUntil: u.disabledUntil.toISOString(),
            disabledReason: u.disabledReason ?? null,
          }
        : null;

    return res.json({
      last7d: { ...last7d, matchRatePct: matchRate7d },
      last30d: { ...last30d, matchRatePct: matchRate30d },
      destinationModeDisabled: dmDisabled,
    });
  },
);

const adminDisableDestinationModeBody = z.object({
  durationDays: z.number().int().min(1).max(365),
  reason: z.string().trim().max(200).optional(),
});

router.post(
  "/admin/drivers/:userId/destination-mode/disable",
  requireAdmin,
  async (req, res) => {
    const parsed = adminDisableDestinationModeBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "invalid_input" });
    const driverId = req.params.userId as string;
    const until = new Date(
      Date.now() + parsed.data.durationDays * 24 * 60 * 60_000,
    );
    const [updated] = await db
      .update(usersTable)
      .set({
        destinationModeDisabledUntil: until,
        destinationModeDisabledReason: parsed.data.reason ?? null,
      })
      .where(eq(usersTable.id, driverId))
      .returning({ id: usersTable.id });
    if (!updated) return res.status(404).json({ error: "not_found" });

    // Also deactivate any currently-active destination mode row so the
    // restriction takes effect immediately.
    await db
      .update(driverDestinationModesTable)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedReason: "admin_disabled",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(driverDestinationModesTable.driverId, driverId),
          eq(driverDestinationModesTable.isActive, true),
        ),
      );

    return res.json({
      destinationModeDisabled: {
        disabledUntil: until.toISOString(),
        disabledReason: parsed.data.reason ?? null,
      },
    });
  },
);

router.delete(
  "/admin/drivers/:userId/destination-mode/disable",
  requireAdmin,
  async (req, res) => {
    const driverId = req.params.userId as string;
    const [updated] = await db
      .update(usersTable)
      .set({
        destinationModeDisabledUntil: null,
        destinationModeDisabledReason: null,
      })
      .where(eq(usersTable.id, driverId))
      .returning({ id: usersTable.id });
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ destinationModeDisabled: null });
  },
);

router.get("/admin/drivers/:userId/status-history", requireAdmin, async (req, res) => {
  const rows = await db
    .select({
      id: driverStatusHistoryTable.id,
      status: driverStatusHistoryTable.status,
      action: driverStatusHistoryTable.action,
      reason: driverStatusHistoryTable.reason,
      createdAt: driverStatusHistoryTable.createdAt,
      adminName: adminsTable.name,
    })
    .from(driverStatusHistoryTable)
    .leftJoin(adminsTable, eq(adminsTable.id, driverStatusHistoryTable.changedByAdminId))
    .where(eq(driverStatusHistoryTable.driverId, (req.params.userId as string)))
    .orderBy(desc(driverStatusHistoryTable.createdAt));

  return res.json({
    history: rows.map((r) => ({
      id: r.id,
      status: r.status,
      action: r.action ?? null,
      reason: r.reason ?? null,
      adminName: r.adminName ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

router.get("/admin/users/:userId", requireAdmin, async (req, res) => {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  const walletBalanceDisplay = await enrichWithPlatformCurrency(
    parseFloat(u.walletBalance ?? "0"),
  );
  return res.json({
    user: {
      ...toPublicUser(u),
      createdAt: u.createdAt.toISOString(),
      walletBalanceDisplay,
    },
  });
});

const adminUserPatch = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  lastName: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(120).nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(60).nullable().optional(),
  photoUrl: z.string().trim().url().max(500).nullable().optional(),
  phoneVerified: z.boolean().optional(),
  phone: z.string().trim().min(5).max(20).optional(),
  password: z.string().min(1).max(128).nullable().optional(),
});

router.patch("/admin/users/:userId", requireAdmin, async (req, res) => {
  const parsed = adminUserPatch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  const [u] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  if (!u) return res.status(404).json({ error: "not_found" });
  return res.json({ user: { ...toPublicUser(u), createdAt: u.createdAt.toISOString() } });
});

router.post("/admin/users/:userId/ban", requireAdmin, async (req, res) => {
  const [u] = await db
    .update(usersTable)
    .set({ isActive: false })
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  if (!u) return res.status(404).json({ error: "not_found" });
  return res.json({ user: toPublicUser(u) });
});

router.post("/admin/users/:userId/activate", requireAdmin, async (req, res) => {
  const [u] = await db
    .update(usersTable)
    .set({ isActive: true })
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  if (!u) return res.status(404).json({ error: "not_found" });
  return res.json({ user: toPublicUser(u) });
});

const creditBody = z.object({ amount: z.number().positive().max(100000) });

router.post("/admin/users/:userId/credit", requireAdmin, async (req, res) => {
  const parsed = creditBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, (req.params.userId as string))).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  const newBalance = (parseFloat(u.walletBalance ?? "0") + parsed.data.amount).toFixed(2);
  const [updated] = await db
    .update(usersTable)
    .set({ walletBalance: newBalance })
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  return res.json({ user: toPublicUser(updated) });
});

router.delete("/admin/users/:userId", requireAdmin, async (req, res) => {
  const [u] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, (req.params.userId as string)))
    .returning();
  if (!u) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true });
});

const adminCreateDriver = z.object({
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(
      z
        .string()
        .min(10, "phone_too_short")
        .max(15, "phone_too_long")
        .transform((digits) => (digits.length === 10 ? `+1${digits}` : `+${digits}`)),
    ),
  countryCode: z.string().trim().min(1).max(5).optional(),
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().max(40).optional().default(""),
  approve: z.boolean().optional().default(true),
  vehicleTypeId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  vehicle: z
    .object({
      make: z.string().trim().min(1).max(40),
      model: z.string().trim().min(1).max(40),
      year: z.string().trim().min(2).max(6),
      color: z.string().trim().min(1).max(20),
      plate: z.string().trim().min(1).max(12),
    })
    .optional(),
});

router.post("/admin/drivers", requireAdmin, async (req, res) => {
  const parsed = adminCreateDriver.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { phone, firstName, lastName, approve, vehicle, countryCode, vehicleTypeId, zoneId } = parsed.data;

  if ((vehicleTypeId || zoneId) && !vehicle) {
    return res.status(422).json({
      error: "no_vehicle",
      message:
        "Please fill in the vehicle details (make, model, year, color, plate) before assigning a category or zone.",
    });
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) return res.status(409).json({ error: "phone_in_use" });

  // Use caller-provided country code, otherwise default to +1.
  // (Display-only; mobile uses full E.164 from `phone`.)
  const finalCountryCode = countryCode?.trim() || "+1";

  const driverStatus = approve ? "approved" : "pending";
  const [u] = await db
    .insert(usersTable)
    .values({
      phone,
      countryCode: finalCountryCode,
      firstName,
      lastName,
      appMode: "driver",
      driverStatus,
    })
    .returning();
  if (vehicle) {
    await db.insert(vehiclesTable).values({
      userId: u.id,
      ...vehicle,
      ...(vehicleTypeId !== undefined ? { vehicleTypeId } : {}),
      ...(zoneId !== undefined ? { zoneId } : {}),
    });
  }
  return res.status(201).json({ user: toPublicUser(u) });
});

router.get("/admin/rides", requireAdmin, async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(100);
  const ridesDisplay = await bulkEnrichWithPlatformCurrency(rides.map((r) => r.finalAmount ?? null));
  const riderIds = [...new Set(rides.map((r) => r.riderId))];
  const driverIds = [...new Set(rides.map((r) => r.acceptedDriverId).filter((x): x is string => !!x))];
  const allIds = [...new Set([...riderIds, ...driverIds])];
  const usersList = allIds.length
    ? await db.select().from(usersTable).where(sql`${usersTable.id} in ${allIds}`)
    : [];
  const userMap = new Map(usersList.map((u) => [u.id, u]));
  const bidCounts = await db
    .select({ rideId: bidsTable.rideId, count: sql<number>`count(*)::int` })
    .from(bidsTable)
    .groupBy(bidsTable.rideId);
  const bidMap = new Map(bidCounts.map((b) => [b.rideId, b.count]));

  return res.json({
    rides: rides.map((r, idx) => ({
      id: r.id,
      status: r.status,
      pickup: r.pickupAddress,
      dropoff: r.dropoffAddress,
      distanceKm: r.estimatedDistanceKm,
      finalAmount: r.finalAmount,
      finalAmountDisplay: ridesDisplay[idx],
      ratingScore: r.ratingScore,
      createdAt: r.createdAt.toISOString(),
      bidCount: bidMap.get(r.id) ?? 0,
      rider: userMap.get(r.riderId)
        ? {
            id: r.riderId,
            name: userMap.get(r.riderId)!.firstName,
            phone: userMap.get(r.riderId)!.phone,
          }
        : null,
      driver: r.acceptedDriverId && userMap.get(r.acceptedDriverId)
        ? {
            id: r.acceptedDriverId,
            name: userMap.get(r.acceptedDriverId)!.firstName,
            phone: userMap.get(r.acceptedDriverId)!.phone,
          }
        : null,
    })),
  });
});

router.get("/admin/rides/:id/dispatch-log", requireAdmin, async (req, res) => {
  const rideId = (req.params.id as string);
  const logs = await db
    .select({
      id: rideDispatchLogsTable.id,
      driverId: rideDispatchLogsTable.driverId,
      method: rideDispatchLogsTable.method,
      status: rideDispatchLogsTable.status,
      failureReason: rideDispatchLogsTable.failureReason,
      createdAt: rideDispatchLogsTable.createdAt,
      driverName: sql<string>`concat(${usersTable.firstName}, ' ', ${usersTable.lastName})`,
      driverPhone: usersTable.phone,
    })
    .from(rideDispatchLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, rideDispatchLogsTable.driverId))
    .where(eq(rideDispatchLogsTable.rideId, rideId))
    .orderBy(desc(rideDispatchLogsTable.createdAt));

  return res.json({ dispatchLog: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })) });
});

router.delete("/admin/seed-data", requireAdmin, async (_req, res) => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ridesTable)
    .where(eq(ridesTable.pickupAddress, "__heatmap_seed__"));

  if (Number(count) === 0) {
    return res.json({ deleted: 0, message: "No seed data found." });
  }

  await db.delete(ridesTable).where(eq(ridesTable.pickupAddress, "__heatmap_seed__"));

  return res.json({ deleted: Number(count), message: `Deleted ${count} seed ride(s).` });
});

router.get("/admin/drivers/:userId/wallet/transactions", requireAdmin, async (req, res) => {
  const [u] = await db.select({ id: usersTable.id, driverStatus: usersTable.driverStatus }).from(usersTable).where(eq(usersTable.id, (req.params.userId as string))).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (!u.driverStatus || u.driverStatus === "not_applied") return res.status(400).json({ error: "not_a_driver" });
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = 20;
  const offset = (page - 1) * limit;
  const txs = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.driverId, u.id))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit)
    .offset(offset);
  const displayCode = await getDisplayCurrencyCode();
  const txDisplay = await Promise.all(
    txs.map((t) => enrichAmount(t.amount, displayCode)),
  );
  return res.json({
    transactions: txs.map((t, i) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      amountDisplay: txDisplay[i],
      rideId: t.rideId ?? null,
      note: t.note ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    page,
    limit,
  });
});

router.post("/admin/drivers/:userId/wallet/topup", requireAdmin, async (req, res) => {
  const parsed = z.object({
    amount: z.number().positive().max(100000),
    note: z.string().trim().max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, (req.params.userId as string))).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (!u.driverStatus || u.driverStatus === "not_applied") return res.status(400).json({ error: "not_a_driver" });

  const { amount, note } = parsed.data;
  const adminId = req.adminId ?? null;
  const result = await db.transaction(async (tx) => {
    await tx.insert(walletTransactionsTable).values({
      driverId: u.id,
      type: "top_up",
      amount,
      note: note ?? null,
      createdBy: adminId,
    });
    const [updated] = await tx
      .update(usersTable)
      .set({ walletBalance: sql`(${usersTable.walletBalance}::numeric + ${amount})::text` })
      .where(eq(usersTable.id, u.id))
      .returning();
    return updated;
  });
  return res.json({
    walletBalance: result.walletBalance,
    walletBalanceDisplay: await enrichWithPlatformCurrency(parseFloat(result.walletBalance ?? "0")),
  });
});

router.post("/admin/drivers/:userId/commission-exemption", requireAdmin, async (req, res) => {
  const parsed = z.object({
    duration: z.enum(["1m", "3m", "6m"]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [u] = await db.select({ id: usersTable.id, driverStatus: usersTable.driverStatus }).from(usersTable).where(eq(usersTable.id, (req.params.userId as string))).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (!u.driverStatus || u.driverStatus === "not_applied") return res.status(400).json({ error: "not_a_driver" });

  const months = parsed.data.duration === "1m" ? 1 : parsed.data.duration === "3m" ? 3 : 6;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  await db.delete(commissionExemptionsTable).where(
    and(
      eq(commissionExemptionsTable.driverId, u.id),
      gte(commissionExemptionsTable.expiresAt, now),
    ),
  );

  const [exemption] = await db.insert(commissionExemptionsTable).values({
    driverId: u.id,
    startsAt: now,
    expiresAt,
    grantedByAdminId: req.adminId ?? null,
  }).returning();

  const [admin] = await db.select({ name: adminsTable.name }).from(adminsTable).where(eq(adminsTable.id, req.adminId!)).limit(1);

  return res.status(201).json({
    exemption: {
      id: exemption.id,
      startsAt: exemption.startsAt.toISOString(),
      expiresAt: exemption.expiresAt.toISOString(),
      grantedByAdminName: admin?.name ?? null,
    },
  });
});

router.delete("/admin/drivers/:userId/commission-exemption", requireAdmin, async (req, res) => {
  const [u] = await db.select({ id: usersTable.id, driverStatus: usersTable.driverStatus }).from(usersTable).where(eq(usersTable.id, (req.params.userId as string))).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (!u.driverStatus || u.driverStatus === "not_applied") return res.status(400).json({ error: "not_a_driver" });

  const now = new Date();
  await db.delete(commissionExemptionsTable).where(
    and(
      eq(commissionExemptionsTable.driverId, u.id),
      gte(commissionExemptionsTable.expiresAt, now),
    ),
  );
  return res.json({ ok: true });
});

export default router;
