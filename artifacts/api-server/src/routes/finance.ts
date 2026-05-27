import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  walletTransactionsTable,
  paymentIntentsTable,
  payoutsTable,
} from "@workspace/db";
import { and, gte, lt, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import { getStripe } from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "expected YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Per-day reconciliation: wallet_transactions totals + Stripe balance txns.
// Drift = our DB has rows Stripe doesn't (or vice versa) for the day window.
// ---------------------------------------------------------------------------
router.get("/admin/finance/reconciliation", requireAdmin, async (req, res) => {
  const dateParsed = dateSchema.safeParse(req.query.date);
  if (!dateParsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_date", message: dateParsed.error.message });
  }
  const dayStart = new Date(`${dateParsed.data}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    // 1. Local ledger — per-type totals from wallet_transactions
    const walletAgg = await db
      .select({
        type: walletTransactionsTable.type,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${walletTransactionsTable.amount}), 0)`,
      })
      .from(walletTransactionsTable)
      .where(
        and(
          gte(walletTransactionsTable.createdAt, dayStart),
          lt(walletTransactionsTable.createdAt, dayEnd),
        ),
      )
      .groupBy(walletTransactionsTable.type);

    // 2. Local PaymentIntents — succeeded only, summed (dollars)
    const piAgg = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${paymentIntentsTable.amount}), 0)`,
      })
      .from(paymentIntentsTable)
      .where(
        and(
          gte(paymentIntentsTable.createdAt, dayStart),
          lt(paymentIntentsTable.createdAt, dayEnd),
          sql`${paymentIntentsTable.status} = 'succeeded'`,
        ),
      );

    // 3. Local payouts — in_transit + paid for the window
    const payoutAgg = await db
      .select({
        status: payoutsTable.status,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${payoutsTable.amount}), 0)`,
      })
      .from(payoutsTable)
      .where(
        and(
          gte(payoutsTable.createdAt, dayStart),
          lt(payoutsTable.createdAt, dayEnd),
        ),
      )
      .groupBy(payoutsTable.status);

    // 4. Stripe-side balance transactions for the same window. Convert to
    // dollars on the fly.
    const stripeStart = Math.floor(dayStart.getTime() / 1000);
    const stripeEnd = Math.floor(dayEnd.getTime() / 1000);
    const balanceTxAgg: Record<
      string,
      { count: number; gross: number; net: number; fee: number }
    > = {};
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await getStripe().balanceTransactions.list({
          created: { gte: stripeStart, lt: stripeEnd },
          limit: 100,
          starting_after: cursor,
        });
        for (const tx of page.data) {
          const bucket = (balanceTxAgg[tx.type] ??= {
            count: 0,
            gross: 0,
            net: 0,
            fee: 0,
          });
          bucket.count += 1;
          bucket.gross += tx.amount / 100;
          bucket.net += tx.net / 100;
          bucket.fee += tx.fee / 100;
        }
        if (!page.has_more) break;
        cursor = page.data[page.data.length - 1]?.id;
        if (!cursor) break;
      }
    } catch (err) {
      logger.warn({ err }, "stripe.reconciliation.list_failed");
      return res.json({
        date: dateParsed.data,
        local: { walletByType: walletAgg, paymentIntents: piAgg[0] ?? null, payouts: payoutAgg },
        stripe: { error: "stripe_unreachable" },
      });
    }

    return res.json({
      date: dateParsed.data,
      local: {
        walletByType: walletAgg,
        paymentIntents: piAgg[0] ?? { count: 0, total: 0 },
        payouts: payoutAgg,
      },
      stripe: { byType: balanceTxAgg },
    });
  } catch (err) {
    logger.error({ err }, "finance.reconciliation_failed");
    return res.status(500).json({ error: "reconciliation_failed" });
  }
});

export default router;
