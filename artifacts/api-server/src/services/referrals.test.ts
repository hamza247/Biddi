/**
 * Service-level tests for distributeReferralRewards. We mock @workspace/db
 * with an in-memory store covering the few tables touched by the service so
 * we can assert:
 *   - rewards walk up to MAX_LEVELS ancestors,
 *   - inactive levels are skipped without consuming the chain,
 *   - cycles in the referral chain stop traversal,
 *   - the unique (ride_id, level) constraint makes the call idempotent,
 *   - wallet_transactions and walletBalance are updated for every credit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface UserRow {
  id: string;
  referralCode: string | null;
  referredByCode: string | null;
  walletBalance: string;
}
interface LevelRow {
  level: number;
  percentage: number;
  isActive: boolean;
  updatedAt: Date;
}
interface EarningRow {
  id: string;
  userId: string;
  fromUserId: string;
  rideId: string;
  level: number;
  percentage: number;
  amount: number;
  status: string;
  createdAt: Date;
}
interface WalletTxnRow {
  id: string;
  driverId: string;
  type: string;
  amount: number;
  rideId: string | null;
  note: string | null;
}

const store: {
  users: Map<string, UserRow>;
  levels: Map<number, LevelRow>;
  earnings: EarningRow[];
  walletTxns: WalletTxnRow[];
  failNextWalletInsert: boolean;
} = {
  users: new Map(),
  levels: new Map(),
  earnings: [],
  walletTxns: [],
  failNextWalletInsert: false,
};

function reset() {
  store.users.clear();
  store.levels.clear();
  store.earnings = [];
  store.walletTxns = [];
  store.failNextWalletInsert = false;
}

vi.mock("@workspace/db", () => {
  const TBL_USERS = "users";
  const TBL_LEVELS = "levels";
  const TBL_EARNINGS = "earnings";
  const TBL_WALLET = "wallet";
  const TBL_RIDES = "rides";
  const COL_USER_ID = "users.id";
  const COL_USER_REFERRAL_CODE = "users.referralCode";
  const COL_USER_BALANCE = "users.walletBalance";
  const usersTable: any = { __t: TBL_USERS };
  usersTable.id = COL_USER_ID;
  usersTable.referralCode = COL_USER_REFERRAL_CODE;
  usersTable.walletBalance = COL_USER_BALANCE;

  const referralLevelsTable: any = { __t: TBL_LEVELS };
  const referralEarningsTable: any = { __t: TBL_EARNINGS };
  const walletTransactionsTable: any = { __t: TBL_WALLET };
  const ridesTable: any = { __t: TBL_RIDES };

  function makeSelect() {
    const state: { table: any; where: any } = { table: null, where: null };
    const runner = () => {
      const t = state.table?.__t;
      if (t === TBL_USERS) {
        if (state.where?.col === COL_USER_ID) {
          const u = store.users.get(state.where.value);
          return u ? [u] : [];
        }
        if (state.where?.col === COL_USER_REFERRAL_CODE) {
          const u = [...store.users.values()].find(
            (x) => x.referralCode === state.where.value,
          );
          return u ? [u] : [];
        }
        return [...store.users.values()];
      }
      if (t === TBL_LEVELS) {
        return [...store.levels.values()].sort((a, b) => a.level - b.level);
      }
      return [];
    };
    const builder: any = {
      select: () => builder,
      from: (t: any) => {
        state.table = t;
        return builder;
      },
      where: (w: any) => {
        state.where = w;
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      then: (resolve: any, reject?: any) =>
        Promise.resolve(runner()).then(resolve, reject),
    };
    return builder;
  }

  function makeInsert(table: any) {
    const state: { values: any[]; conflict: boolean } = {
      values: [],
      conflict: false,
    };
    const exec = () => {
      const out: any[] = [];
      for (const row of state.values) {
        const t = table.__t;
        if (t === TBL_EARNINGS) {
          if (state.conflict) {
            const exists = store.earnings.find(
              (e) =>
                e.rideId === row.rideId &&
                e.level === row.level &&
                e.fromUserId === row.fromUserId,
            );
            if (exists) continue;
          }
          const inserted: EarningRow = {
            id: `e-${store.earnings.length + 1}`,
            status: row.status ?? "credited",
            createdAt: new Date(),
            ...row,
          };
          store.earnings.push(inserted);
          out.push(inserted);
        } else if (t === TBL_WALLET) {
          if (store.failNextWalletInsert) {
            store.failNextWalletInsert = false;
            throw new Error("simulated wallet_transactions insert failure");
          }
          const inserted: WalletTxnRow = {
            id: `w-${store.walletTxns.length + 1}`,
            rideId: row.rideId ?? null,
            note: row.note ?? null,
            ...row,
          };
          store.walletTxns.push(inserted);
          out.push(inserted);
        } else if (t === TBL_LEVELS) {
          if (state.conflict && store.levels.has(row.level)) continue;
          const inserted: LevelRow = {
            updatedAt: new Date(),
            isActive: row.isActive ?? true,
            ...row,
          };
          store.levels.set(row.level, inserted);
          out.push(inserted);
        }
      }
      return out;
    };
    const builder: any = {
      values: (v: any) => {
        state.values = Array.isArray(v) ? v : [v];
        return builder;
      },
      onConflictDoNothing: () => {
        state.conflict = true;
        return builder;
      },
      returning: () => ({
        then: (resolve: any, reject?: any) =>
          Promise.resolve(exec()).then(resolve, reject),
      }),
      then: (resolve: any, reject?: any) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return builder;
  }

  function makeUpdate(table: any) {
    const state: { set: any; where: any } = { set: null, where: null };
    const exec = () => {
      const t = table.__t;
      if (t === TBL_USERS && state.where?.col === COL_USER_ID) {
        const u = store.users.get(state.where.value);
        const add = state.set?.walletBalance?.__addBalance;
        if (u && typeof add === "number") {
          const cur = parseFloat(u.walletBalance ?? "0");
          u.walletBalance = String(cur + add);
        }
      }
    };
    const builder: any = {
      set: (v: any) => {
        state.set = v;
        return builder;
      },
      where: (w: any) => {
        state.where = w;
        return builder;
      },
      then: (resolve: any, reject?: any) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return builder;
  }

  const db: any = {
    select: () => makeSelect(),
    insert: (t: any) => makeInsert(t),
    update: (t: any) => makeUpdate(t),
    transaction: async (fn: any) => {
      // Snapshot mutable state so we can roll back on throw — the real driver
      // would do this at the database level; here we simulate it in memory so
      // partial-failure tests reflect production behaviour.
      const snapshot = {
        users: new Map(
          [...store.users.entries()].map(([k, v]) => [k, { ...v }]),
        ),
        levels: new Map(
          [...store.levels.entries()].map(([k, v]) => [k, { ...v }]),
        ),
        earnings: store.earnings.map((e) => ({ ...e })),
        walletTxns: store.walletTxns.map((w) => ({ ...w })),
      };
      try {
        return await fn(db);
      } catch (err) {
        store.users = snapshot.users;
        store.levels = snapshot.levels;
        store.earnings = snapshot.earnings;
        store.walletTxns = snapshot.walletTxns;
        throw err;
      }
    },
  };

  return {
    db,
    usersTable,
    referralLevelsTable,
    referralEarningsTable,
    walletTransactionsTable,
    ridesTable,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: any, value: any) => ({ col, value }),
  asc: () => ({}),
  desc: () => ({}),
  gte: () => ({}),
  lte: () => ({}),
  and: () => ({}),
  sql: (_parts: TemplateStringsArray, ...args: any[]) => {
    const numeric = args.find((a) => typeof a === "number");
    if (typeof numeric === "number") return { __addBalance: numeric };
    return { __raw: true };
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  distributeReferralRewards,
  invalidateReferralLevelsCache,
} from "./referrals";

function seedLevels(active: { 1: boolean; 2: boolean; 3: boolean }) {
  store.levels.set(1, {
    level: 1,
    percentage: 4,
    isActive: active[1],
    updatedAt: new Date(),
  });
  store.levels.set(2, {
    level: 2,
    percentage: 2,
    isActive: active[2],
    updatedAt: new Date(),
  });
  store.levels.set(3, {
    level: 3,
    percentage: 1,
    isActive: active[3],
    updatedAt: new Date(),
  });
}

function seedChain(ids: string[], codes: Record<string, string>) {
  // ids[0] is the rider; ids[i+1] is referrer of ids[i].
  ids.forEach((id, i) => {
    const referrer = ids[i + 1];
    store.users.set(id, {
      id,
      referralCode: codes[id] ?? `CODE-${id}`,
      referredByCode: referrer ? (codes[referrer] ?? `CODE-${referrer}`) : null,
      walletBalance: "0",
    });
  });
}

beforeEach(() => {
  reset();
  invalidateReferralLevelsCache();
});

describe("distributeReferralRewards", () => {
  it("credits up to 3 ancestors with the correct percentages", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider", "L1", "L2", "L3", "L4"], {
      rider: "R",
      L1: "A",
      L2: "B",
      L3: "C",
      L4: "D",
    });

    const res = await distributeReferralRewards({
      rideId: "ride-1",
      payerUserId: "rider",
      rideAmount: 100,
    });

    expect(res.credited.map((c) => [c.userId, c.level, c.amount])).toEqual([
      ["L1", 1, 4],
      ["L2", 2, 2],
      ["L3", 3, 1],
    ]);
    expect(store.earnings).toHaveLength(3);
    expect(store.walletTxns).toHaveLength(3);
    expect(store.walletTxns.every((w) => w.type === "referral")).toBe(true);
    expect(store.users.get("L1")!.walletBalance).toBe("4");
    expect(store.users.get("L2")!.walletBalance).toBe("2");
    expect(store.users.get("L3")!.walletBalance).toBe("1");
    expect(store.users.get("L4")!.walletBalance).toBe("0");
  });

  it("skips inactive levels but continues for higher levels", async () => {
    seedLevels({ 1: true, 2: false, 3: true });
    seedChain(["rider", "L1", "L2", "L3"], {
      rider: "R",
      L1: "A",
      L2: "B",
      L3: "C",
    });

    const res = await distributeReferralRewards({
      rideId: "ride-2",
      payerUserId: "rider",
      rideAmount: 200,
    });

    expect(res.credited.map((c) => c.level)).toEqual([1, 3]);
    expect(store.earnings.find((e) => e.level === 2)).toBeUndefined();
    expect(store.users.get("L2")!.walletBalance).toBe("0");
  });

  it("stops when the chain ends before 3 levels", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider", "L1"], { rider: "R", L1: "A" });

    const res = await distributeReferralRewards({
      rideId: "ride-3",
      payerUserId: "rider",
      rideAmount: 50,
    });

    expect(res.credited).toHaveLength(1);
    expect(res.credited[0].userId).toBe("L1");
  });

  it("breaks on cycles in the referral chain", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    // rider -> A -> B -> A (cycle)
    store.users.set("rider", {
      id: "rider",
      referralCode: "R",
      referredByCode: "CA",
      walletBalance: "0",
    });
    store.users.set("A", {
      id: "A",
      referralCode: "CA",
      referredByCode: "CB",
      walletBalance: "0",
    });
    store.users.set("B", {
      id: "B",
      referralCode: "CB",
      referredByCode: "CA",
      walletBalance: "0",
    });

    const res = await distributeReferralRewards({
      rideId: "ride-4",
      payerUserId: "rider",
      rideAmount: 100,
    });

    // A then B; the third hop would loop back to A and is skipped.
    expect(res.credited.map((c) => c.userId)).toEqual(["A", "B"]);
  });

  it("is idempotent on repeated calls for the same ride", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider", "L1"], { rider: "R", L1: "A" });

    await distributeReferralRewards({
      rideId: "ride-5",
      payerUserId: "rider",
      rideAmount: 100,
    });
    const second = await distributeReferralRewards({
      rideId: "ride-5",
      payerUserId: "rider",
      rideAmount: 100,
    });

    expect(second.credited).toHaveLength(0);
    expect(store.earnings).toHaveLength(1);
    expect(store.walletTxns).toHaveLength(1);
    expect(store.users.get("L1")!.walletBalance).toBe("4");
  });

  it("does nothing when the rider has no referrer", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider"], { rider: "R" });

    const res = await distributeReferralRewards({
      rideId: "ride-6",
      payerUserId: "rider",
      rideAmount: 100,
    });

    expect(res.credited).toHaveLength(0);
    expect(store.earnings).toHaveLength(0);
  });

  it("credits the rider's and the driver's uplines independently for the same ride", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    // Rider chain: rider <- RA <- RB
    // Driver chain: driver <- DA
    // Two separate referral graphs sharing a single rideId.
    store.users.set("rider", {
      id: "rider",
      referralCode: "RIDER",
      referredByCode: "RA",
      walletBalance: "0",
    });
    store.users.set("RA", {
      id: "RA",
      referralCode: "RA",
      referredByCode: "RB",
      walletBalance: "0",
    });
    store.users.set("RB", {
      id: "RB",
      referralCode: "RB",
      referredByCode: null,
      walletBalance: "0",
    });
    store.users.set("driver", {
      id: "driver",
      referralCode: "DRV",
      referredByCode: "DA",
      walletBalance: "0",
    });
    store.users.set("DA", {
      id: "DA",
      referralCode: "DA",
      referredByCode: null,
      walletBalance: "0",
    });

    const riderSide = await distributeReferralRewards({
      rideId: "ride-shared",
      payerUserId: "rider",
      rideAmount: 100,
    });
    const driverSide = await distributeReferralRewards({
      rideId: "ride-shared",
      payerUserId: "driver",
      rideAmount: 100,
    });

    // Rider chain credits L1=RA (4) and L2=RB (2)
    expect(riderSide.credited.map((c) => [c.userId, c.level, c.amount])).toEqual([
      ["RA", 1, 4],
      ["RB", 2, 2],
    ]);
    // Driver chain credits L1=DA (4) — no L2/L3 ancestor
    expect(driverSide.credited.map((c) => [c.userId, c.level, c.amount])).toEqual([
      ["DA", 1, 4],
    ]);
    // Both chains coexist on the same rideId because the unique constraint
    // also includes from_user_id.
    expect(store.earnings).toHaveLength(3);
    expect(store.users.get("RA")!.walletBalance).toBe("4");
    expect(store.users.get("RB")!.walletBalance).toBe("2");
    expect(store.users.get("DA")!.walletBalance).toBe("4");

    // Re-running both sides is still idempotent.
    const retryRider = await distributeReferralRewards({
      rideId: "ride-shared",
      payerUserId: "rider",
      rideAmount: 100,
    });
    const retryDriver = await distributeReferralRewards({
      rideId: "ride-shared",
      payerUserId: "driver",
      rideAmount: 100,
    });
    expect(retryRider.credited).toHaveLength(0);
    expect(retryDriver.credited).toHaveLength(0);
    expect(store.earnings).toHaveLength(3);
  });

  it("rolls back the earning row when wallet write fails, allowing retry", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider", "L1"], { rider: "R", L1: "A" });

    store.failNextWalletInsert = true;
    const failed = await distributeReferralRewards({
      rideId: "ride-fail",
      payerUserId: "rider",
      rideAmount: 100,
    });
    expect(failed.credited).toHaveLength(0);
    expect(store.earnings).toHaveLength(0);
    expect(store.walletTxns).toHaveLength(0);
    expect(store.users.get("L1")!.walletBalance).toBe("0");

    // Subsequent retry must succeed because nothing was committed.
    const retry = await distributeReferralRewards({
      rideId: "ride-fail",
      payerUserId: "rider",
      rideAmount: 100,
    });
    expect(retry.credited).toHaveLength(1);
    expect(store.earnings).toHaveLength(1);
    expect(store.walletTxns).toHaveLength(1);
    expect(store.users.get("L1")!.walletBalance).toBe("4");
  });

  it("does nothing for non-positive ride amounts", async () => {
    seedLevels({ 1: true, 2: true, 3: true });
    seedChain(["rider", "L1"], { rider: "R", L1: "A" });

    const res = await distributeReferralRewards({
      rideId: "ride-7",
      payerUserId: "rider",
      rideAmount: 0,
    });

    expect(res.credited).toHaveLength(0);
  });
});
