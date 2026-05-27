import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  usersTable,
  walletTransactionsTable,
  payoutMethodsTable,
  withdrawalRequestsTable,
  adminsTable,
  payoutsTable,
  type PayoutMethodSnapshot,
} from "@workspace/db";
import { and, eq, desc, ilike, or, sql, inArray } from "drizzle-orm";
import { requireUser, requireAdmin } from "../middlewares/auth";
import { sendPushFromTemplate } from "../lib/push";
import { sendEmailFromTemplate } from "../lib/email";
import { getConfig } from "../lib/settings";
import {
  bulkEnrichWithPlatformCurrency,
  enrichWithPlatformCurrency,
} from "../lib/displayAmount";
import {
  getStripe,
  getOrCreateConnectAccount,
  refreshConnectAccountCapabilities,
} from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const bankSchema = z.object({
  method: z.literal("bank"),
  accountName: z.string().trim().min(1).max(120),
  bankName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().min(4).max(40).optional().nullable(),
  iban: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,34}$/u, "invalid_iban")
    .optional()
    .nullable(),
});

const mobileSchema = z.object({
  method: z.literal("mobile_money"),
  accountName: z.string().trim().min(1).max(120),
  mobileProvider: z.string().trim().min(1).max(60),
  mobileNumber: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(/^[+0-9 ()-]+$/u, "invalid_phone"),
});

const payoutMethodSchema = z.discriminatedUnion("method", [
  bankSchema,
  mobileSchema,
]);

function snapshotFromMethod(
  m: typeof payoutMethodsTable.$inferSelect,
): PayoutMethodSnapshot {
  return {
    method: m.method,
    accountName: m.accountName,
    bankName: m.bankName ?? null,
    accountNumber: m.accountNumber ?? null,
    iban: m.iban ?? null,
    mobileProvider: m.mobileProvider ?? null,
    mobileNumber: m.mobileNumber ?? null,
  };
}

function serializeWithdrawal(
  w: typeof withdrawalRequestsTable.$inferSelect,
  driver?: { id: string; firstName: string; lastName: string; phone: string } | null,
  decidedByName?: string | null,
) {
  return {
    id: w.id,
    driverId: w.driverId,
    amount: w.amount,
    status: w.status,
    payoutMethod: w.payoutMethodSnapshot as PayoutMethodSnapshot,
    paymentReference: w.paymentReference ?? null,
    rejectionReason: w.rejectionReason ?? null,
    decidedByAdminId: w.decidedByAdminId ?? null,
    decidedByAdminName: decidedByName ?? null,
    requestedAt: w.requestedAt.toISOString(),
    decidedAt: w.decidedAt?.toISOString() ?? null,
    paidAt: w.paidAt?.toISOString() ?? null,
    driver: driver
      ? {
          id: driver.id,
          firstName: driver.firstName,
          lastName: driver.lastName,
          phone: driver.phone,
        }
      : null,
  };
}

// ─── DRIVER ───────────────────────────────────────────────────────────────────

router.get("/driver/me/payout-method", requireUser, async (req, res) => {
  const [m] = await db
    .select()
    .from(payoutMethodsTable)
    .where(eq(payoutMethodsTable.driverId, req.userId!))
    .limit(1);
  return res.json({ payoutMethod: m ? snapshotFromMethod(m) : null });
});

