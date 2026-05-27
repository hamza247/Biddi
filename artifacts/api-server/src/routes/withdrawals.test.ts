/**
 * Integration tests for the driver/admin withdrawal request flow.
 *
 * Covers the financial state machine in `routes/withdrawals.ts`:
 *  - Driver create: happy path (201, balance debited, withdrawal row + wallet
 *    transaction logged), below-min rejection, insufficient-balance rejection,
 *    duplicate pending blocked with 409.
 *  - Driver cancel: refunds the wallet balance and logs a refund transaction.
 *  - Admin reject: refunds the wallet balance and logs a refund transaction.
 *  - Admin mark-paid: records the payment reference and logs a paid txn
 *    without touching the wallet balance.
 *
 * The route runs everything inside a `db.transaction(...)`. Tests use an
 * in-memory `@workspace/db` mock that exposes the same `select/insert/update/
 * transaction` surface the route relies on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory state — hoisted so vi.mock factories can close over it.
// ---------------------------------------------------------------------------

type WStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

type UserRow = {
  id: string;
  driverStatus: "approved" | "pending" | "rejected" | "suspended" | "not_applied";
  walletBalance: string;
};

type PayoutRow = {
  id: string;
  driverId: string;
  method: "bank" | "mobile_money";
  accountName: string;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  mobileProvider: string | null;
  mobileNumber: string | null;
};

type WithdrawalRow = {
  id: string;
  driverId: string;
  amount: number;
  status: WStatus;
  payoutMethodSnapshot: unknown;
  paymentReference: string | null;
  rejectionReason: string | null;
  decidedByAdminId: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  paidAt: Date | null;
};

type WalletTxRow = {
  id: string;
  driverId: string;
  type:
    | "top_up"
    | "commission_deduction"
    | "manual_adjustment"
    | "withdrawal_request"
    | "withdrawal_paid"
    | "withdrawal_refund";
  amount: number;
  withdrawalRequestId: string | null;
  rideId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
};

const {
  DRIVER_ID,
  ADMIN_ID,
  state,
  resetState,
  callerStore,
  configStore,
  nextId,
} = vi.hoisted(() => {
  const DRIVER_ID = "11111111-1111-1111-1111-111111111111";
  const ADMIN_ID = "22222222-2222-2222-2222-222222222222";

  const state: {
    users: UserRow[];
    admins: { id: string; name: string }[];
    payoutMethods: PayoutRow[];
    withdrawals: WithdrawalRow[];
    walletTxs: WalletTxRow[];
  } = {
    users: [],
    admins: [],
    payoutMethods: [],
    withdrawals: [],
    walletTxs: [],
  };

  let counter = 0;
  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}-${counter.toString().padStart(8, "0")}`;
  }

  function resetState() {
    state.users.length = 0;
    state.admins.length = 0;
    state.payoutMethods.length = 0;
    state.withdrawals.length = 0;
    state.walletTxs.length = 0;
    counter = 0;
  }

  const callerStore: { sub: string; kind: "user" | "admin" } = {
    sub: DRIVER_ID,
    kind: "user",
  };

  const configStore = { minWithdrawalAmount: 10 };

  return { DRIVER_ID, ADMIN_ID, state, resetState, callerStore, configStore, nextId };
});

// ---------------------------------------------------------------------------
// Helpers to walk drizzle's SQL/Param/Column nodes.
// ---------------------------------------------------------------------------

function extractParamValues(node: unknown): unknown[] {
  if (node == null) return [];
  if (typeof node !== "object") return [node];
  const obj = node as Record<string, unknown>;
  // Drizzle Param: { value, encoder }
  if ("value" in obj && "encoder" in obj) {
    const v = obj["value"];
    if (v == null) return [];
    if (Array.isArray(v)) return v.filter((x) => x != null && typeof x !== "object");
    if (typeof v !== "object") return [v];
    return [];
  }
  // Drizzle SQL: { queryChunks: SQLChunk[] }
  if ("queryChunks" in obj && Array.isArray(obj["queryChunks"])) {
    return (obj["queryChunks"] as unknown[]).flatMap(extractParamValues);
  }
  return [];
}

function extractStringParams(node: unknown): string[] {
  return extractParamValues(node)
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map((v) => String(v));
}

/** Walk a SQL fragment and concatenate every literal string chunk found. */
function deepStrings(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node + " ";
  if (typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  let out = "";
  if (typeof obj["value"] === "string") out += obj["value"] + " ";
  else if (Array.isArray(obj["value"])) {
    for (const v of obj["value"]) if (typeof v === "string") out += v + " ";
  }
  if (Array.isArray(obj["queryChunks"])) {
    for (const c of obj["queryChunks"] as unknown[]) out += deepStrings(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mock @workspace/db.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const {
    usersTable,
    adminsTable,
    payoutMethodsTable,
    withdrawalRequestsTable,
    walletTransactionsTable,
  } = actual;

  // ---------- SELECT ----------

  function selectFrom(table: unknown, fields: unknown) {
    if (table === usersTable) {
      return {
        where(cond: unknown) {
          const params = extractStringParams(cond);
          return {
            limit(n: number) {
              const rows = state.users.filter((u) => params.includes(u.id));
              return Promise.resolve(rows.slice(0, n));
            },
          };
        },
      };
    }
    if (table === adminsTable) {
      return {
        where(cond: unknown) {
          const params = extractStringParams(cond);
          return {
            limit(n: number) {
              const rows = state.admins.filter((a) => params.includes(a.id));
              return Promise.resolve(rows.slice(0, n));
            },
          };
        },
      };
    }
    if (table === payoutMethodsTable) {
      return {
        where(cond: unknown) {
          const params = extractStringParams(cond);
          return {
            limit(n: number) {
              const rows = state.payoutMethods.filter((p) =>
                params.includes(p.driverId),
              );
              return Promise.resolve(rows.slice(0, n));
            },
          };
        },
      };
    }
    if (table === withdrawalRequestsTable) {
      return {
        where(cond: unknown) {
          const params = extractStringParams(cond);
          // The existence check inside POST create is the only withdrawal
          // select that passes a custom field projection (`select({id})`);
          // every other select is `select()` (full row).
          const isExistenceCheck = fields != null && typeof fields === "object";
          return {
            limit(n: number) {
              let rows: WithdrawalRow[];
              if (isExistenceCheck) {
                rows = state.withdrawals.filter(
                  (w) =>
                    params.includes(w.driverId) &&
                    (w.status === "pending" || w.status === "approved"),
                );
              } else {
                // Lookup by id (cancel / approve / reject / mark-paid).
                rows = state.withdrawals.filter((w) => params.includes(w.id));
              }
              return Promise.resolve(rows.slice(0, n));
            },
          };
        },
      };
    }
    // Anything else (list endpoints we don't test): return an empty chain.
    return {
      where: () => ({
        limit: () => Promise.resolve([]),
        orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
      }),
      leftJoin: () => ({
        where: () => ({ orderBy: () => Promise.resolve([]) }),
      }),
    };
  }

  // ---------- INSERT ----------

  function thenable<T>(rows: T[]) {
    const p: Record<string, unknown> = {
      returning: () => Promise.resolve(rows),
      then: (resolve: (v: T[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) =>
        Promise.resolve(rows).catch(reject),
    };
    return p;
  }

  function insertInto(table: unknown) {
    return {
      values(vals: Record<string, unknown>) {
        if (table === withdrawalRequestsTable) {
          const row: WithdrawalRow = {
            id: nextId("wd"),
            driverId: String(vals["driverId"]),
            amount: Number(vals["amount"]),
            status: (vals["status"] as WStatus) ?? "pending",
            payoutMethodSnapshot: vals["payoutMethodSnapshot"],
            paymentReference: null,
            rejectionReason: null,
            decidedByAdminId: null,
            requestedAt: new Date(),
            decidedAt: null,
            paidAt: null,
          };
          state.withdrawals.push(row);
          return thenable([row]);
        }
        if (table === walletTransactionsTable) {
          const row: WalletTxRow = {
            id: nextId("wtx"),
            driverId: String(vals["driverId"]),
            type: vals["type"] as WalletTxRow["type"],
            amount: Number(vals["amount"]),
            withdrawalRequestId:
              (vals["withdrawalRequestId"] as string | null) ?? null,
            rideId: (vals["rideId"] as string | null) ?? null,
            note: (vals["note"] as string | null) ?? null,
            createdBy: (vals["createdBy"] as string | null) ?? null,
            createdAt: new Date(),
          };
          state.walletTxs.push(row);
          return thenable([row]);
        }
        // Other tables (e.g. payoutMethodsTable upsert) aren't exercised here.
        return thenable([vals]);
      },
    };
  }

  // ---------- UPDATE ----------

  function applyWithdrawalUpdate(
    setVals: Record<string, unknown>,
    cond: unknown,
  ): WithdrawalRow[] {
    const params = extractStringParams(cond);
    const constrainedStatuses = (
      ["pending", "approved", "paid", "rejected", "cancelled"] as WStatus[]
    ).filter((s) => params.includes(s));
    const updated: WithdrawalRow[] = [];
    for (const w of state.withdrawals) {
      if (!params.includes(w.id)) continue;
      if (constrainedStatuses.length && !constrainedStatuses.includes(w.status))
        continue;
      for (const [k, v] of Object.entries(setVals)) {
        // `set()` only uses primitive/Date values for these routes.
        (w as unknown as Record<string, unknown>)[k] = v;
      }
      updated.push(w);
    }
    return updated;
  }

  function applyUserBalanceUpdate(
    setVals: Record<string, unknown>,
    cond: unknown,
  ): UserRow[] {
    const params = extractStringParams(cond);
    const balanceFragment = setVals["walletBalance"];
    // Determine sign by inspecting the SQL fragment text.
    const text = deepStrings(balanceFragment);
    const isSubtract = /::numeric\s*-/.test(text);
    const isAdd = /::numeric\s*\+/.test(text);
    // The fragment has exactly one numeric param (the amount).
    const numericParam = extractParamValues(balanceFragment).find(
      (v) => typeof v === "number",
    ) as number | undefined;
    const amount = numericParam ?? 0;

    const updated: UserRow[] = [];
    for (const u of state.users) {
      if (!params.includes(u.id)) continue;
      const cur = parseFloat(u.walletBalance || "0");
      const next = isSubtract ? cur - amount : isAdd ? cur + amount : cur;
      u.walletBalance = String(next);
      updated.push(u);
    }
    return updated;
  }

  function update(table: unknown) {
    return {
      set(vals: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            let rows: unknown[] = [];
            if (table === withdrawalRequestsTable) {
              rows = applyWithdrawalUpdate(vals, cond);
            } else if (table === usersTable) {
              rows = applyUserBalanceUpdate(vals, cond);
            }
            return thenable(rows);
          },
        };
      },
    };
  }

  // ---------- TRANSACTION ----------

  const db = {
    select(fields?: unknown) {
      return { from: (table: unknown) => selectFrom(table, fields) };
    },
    insert: insertInto,
    update,
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(db),
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock auth, settings, push.
// ---------------------------------------------------------------------------

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyToken: vi.fn(() => ({ sub: callerStore.sub, kind: callerStore.kind })),
  };
});

vi.mock("../lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/settings")>();
  return {
    ...actual,
    getConfig: vi.fn(async () => ({ minWithdrawalAmount: configStore.minWithdrawalAmount })),
  };
});

