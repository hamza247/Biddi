import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";
import { adminsTable } from "./admins";

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "top_up",
      "commission_deduction",
      "manual_adjustment",
      "withdrawal_request",
      "withdrawal_paid",
      "withdrawal_refund",
      "referral",
      "promotion_bonus",
    ],
  }).notNull(),
  amount: doublePrecision("amount").notNull(),
  rideId: uuid("ride_id").references(() => ridesTable.id, {
    onDelete: "set null",
  }),
  withdrawalRequestId: uuid("withdrawal_request_id"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => adminsTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const commissionExemptionsTable = pgTable("commission_exemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  grantedByAdminId: uuid("granted_by_admin_id").references(
    () => adminsTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const payoutMethodsTable = pgTable(
  "payout_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    method: text("method", { enum: ["bank", "mobile_money"] }).notNull(),
    accountName: text("account_name").notNull(),
    bankName: text("bank_name"),
    accountNumber: text("account_number"),
    iban: text("iban"),
    mobileProvider: text("mobile_provider"),
    mobileNumber: text("mobile_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    driverIdx: uniqueIndex("payout_methods_driver_id_idx").on(t.driverId),
  }),
);

export const withdrawalRequestsTable = pgTable(
  "withdrawal_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    amount: doublePrecision("amount").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "paid", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    payoutMethodSnapshot: jsonb("payout_method_snapshot").notNull(),
    paymentReference: text("payment_reference"),
    rejectionReason: text("rejection_reason"),
    decidedByAdminId: uuid("decided_by_admin_id").references(
      () => adminsTable.id,
      { onDelete: "set null" },
    ),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => ({
    driverStatusIdx: index("withdrawal_requests_driver_status_idx").on(
      t.driverId,
      t.status,
    ),
    statusIdx: index("withdrawal_requests_status_idx").on(t.status),
  }),
);

export const paymentIntentsTable = pgTable(
  "payment_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    purpose: text("purpose", {
      enum: ["top_up", "ride_charge"],
    }).notNull(),
    status: text("status", {
      enum: [
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "processing",
        "requires_capture",
        "succeeded",
        "canceled",
        "failed",
      ],
    })
      .notNull()
      .default("requires_payment_method"),
    rideId: uuid("ride_id").references(() => ridesTable.id, {
      onDelete: "set null",
    }),
    walletTransactionId: uuid("wallet_transaction_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("payment_intents_user_id_idx").on(t.userId),
    statusIdx: index("payment_intents_status_idx").on(t.status),
  }),
);

export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
});

export const payoutsTable = pgTable(
  "payouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    withdrawalRequestId: uuid("withdrawal_request_id")
      .notNull()
      .references(() => withdrawalRequestsTable.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    stripeTransferId: text("stripe_transfer_id").unique(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status", {
      enum: ["pending", "in_transit", "paid", "failed", "canceled"],
    })
      .notNull()
      .default("pending"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    withdrawalIdx: uniqueIndex("payouts_withdrawal_request_id_idx").on(
      t.withdrawalRequestId,
    ),
    driverIdx: index("payouts_driver_id_idx").on(t.driverId),
  }),
);

export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
export type InsertWalletTransaction =
  typeof walletTransactionsTable.$inferInsert;
export type CommissionExemption = typeof commissionExemptionsTable.$inferSelect;
export type InsertCommissionExemption =
  typeof commissionExemptionsTable.$inferInsert;
export type PayoutMethod = typeof payoutMethodsTable.$inferSelect;
export type InsertPayoutMethod = typeof payoutMethodsTable.$inferInsert;
export type WithdrawalRequest = typeof withdrawalRequestsTable.$inferSelect;
export type InsertWithdrawalRequest =
  typeof withdrawalRequestsTable.$inferInsert;
export type PaymentIntent = typeof paymentIntentsTable.$inferSelect;
export type InsertPaymentIntent = typeof paymentIntentsTable.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
export type InsertStripeWebhookEvent =
  typeof stripeWebhookEventsTable.$inferInsert;
export type Payout = typeof payoutsTable.$inferSelect;
export type InsertPayout = typeof payoutsTable.$inferInsert;

export interface PayoutMethodSnapshot {
  method: "bank" | "mobile_money";
  accountName: string;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  mobileProvider?: string | null;
  mobileNumber?: string | null;
}