router.put("/driver/me/payout-method", requireUser, async (req, res) => {
  const parsed = payoutMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  if (parsed.data.method === "bank") {
    if (!parsed.data.accountNumber && !parsed.data.iban) {
      return res
        .status(400)
        .json({ error: "invalid_input", message: "Provide an account number or IBAN." });
    }
  }
  const values = {
    driverId: req.userId!,
    method: parsed.data.method,
    accountName: parsed.data.accountName,
    bankName: parsed.data.method === "bank" ? parsed.data.bankName : null,
    accountNumber:
      parsed.data.method === "bank" ? parsed.data.accountNumber ?? null : null,
    iban: parsed.data.method === "bank" ? parsed.data.iban ?? null : null,
    mobileProvider:
      parsed.data.method === "mobile_money"
        ? parsed.data.mobileProvider
        : null,
    mobileNumber:
      parsed.data.method === "mobile_money" ? parsed.data.mobileNumber : null,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(payoutMethodsTable)
    .values(values)
    .onConflictDoUpdate({
      target: payoutMethodsTable.driverId,
      set: { ...values },
    })
    .returning();
  return res.json({ payoutMethod: snapshotFromMethod(saved) });
});

router.get("/driver/me/withdrawals", requireUser, async (req, res) => {
  const rows = await db
    .select()
    .from(withdrawalRequestsTable)
    .where(eq(withdrawalRequestsTable.driverId, req.userId!))
    .orderBy(desc(withdrawalRequestsTable.requestedAt))
    .limit(50);
  // Pre-convert each withdrawal amount to the platform display currency so
  // the driver wallet UI renders the envelope directly (no client-side FX
  // math, no `MAD10.00` for a USD-10 stored amount).
  const amountDisplays = await bulkEnrichWithPlatformCurrency(
    rows.map((w) => Number(w.amount)),
  );
  return res.json({
    withdrawals: rows.map((w, i) => ({
      ...serializeWithdrawal(w),
      amountDisplay: amountDisplays[i],
    })),
  });
});

const createWithdrawalSchema = z.object({
  amount: z.number().positive().max(100000),
});

router.post("/driver/me/withdrawals", requireUser, async (req, res) => {
  const parsed = createWithdrawalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const amount = Math.round(parsed.data.amount * 100) / 100;

  const cfg = await getConfig();
  if (amount < cfg.minWithdrawalAmount) {
    return res.status(422).json({
      error: "below_minimum",
      message: `Minimum withdrawal amount is $${cfg.minWithdrawalAmount.toFixed(2)}.`,
      minimum: cfg.minWithdrawalAmount,
    });
  }

  const [pm] = await db
    .select()
    .from(payoutMethodsTable)
    .where(eq(payoutMethodsTable.driverId, req.userId!))
    .limit(1);
  if (!pm) {
    return res.status(422).json({
      error: "no_payout_method",
      message: "Save a payout method before requesting a withdrawal.",
    });
  }

  const [u] = await db
    .select({
      id: usersTable.id,
      driverStatus: usersTable.driverStatus,
      walletBalance: usersTable.walletBalance,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  if (!u || u.driverStatus !== "approved") {
    return res.status(403).json({ error: "not_approved" });
  }

  const balance = parseFloat(u.walletBalance ?? "0");
  if (balance < amount) {
    return res
      .status(422)
      .json({ error: "insufficient_balance", message: "Wallet balance is too low." });
  }

  // Block multiple concurrent pending/approved requests.
  const [existing] = await db
    .select({ id: withdrawalRequestsTable.id })
    .from(withdrawalRequestsTable)
    .where(
      and(
        eq(withdrawalRequestsTable.driverId, req.userId!),
        inArray(withdrawalRequestsTable.status, ["pending", "approved"]),
      ),
    )
    .limit(1);
  if (existing) {
    return res.status(409).json({
      error: "request_in_progress",
      message: "You already have a withdrawal request in progress.",
    });
  }

  const snapshot = snapshotFromMethod(pm);
  const result = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(withdrawalRequestsTable)
      .values({
        driverId: req.userId!,
        amount,
        status: "pending",
        payoutMethodSnapshot: snapshot,
      })
      .returning();
    await tx.insert(walletTransactionsTable).values({
      driverId: req.userId!,
      type: "withdrawal_request",
      amount: -amount,
      withdrawalRequestId: created.id,
      note: `Withdrawal requested`,
    });
    const [updated] = await tx
      .update(usersTable)
      .set({
        walletBalance: sql`(${usersTable.walletBalance}::numeric - ${amount})::text`,
      })
      .where(eq(usersTable.id, req.userId!))
      .returning({ walletBalance: usersTable.walletBalance });
    return { created, walletBalance: updated.walletBalance };
  });

  req.log?.info(
    { driverId: req.userId, withdrawalId: result.created.id, amount },
    "[withdrawals] driver created request",
  );

  return res.status(201).json({
    withdrawal: serializeWithdrawal(result.created),
    walletBalance: result.walletBalance,
  });
});

router.post(
  "/driver/me/withdrawals/:id/cancel",
  requireUser,
  async (req, res) => {
    const id = (req.params.id as string);
    const [w] = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(
        and(
          eq(withdrawalRequestsTable.id, id),
          eq(withdrawalRequestsTable.driverId, req.userId!),
        ),
      )
      .limit(1);
    if (!w) return res.status(404).json({ error: "not_found" });
    if (w.status !== "pending") {
      return res.status(409).json({
        error: "not_cancellable",
        message: "Only pending requests can be cancelled.",
      });
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(withdrawalRequestsTable)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(
          and(
            eq(withdrawalRequestsTable.id, id),
            eq(withdrawalRequestsTable.status, "pending"),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx.insert(walletTransactionsTable).values({
        driverId: req.userId!,
        type: "withdrawal_refund",
        amount: w.amount,
        withdrawalRequestId: id,
        note: "Withdrawal cancelled by driver",
      });
      const [u] = await tx
        .update(usersTable)
        .set({
          walletBalance: sql`(${usersTable.walletBalance}::numeric + ${w.amount})::text`,
        })
        .where(eq(usersTable.id, req.userId!))
        .returning({ walletBalance: usersTable.walletBalance });
      return { updated, walletBalance: u.walletBalance };
    });
    if (!result) {
      return res.status(409).json({ error: "not_cancellable" });
    }
    return res.json({
      withdrawal: serializeWithdrawal(result.updated),
      walletBalance: result.walletBalance,
    });
  },
);

// ─── ADMIN ────────────────────────────────────────────────────────────────────

router.get(
  "/admin/drivers/:userId/withdrawals",
  requireAdmin,
  async (req, res) => {
    const [u] = await db
      .select({ id: usersTable.id, driverStatus: usersTable.driverStatus })
      .from(usersTable)
      .where(eq(usersTable.id, (req.params.userId as string)))
      .limit(1);
    if (!u) return res.status(404).json({ error: "not_found" });
    if (!u.driverStatus || u.driverStatus === "not_applied") {
      return res.status(400).json({ error: "not_a_driver" });
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
    const limit = 20;
    const offset = (page - 1) * limit;

    const rows = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.driverId, u.id))
      .orderBy(desc(withdrawalRequestsTable.requestedAt))
      .limit(limit)
      .offset(offset);

    const adminIds = [
      ...new Set(
        rows
          .map((r) => r.decidedByAdminId)
          .filter((x): x is string => !!x),
      ),
    ];
    const admins = adminIds.length
      ? await db
          .select({ id: adminsTable.id, name: adminsTable.name })
          .from(adminsTable)
          .where(inArray(adminsTable.id, adminIds))
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, a.name]));

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.driverId, u.id));

    return res.json({
      withdrawals: rows.map((w) =>
        serializeWithdrawal(
          w,
          null,
          w.decidedByAdminId ? adminMap.get(w.decidedByAdminId) ?? null : null,
        ),
      ),
      page,
      limit,
      total,
    });
  },
);

