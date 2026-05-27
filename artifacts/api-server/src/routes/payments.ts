import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { z } from "zod";
import {
  db,
  usersTable,
  walletTransactionsTable,
  paymentIntentsTable,
  stripeWebhookEventsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { requireUser } from "../middlewares/auth";
import {
  getStripe,
  getStripeWebhookSecret,
  getOrCreateCustomer,
  stripePublishableKey,
} from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Config endpoint — exposes the publishable key so the mobile/web client can
// initialize Stripe without bundling secrets.
// ---------------------------------------------------------------------------
router.get("/payments/config", (_req, res) => {
  res.json({ publishableKey: stripePublishableKey });
});

// ---------------------------------------------------------------------------
// SetupIntent — used by the client to attach a card to the customer for
// off-session reuse (saved cards). Lazily creates the Stripe customer.
// ---------------------------------------------------------------------------
router.post("/payments/setup-intent", requireUser, async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  try {
    const customerId = await getOrCreateCustomer(userId);
    const intent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { userId },
    });
    return res.json({
      clientSecret: intent.client_secret,
      customerId,
      publishableKey: stripePublishableKey,
    });
  } catch (err) {
    logger.error({ err, userId }, "stripe.setup_intent.failed");
    return res.status(500).json({ error: "setup_intent_failed" });
  }
});

// ---------------------------------------------------------------------------
// List saved cards for the authenticated user.
// ---------------------------------------------------------------------------
router.get("/payments/payment-methods", requireUser, async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  try {
    const customerId = await getOrCreateCustomer(userId);
    const list = await getStripe().paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    const cards = list.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
    }));
    return res.json({ cards });
  } catch (err) {
    logger.error({ err, userId }, "stripe.payment_methods.list_failed");
    return res.status(500).json({ error: "list_failed" });
  }
});

// ---------------------------------------------------------------------------
// Top-up wallet by charging a saved card. Webhook completes the wallet
// credit; this endpoint only kicks off the PaymentIntent and persists a
// pre-confirmation row so the webhook handler has something to match.
// ---------------------------------------------------------------------------
const topUpSchema = z.object({
  amount: z.number().positive().max(10_000),
  paymentMethodId: z.string().min(1),
  currency: z.string().toLowerCase().length(3).optional(),
});

router.post("/payments/top-up", requireUser, async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const { amount, paymentMethodId, currency = "usd" } = parsed.data;

  try {
    const customerId = await getOrCreateCustomer(userId);
    const intent = await getStripe().paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: false,
      confirm: true,
      metadata: { userId, purpose: "top_up" },
    });

    await db.insert(paymentIntentsTable).values({
      userId,
      stripePaymentIntentId: intent.id,
      amount,
      currency,
      purpose: "top_up",
      status: intent.status as never,
    });

    return res.json({
      paymentIntentId: intent.id,
      status: intent.status,
      clientSecret: intent.client_secret,
      nextAction: intent.next_action ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId }, "stripe.top_up.failed");
    return res.status(500).json({ error: "top_up_failed", message: msg });
  }
});

// ---------------------------------------------------------------------------
// Webhook — Stripe POSTs here when a PaymentIntent settles. Idempotency is
// enforced by inserting the event id into stripe_webhook_events (PK). On
// `payment_intent.succeeded` with purpose=top_up we credit the wallet in a
// single DB transaction with the matching wallet_transactions row.
// ---------------------------------------------------------------------------
router.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string") {
      return res.status(400).json({ error: "missing_signature" });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body as Buffer,
        sig,
        getStripeWebhookSecret(),
      );
    } catch (err) {
      logger.warn({ err }, "stripe.webhook.signature_invalid");
      return res.status(400).json({ error: "invalid_signature" });
    }

    // Idempotency keystone: try to insert the event id; conflict means we
    // already processed it.
    const insertedRows = await db
      .insert(stripeWebhookEventsTable)
      .values({
        id: event.id,
        type: event.type,
        payload: event as unknown,
      })
      .onConflictDoNothing({ target: stripeWebhookEventsTable.id })
      .returning({ id: stripeWebhookEventsTable.id });

    if (insertedRows.length === 0) {
      // Already seen — ack quickly.
      return res.json({ received: true, dedup: true });
    }

    try {
      await processStripeEvent(event);
      await db
        .update(stripeWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(stripeWebhookEventsTable.id, event.id));
      return res.json({ received: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, eventId: event.id, type: event.type }, "stripe.webhook.process_failed");
      await db
        .update(stripeWebhookEventsTable)
        .set({ processingError: msg })
        .where(eq(stripeWebhookEventsTable.id, event.id));
      // Return 500 so Stripe retries.
      return res.status(500).json({ error: "process_failed" });
    }
  },
);

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentSucceeded(pi);
      return;
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentTerminalFailure(pi, event.type);
      return;
    }
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await handleConnectAccountUpdated(account);
      return;
    }
    case "transfer.reversed":
    case "transfer.updated": {
      // payouts.ts (in withdrawals route) handles success synchronously when
      // it creates the transfer. Future: reflect reversals back into payouts.
      return;
    }
    default:
      // Persist-and-ignore — we keep the event row for audit but take no
      // domain action.
      return;
  }
}