vi.mock("../lib/push", () => ({
  sendPushFromTemplate: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import app AFTER mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";
const AUTH = { Authorization: "Bearer fake-token" };

function asDriver() {
  callerStore.sub = DRIVER_ID;
  callerStore.kind = "user";
}
function asAdmin() {
  callerStore.sub = ADMIN_ID;
  callerStore.kind = "admin";
}

function seedDriver(opts: { balance?: string; status?: UserRow["driverStatus"] } = {}) {
  state.users.push({
    id: DRIVER_ID,
    driverStatus: opts.status ?? "approved",
    walletBalance: opts.balance ?? "100.00",
  });
}

function seedAdmin() {
  state.admins.push({ id: ADMIN_ID, name: "Test Admin" });
}

function seedPayoutMethod() {
  state.payoutMethods.push({
    id: nextId("pm"),
    driverId: DRIVER_ID,
    method: "mobile_money",
    accountName: "Test Driver",
    bankName: null,
    accountNumber: null,
    iban: null,
    mobileProvider: "MTN",
    mobileNumber: "+1234567890",
  });
}

function seedPendingWithdrawal(amount = 25): WithdrawalRow {
  const row: WithdrawalRow = {
    id: nextId("wd"),
    driverId: DRIVER_ID,
    amount,
    status: "pending",
    payoutMethodSnapshot: { method: "mobile_money", accountName: "Test Driver" },
    paymentReference: null,
    rejectionReason: null,
    decidedByAdminId: null,
    requestedAt: new Date(),
    decidedAt: null,
    paidAt: null,
  };
  state.withdrawals.push(row);
  return row;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Withdrawals — driver POST /driver/me/withdrawals", () => {
  beforeEach(() => {
    resetState();
    configStore.minWithdrawalAmount = 10;
    asDriver();
  });

  it("creates a withdrawal, debits the wallet, and logs a request transaction", async () => {
    seedDriver({ balance: "100.00" });
    seedPayoutMethod();

    const res = await request(app)
      .post(`${BASE}/driver/me/withdrawals`)
      .set(AUTH)
      .send({ amount: 40 });

    expect(res.status).toBe(201);
    expect(res.body.withdrawal).toMatchObject({
      driverId: DRIVER_ID,
      amount: 40,
      status: "pending",
    });
    expect(parseFloat(res.body.walletBalance)).toBeCloseTo(60, 5);

    expect(state.withdrawals).toHaveLength(1);
    expect(state.withdrawals[0].status).toBe("pending");
    expect(parseFloat(state.users[0].walletBalance)).toBeCloseTo(60, 5);

    const txs = state.walletTxs.filter((t) => t.type === "withdrawal_request");
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBeCloseTo(-40, 5);
    expect(txs[0].withdrawalRequestId).toBe(state.withdrawals[0].id);
  });

  it("rejects amounts below the configured minimum with 422 below_minimum", async () => {
    configStore.minWithdrawalAmount = 10;
    seedDriver({ balance: "100.00" });
    seedPayoutMethod();

    const res = await request(app)
      .post(`${BASE}/driver/me/withdrawals`)
      .set(AUTH)
      .send({ amount: 5 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("below_minimum");
    expect(state.withdrawals).toHaveLength(0);
    expect(parseFloat(state.users[0].walletBalance)).toBeCloseTo(100, 5);
  });

  it("rejects when wallet balance is insufficient with 422 insufficient_balance", async () => {
    seedDriver({ balance: "20.00" });
    seedPayoutMethod();

    const res = await request(app)
      .post(`${BASE}/driver/me/withdrawals`)
      .set(AUTH)
      .send({ amount: 50 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_balance");
    expect(state.withdrawals).toHaveLength(0);
    expect(parseFloat(state.users[0].walletBalance)).toBeCloseTo(20, 5);
  });

  it("blocks a duplicate request while a pending one already exists with 409", async () => {
    seedDriver({ balance: "200.00" });
    seedPayoutMethod();
    seedPendingWithdrawal(30);

    const res = await request(app)
      .post(`${BASE}/driver/me/withdrawals`)
      .set(AUTH)
      .send({ amount: 50 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("request_in_progress");
    // No new withdrawal row, no balance movement.
    expect(state.withdrawals).toHaveLength(1);
    expect(parseFloat(state.users[0].walletBalance)).toBeCloseTo(200, 5);
  });
});

describe("Withdrawals — driver POST /driver/me/withdrawals/:id/cancel", () => {
  beforeEach(() => {
    resetState();
    asDriver();
  });

  it("cancels a pending request and refunds the wallet balance", async () => {
    // Driver started with 100, requested 30 → 70 remaining.
    seedDriver({ balance: "70.00" });
    const wd = seedPendingWithdrawal(30);

    const res = await request(app)
      .post(`${BASE}/driver/me/withdrawals/${wd.id}/cancel`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.withdrawal.status).toBe("cancelled");
    expect(parseFloat(res.body.walletBalance)).toBeCloseTo(100, 5);

    expect(state.withdrawals[0].status).toBe("cancelled");
    expect(parseFloat(state.users[0].walletBalance)).toBeCloseTo(100, 5);

    const refunds = state.walletTxs.filter((t) => t.type === "withdrawal_refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBeCloseTo(30, 5);
    expect(refunds[0].withdrawalRequestId).toBe(wd.id);
  });
});

describe("Withdrawals — admin actions", () => {
  beforeEach(() => {
    resetState();
    seedAdmin();
    asAdmin();
  });

  it("rejecting a pending request refunds the driver's wallet", async () => {
    state.users.push({ id: DRIVER_ID, driverStatus: "approved", walletBalance: "70.00" });
    const wd = seedPendingWithdrawal(30);

    const res = await request(app)
      .post(`${BASE}/admin/withdrawals/${wd.id}/reject`)
      .set(AUTH)
      .send({ reason: "Suspicious activity" });

    expect(res.status).toBe(200);
    expect(res.body.withdrawal.status).toBe("rejected");
    expect(res.body.withdrawal.rejectionReason).toBe("Suspicious activity");

    const driver = state.users.find((u) => u.id === DRIVER_ID)!;
    expect(parseFloat(driver.walletBalance)).toBeCloseTo(100, 5);

    const refunds = state.walletTxs.filter((t) => t.type === "withdrawal_refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBeCloseTo(30, 5);
    expect(refunds[0].withdrawalRequestId).toBe(wd.id);
    expect(refunds[0].createdBy).toBe(ADMIN_ID);
  });

  it("mark-paid records the payment reference and logs a paid transaction without touching balance", async () => {
    state.users.push({ id: DRIVER_ID, driverStatus: "approved", walletBalance: "70.00" });
    const wd = seedPendingWithdrawal(30);

    const res = await request(app)
      .post(`${BASE}/admin/withdrawals/${wd.id}/mark-paid`)
      .set(AUTH)
      .send({ paymentReference: "BANK-REF-12345" });

    expect(res.status).toBe(200);
    expect(res.body.withdrawal.status).toBe("paid");
    expect(res.body.withdrawal.paymentReference).toBe("BANK-REF-12345");

    expect(state.withdrawals[0].status).toBe("paid");
    expect(state.withdrawals[0].paymentReference).toBe("BANK-REF-12345");
    expect(state.withdrawals[0].paidAt).not.toBeNull();
    expect(state.withdrawals[0].decidedByAdminId).toBe(ADMIN_ID);

    // Wallet balance is NOT refunded on payout — it was already debited at
    // request time.
    const driver = state.users.find((u) => u.id === DRIVER_ID)!;
    expect(parseFloat(driver.walletBalance)).toBeCloseTo(70, 5);

    const paidTxs = state.walletTxs.filter((t) => t.type === "withdrawal_paid");
    expect(paidTxs).toHaveLength(1);
    expect(paidTxs[0].amount).toBe(0);
    expect(paidTxs[0].withdrawalRequestId).toBe(wd.id);
    expect(paidTxs[0].note).toContain("BANK-REF-12345");
    expect(paidTxs[0].createdBy).toBe(ADMIN_ID);
  });
});