router.get("/admin/withdrawals", requireAdmin, async (req, res) => {
  const status = z
    .enum(["pending", "approved", "paid", "rejected", "cancelled", "all"])
    .default("pending")
    .parse(req.query.status ?? "pending");
  const search = (req.query.search as string | undefined)?.trim() ?? "";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = 20;
  const offset = (page - 1) * limit;

  const conds = [];
  if (status !== "all") conds.push(eq(withdrawalRequestsTable.status, status));
  if (search) {
    const like = `%${search}%`;
    conds.push(
      or(
        ilike(usersTable.firstName, like),
        ilike(usersTable.lastName, like),
        ilike(usersTable.phone, like),
      )!,
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      w: withdrawalRequestsTable,
      driverId: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
    })
    .from(withdrawalRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, withdrawalRequestsTable.driverId))
    .where(where)
    .orderBy(desc(withdrawalRequestsTable.requestedAt))
    .limit(limit)
    .offset(offset);

  const adminIds = [
    ...new Set(rows.map((r) => r.w.decidedByAdminId).filter((x): x is string => !!x)),
  ];
  const admins = adminIds.length
    ? await db
        .select({ id: adminsTable.id, name: adminsTable.name })
        .from(adminsTable)
        .where(inArray(adminsTable.id, adminIds))
    : [];
  const adminMap = new Map(admins.map((a) => [a.id, a.name]));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(withdrawalRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, withdrawalRequestsTable.driverId))
    .where(where);

  return res.json({
    withdrawals: rows.map((r) =>
      serializeWithdrawal(
        r.w,
        r.driverId
          ? {
              id: r.driverId,
              firstName: r.firstName ?? "",
              lastName: r.lastName ?? "",
              phone: r.phone ?? "",
            }
          : null,
        r.w.decidedByAdminId ? adminMap.get(r.w.decidedByAdminId) ?? null : null,
      ),
    ),
    page,
    limit,
    total,
  });
});