async function handlePaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const purpose = pi.metadata?.purpose;
  const userId = pi.metadata?.userId;
  if (!userId) {
    logger.warn(
      { paymentIntentId: pi.id },
      "stripe.payment_intent.succeeded.no_user_id",
    );
    return;
  }

  await db.transaction(async (tx) => {
    // Idempotency: skip if we already have a wallet_transaction linked to this
    // PaymentIntent. The linkage is via the payment_intents row.
    const [existing] = await tx
      .select({
        id: paymentIntentsTable.id,
        status: paymentIntentsTable.status,
        walletTransactionId: paymentIntentsTable.walletTransactionId,
      })
      .from(paymentIntentsTable)
      .where(eq(paymentIntentsTable.stripePaymentIntentId, pi.id))
      .limit(1);

    if (!existing) {
      // No pre-confirmation row (rare — direct PI created outside top-up?).
      // Insert one now so the audit chain is unbroken.
      await tx.insert(paymentIntentsTable).values({
        userId,
        stripePaymentIntentId: pi.id,
        amount: pi.amount_received / 100,
        currency: pi.currency,
        purpose: (purpose === "ride_charge" ? "ride_charge" : "top_up") as never,
        status: "succeeded" as never,
      });
    } else {
      if (existing.walletTransactionId) {
        // Already processed.
        return;
      }
      await tx
        .update(paymentIntentsTable)
        .set({ status: "succeeded" as never, updatedAt: new Date() })
        .where(eq(paymentIntentsTable.id, existing.id));
    }

    if (purpose === "top_up") {
      const amount = pi.amount_received / 100;
      const [walletTx] = await tx
        .insert(walletTransactionsTable)
        .values({
          driverId: userId, // walletTransactionsTable.driverId is the wallet owner — riders too.
          type: "top_up",
          amount,
          note: `stripe:${pi.id}`,
        })
        .returning({ id: walletTransactionsTable.id });

      await tx
        .update(usersTable)
        .set({
          walletBalance: sql`(coalesce(${usersTable.walletBalance}::numeric, 0) + ${amount})::text`,
        })
        .where(eq(usersTable.id, userId));

      await tx
        .update(paymentIntentsTable)
        .set({ walletTransactionId: walletTx?.id ?? null })
        .where(eq(paymentIntentsTable.stripePaymentIntentId, pi.id));
    }
  });
}

async function handlePaymentIntentTerminalFailure(
  pi: Stripe.PaymentIntent,
  eventType: string,
): Promise<void> {
  const statusValue = eventType === "payment_intent.canceled" ? "canceled" : "failed";
  const failureReason =
    pi.last_payment_error?.message ?? pi.cancellation_reason ?? null;
  await db
    .update(paymentIntentsTable)
    .set({
      status: statusValue as never,
      failureReason: failureReason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(paymentIntentsTable.stripePaymentIntentId, pi.id));
}

async function handleConnectAccountUpdated(
  account: Stripe.Account,
): Promise<void> {
  const driverId = account.metadata?.driverId;
  if (!driverId) return;
  await db
    .update(usersTable)
    .set({
      stripeConnectChargesEnabled: Boolean(account.charges_enabled),
      stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
    })
    .where(eq(usersTable.id, driverId));
}

export default router;

// Exported for tests
export { processStripeEvent, handlePaymentIntentSucceeded };
