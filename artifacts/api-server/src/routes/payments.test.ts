/**
 * Smoke tests for /payments/webhook.
 *
 * Covers the signature-verification gate that runs BEFORE any DB I/O:
 *  - Missing `stripe-signature` header → 400.
 *  - Invalid signature → 400 (no DB write, no Stripe call beyond verify).
 *
 * Full DB-integrated tests (top_up wallet credit + event-id dedup) live in a
 * follow-up alongside the payments mock harness — they need the same in-memory
 * `@workspace/db` mock pattern used by withdrawals.test.ts.
 *
 * To keep this test light and isolated, we mount ONLY the payments router on
 * a fresh Express app rather than loading the full ./app — that avoids
 * dragging in `admin-extended` / `geo-fence` modules whose top-level imports
 * touch real DB exports we don't want to stub here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../lib/stripe", () => {
  return {
    getStripe: () => ({
      webhooks: {
        constructEvent: (_body: Buffer, _sig: string, _secret: string) => {
          throw new Error("signature_invalid_mock");
        },
      },
    }),
    getStripeWebhookSecret: () => "whsec_test_dummy_value",
    getOrCreateCustomer: vi.fn(),
    getOrCreateConnectAccount: vi.fn(),
    refreshConnectAccountCapabilities: vi.fn(),
    stripePublishableKey: "pk_test_dummy",
  };
});

vi.mock("@workspace/db", () => {
  const noop = () => Promise.resolve([]);
  const tableProxy = new Proxy(
    {},
    { get: () => "_placeholder_" },
  );
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: noop }) }) }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: noop }),
          returning: noop,
        }),
      }),
      update: () => ({ set: () => ({ where: noop }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
    usersTable: tableProxy,
    walletTransactionsTable: tableProxy,
    paymentIntentsTable: tableProxy,
    stripeWebhookEventsTable: tableProxy,
  };
});

vi.mock("../middlewares/auth", () => ({
  requireUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import paymentsRouter from "./payments";

function buildTestApp() {
  const app = express();
  app.use(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
  );
  app.use(express.json());
  app.use("/api", paymentsRouter);
  return app;
}

const WEBHOOK_PATH = "/api/payments/webhook";

describe("POST /payments/webhook signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_test_1", type: "payment_intent.succeeded" }));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "missing_signature" });
  });

  it("returns 400 when the signature cannot be verified", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .send(JSON.stringify({ id: "evt_test_2", type: "payment_intent.succeeded" }));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_signature" });
  });
});