router.get("/admin/withdrawals/:id", requireAdmin, async (req, res) => {
  const [row] = await db
    .select({
      w: withdrawalRequestsTable,
      driverId: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
    })
    .from(withdrawalRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, withdrawalRequestsTable.driverId))
    .where(eq(withdrawalRequestsTable.id, (req.params.id as string)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  let adminName: string | null = null;
  if (row.w.decidedByAdminId) {
    const [a] = await db
      .select({ name: adminsTable.name })
      .from(adminsTable)
      .where(eq(adminsTable.id, row.w.decidedByAdminId))
      .limit(1);
    adminName = a?.name ?? null;
  }
  return res.json({
    withdrawal: serializeWithdrawal(
      row.w,
      row.driverId
        ? {
            id: row.driverId,
            firstName: row.firstName ?? "",
            lastName: row.lastName ?? "",
            phone: row.phone ?? "",
          }
        : null,
      adminName,
    ),
  });
});

router.post(
  "/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {
    const [w] = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.id, (req.params.id as string)))
      .limit(1);
    if (!w) return res.status(404).json({ error: "not_found" });
    if (w.status !== "pending") {
      return res
        .status(409)
        .json({ error: "invalid_status", message: "Only pending requests can be approved." });
    }
    const [updated] = await db
      .update(withdrawalRequestsTable)
      .set({
        status: "approved",
        decidedByAdminId: req.adminId ?? null,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(withdrawalRequestsTable.id, w.id),
          eq(withdrawalRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!updated) return res.status(409).json({ error: "invalid_status" });

    sendPushFromTemplate(
      w.driverId,
      "withdrawal_approved",
      "Withdrawal approved",
      `Your withdrawal of $${w.amount.toFixed(2)} has been approved and is being processed.`,
      { amount: w.amount.toFixed(2) },
      { type: "withdrawal_approved", withdrawalId: w.id },
      undefined,
      "driverApp",
    ).catch(() => {});

    sendEmailFromTemplate(
      w.driverId,
      "withdrawal_approved",
      "Your Biddi withdrawal has been approved",
      `<p>Hi {{firstName}},</p><p>Your withdrawal request of <strong>$${w.amount.toFixed(2)}</strong> has been approved and is now being processed.</p><p>— The Biddi Team</p>`,
      { amount: w.amount.toFixed(2) },
    ).catch(() => {});

    return res.json({ withdrawal: serializeWithdrawal(updated) });
  },
);

const markPaidSchema = z.object({
  paymentReference: z.string().trim().min(1).max(120),
});

router.post(
  "/admin/withdrawals/:id/mark-paid",
  requireAdmin,
  async (req, res) => {
    const parsed = markPaidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

    const [w] = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.id, (req.params.id as string)))
      .limit(1);
    if (!w) return res.status(404).json({ error: "not_found" });
    if (w.status !== "approved" && w.status !== "pending") {
      return res
        .status(409)
        .json({ error: "invalid_status", message: "Only pending or approved requests can be marked paid." });
    }

    const adminId = req.adminId ?? null;
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(withdrawalRequestsTable)
        .set({
          status: "paid",
          paymentReference: parsed.data.paymentReference,
          paidAt: new Date(),
          decidedByAdminId: w.decidedByAdminId ?? adminId,
          decidedAt: w.decidedAt ?? new Date(),
        })
        .where(
          and(
            eq(withdrawalRequestsTable.id, w.id),
            inArray(withdrawalRequestsTable.status, ["pending", "approved"]),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx.insert(walletTransactionsTable).values({
        driverId: w.driverId,
        type: "withdrawal_paid",
        amount: 0,
        withdrawalRequestId: w.id,
        note: `Paid · Ref: ${parsed.data.paymentReference}`,
        createdBy: adminId,
      });
      return updated;
    });

    if (!result) return res.status(409).json({ error: "invalid_status" });

    sendPushFromTemplate(
      w.driverId,
      "withdrawal_paid",
      "Withdrawal paid",
      `$${w.amount.toFixed(2)} has been sent to your payout account.`,
      {
        amount: w.amount.toFixed(2),
        reference: ` Ref: ${parsed.data.paymentReference}.`,
      },
      { type: "withdrawal_paid", withdrawalId: w.id },
      undefined,
      "driverApp",
    ).catch(() => {});

    sendEmailFromTemplate(
      w.driverId,
      "withdrawal_paid",
      "Your Biddi withdrawal has been paid",
      `<p>Hi {{firstName}},</p><p>Your withdrawal of <strong>$${w.amount.toFixed(2)}</strong> has been sent to your payout account.</p><p>Payment reference: <strong>{{reference}}</strong></p><p>— The Biddi Team</p>`,
      {
        amount: w.amount.toFixed(2),
        reference: parsed.data.paymentReference,
      },
    ).catch(() => {});

    return res.json({ withdrawal: serializeWithdrawal(result) });
  },
);

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(400),
});

router.post(
  "/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

    const [w] = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.id, (req.params.id as string)))
      .limit(1);
    if (!w) return res.status(404).json({ error: "not_found" });
    if (w.status !== "pending" && w.status !== "approved") {
      return res
        .status(409)
        .json({ error: "invalid_status", message: "Only pending or approved requests can be rejected." });
    }

    const adminId = req.adminId ?? null;
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(withdrawalRequestsTable)
        .set({
          status: "rejected",
          rejectionReason: parsed.data.reason,
          decidedByAdminId: adminId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(withdrawalRequestsTable.id, w.id),
            inArray(withdrawalRequestsTable.status, ["pending", "approved"]),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx.insert(walletTransactionsTable).values({
        driverId: w.driverId,
        type: "withdrawal_refund",
        amount: w.amount,
        withdrawalRequestId: w.id,
        note: `Withdrawal rejected: ${parsed.data.reason}`,
        createdBy: adminId,
      });
      await tx
        .update(usersTable)
        .set({
          walletBalance: sql`(${usersTable.walletBalance}::numeric + ${w.amount})::text`,
        })
        .where(eq(usersTable.id, w.driverId));
      return updated;
    });
    if (!result) return res.status(409).json({ error: "invalid_status" });

    sendPushFromTemplate(
      w.driverId,
      "withdrawal_rejected",
      "Withdrawal rejected",
      `Your withdrawal of $${w.amount.toFixed(2)} was rejected. The amount has been returned to your wallet.`,
      {
        amount: w.amount.toFixed(2),
        reason: ` Reason: ${parsed.data.reason}.`,
      },
      { type: "withdrawal_rejected", withdrawalId: w.id },
      undefined,
      "driverApp",
    ).catch(() => {});

    sendEmailFromTemplate(
      w.driverId,
      "withdrawal_rejected",
      "Your Biddi withdrawal was rejected",
      `<p>Hi {{firstName}},</p><p>Your withdrawal request of <strong>$${w.amount.toFixed(2)}</strong> was rejected.</p><p><strong>Reason:</strong> {{reason}}</p><p>The amount has been returned to your wallet.</p><p>— The Biddi Team</p>`,
      {
        amount: w.amount.toFixed(2),
        reason: parsed.data.reason,
      },
    ).catch(() => {});

    return res.json({ withdrawal: serializeWithdrawal(result) });
  },
);

// ---------------------------------------------------------------------------
// Stripe Connect onboarding (driver-side)
// ---------------------------------------------------------------------------

const onboardSchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});

router.post("/driver/me/connect/onboard", requireUser, async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const parsed = onboardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  try {
    const accountId = await getOrCreateConnectAccount(userId);
    const link = await getStripe().accountLinks.create({
      account: accountId,
      refresh_url: parsed.data.refreshUrl,
      return_url: parsed.data.returnUrl,
      type: "account_onboarding",
    });
    return res.json({ url: link.url, accountId });
  } catch (err) {
    logger.error({ err, userId }, "stripe.connect.onboard_failed");
    return res.status(500).json({ error: "onboard_failed" });
  }
});

router.get("/driver/me/connect/status", requireUser, async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  try {
    const [me] = await db
      .select({ stripeConnectAccountId: usersTable.stripeConnectAccountId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!me?.stripeConnectAccountId) {
      return res.json({
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }
    const caps = await refreshConnectAccountCapabilities(userId);
    return res.json({
      connected: true,
      accountId: me.stripeConnectAccountId,
      ...caps,
    });
  } catch (err) {
    logger.error({ err, userId }, "stripe.connect.status_failed");
    return res.status(500).json({ error: "status_failed" });
  }
});

// ---------------------------------------------------------------------------
// Admin — pay an approved withdrawal via Stripe Connect transfer
// ---------------------------------------------------------------------------

router.post(
  "/admin/withdrawals/:id/pay-via-stripe",
  requireAdmin,
  async (req, res) => {
    const [w] = await db
      .select()
      .from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.id, req.params.id as string))
      .limit(1);
    if (!w) return res.status(404).json({ error: "not_found" });
    if (w.status !== "approved" && w.status !== "pending") {
      return res.status(409).json({
        error: "invalid_status",
        message: "Only pending or approved requests can be paid via Stripe.",
      });
    }

    const [driver] = await db
      .select({
        id: usersTable.id,
        stripeConnectAccountId: usersTable.stripeConnectAccountId,
        stripeConnectPayoutsEnabled: usersTable.stripeConnectPayoutsEnabled,
      })
      .from(usersTable)
      .where(eq(usersTable.id, w.driverId))
      .limit(1);
    if (!driver?.stripeConnectAccountId) {
      return res.status(422).json({
        error: "no_connect_account",
        message: "Driver hasn't onboarded with Stripe Connect.",
      });
    }
    if (!driver.stripeConnectPayoutsEnabled) {
      // Fresh check in case the cached flag is stale.
      const caps = await refreshConnectAccountCapabilities(driver.id);
      if (!caps.payoutsEnabled) {
        return res.status(422).json({
          error: "payouts_not_enabled",
          message: "Driver's Connect account is not yet payouts-enabled.",
        });
      }
    }

    const adminId = req.adminId ?? null;
    let transferId: string | null = null;
    try {
      const transfer = await getStripe().transfers.create({
        amount: Math.round(w.amount * 100),
        currency: "usd",
        destination: driver.stripeConnectAccountId,
        transfer_group: `withdrawal_${w.id}`,
        metadata: {
          withdrawalRequestId: w.id,
          driverId: w.driverId,
        },
      });
      transferId = transfer.id;
    } catch (err) {
      logger.error({ err, withdrawalId: w.id }, "stripe.transfer.create_failed");
      const message =
        err instanceof Error ? err.message : "transfer_create_failed";
      // Persist a failed payout row for audit.
      await db.insert(payoutsTable).values({
        withdrawalRequestId: w.id,
        driverId: w.driverId,
        amount: w.amount,
        status: "failed",
        failureReason: message,
      });
      return res
        .status(502)
        .json({ error: "transfer_create_failed", message });
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(withdrawalRequestsTable)
        .set({
          status: "paid",
          paymentReference: transferId,
          paidAt: new Date(),
          decidedByAdminId: w.decidedByAdminId ?? adminId,
          decidedAt: w.decidedAt ?? new Date(),
        })
        .where(
          and(
            eq(withdrawalRequestsTable.id, w.id),
            inArray(withdrawalRequestsTable.status, ["pending", "approved"]),
          ),
        )
        .returning();
      if (!updated) return null;

      await tx.insert(payoutsTable).values({
        withdrawalRequestId: w.id,
        driverId: w.driverId,
        stripeTransferId: transferId,
        amount: w.amount,
        status: "in_transit",
      });

      // Ledger entry: zero-amount marker that the withdrawal has been paid
      // out (matches the existing mark-paid handler pattern).
      await tx.insert(walletTransactionsTable).values({
        driverId: w.driverId,
        type: "withdrawal_paid",
        amount: 0,
        withdrawalRequestId: w.id,
        note: `Paid via Stripe · Transfer: ${transferId}`,
        createdBy: adminId,
      });

      return updated;
    });

    if (!result) {
      logger.error(
        { withdrawalId: w.id, transferId },
        "stripe.transfer.created_but_db_update_failed",
      );
      return res.status(500).json({
        error: "db_update_failed",
        transferId,
        message:
          "Transfer created in Stripe but local status update failed. Reconcile manually.",
      });
    }

    sendPushFromTemplate(
      w.driverId,
      "withdrawal_paid",
      "Withdrawal paid",
      `$${w.amount.toFixed(2)} has been sent to your bank via Stripe.`,
      { amount: w.amount.toFixed(2), reference: ` Ref: ${transferId}.` },
      { type: "withdrawal_paid", withdrawalId: w.id },
      undefined,
      "driverApp",
    ).catch(() => {});

    return res.json({ withdrawal: serializeWithdrawal(result), transferId });
  },
);

export default router;
