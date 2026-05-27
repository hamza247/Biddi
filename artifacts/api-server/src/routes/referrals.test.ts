/**
 * Integration tests for the admin MLM-report endpoints.
 *
 * Covers:
 *  - GET /api/admin/mlm-report/:userId
 *      * empty downline (root has no referees)
 *      * full 3-level tree assembly with parent links + summary counts
 *      * cycle in referral codes is detected and the recursive node is skipped
 *      * earnings split between credited and reversed (only credited counts)
 *      * admin-auth enforcement (401 without bearer, 401 for non-admin token)
 *  - GET /api/admin/mlm-report/search
 *      * matches by first name, phone, email and referral code
 *      * caps the result set at 20
 *
 * Strategy: an in-memory @workspace/db mock services every drizzle chain the
 * route uses, distinguishing them by the chain shape (`.where().limit(1)`,
 * `.where().groupBy()`, `.where().orderBy().limit()` and the bare awaited
 * `.where()` used by the per-level BFS).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Test fixtures — hoisted so vi.mock() factories can close over them.
// ---------------------------------------------------------------------------

type UserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  referralCode: string | null;
  referredByCode: string | null;
  appMode: "rider" | "driver";
  driverStatus: string;
  isActive: boolean;
  createdAt: Date;
};

type EarningRow = {
  id: string;
  userId: string;
  fromUserId: string;
  rideId: string;
  level: number;
  percentage: number;
  amount: number;
  status: "credited" | "reversed";
  createdAt: Date;
};

const { ADMIN_ID, USER_ID, state, resetState, callerStore } = vi.hoisted(() => {
  const ADMIN_ID = "00000000-0000-0000-0000-0000000000ad";
  const USER_ID = "00000000-0000-0000-0000-0000000000a1";
  const state: { users: UserRow[]; earnings: EarningRow[] } = {
    users: [],
    earnings: [],
  };
  function resetState() {
    state.users.length = 0;
    state.earnings.length = 0;
  }
  const callerStore: { sub: string; kind: "user" | "admin" } = {
    sub: ADMIN_ID,
    kind: "admin",
  };
  return { ADMIN_ID, USER_ID, state, resetState, callerStore };
});

// ---------------------------------------------------------------------------
// Helpers to walk drizzle's SQL/Param/Column nodes.
// ---------------------------------------------------------------------------

function extractParamValues(
  node: unknown,
  seen: Set<unknown> = new Set(),
): string[] {
  if (node == null) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (typeof node !== "object") return [];
  if (seen.has(node)) return [];
  seen.add(node);
  const out: string[] = [];
  const obj = node as Record<PropertyKey, unknown>;
  if ("value" in obj && ("encoder" in obj || "brand" in obj)) {
    const v = obj["value"];
    if (v != null && typeof v !== "object") out.push(String(v));
    return out;
  }
  // Skip Drizzle Column/Table descriptors — they leak many irrelevant
  // strings (column name, table name, fk paths) that create false positives.
  if ("columnType" in obj || "_" in obj) return out;

  const isArray = Array.isArray(obj);
  for (const key of Reflect.ownKeys(obj)) {
    let v: unknown;
    try {
      v = obj[key];
    } catch {
      continue;
    }
    if (v && typeof v === "object") {
      out.push(...extractParamValues(v, seen));
    } else if (
      v != null &&
      (typeof v === "string" || typeof v === "number") &&
      (isArray || key === "value")
    ) {
      out.push(String(v));
    }
  }
  return out;
}

function extractStringParams(node: unknown): string[] {
  return extractParamValues(node);
}

// ---------------------------------------------------------------------------
// Mock @workspace/db.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { adminsTable, usersTable, referralEarningsTable, referralLevelsTable } = actual;

  function selectFromUsers() {
    return {
      where(cond: unknown) {
        const params = extractStringParams(cond);
        const result: Record<string, unknown> = {
          // Root user lookup: where(eq(id, userId)).limit(1)
          limit(n: number) {
            const rows = state.users.filter((u) => params.includes(u.id));
            return Promise.resolve(rows.slice(0, n));
          },
          // Direct-referral counts: where(inArray(referredByCode, codes)).groupBy(referredByCode)
          groupBy(_col: unknown) {
            const counts = new Map<string, number>();
            for (const u of state.users) {
              if (u.referredByCode && params.includes(u.referredByCode)) {
                counts.set(u.referredByCode, (counts.get(u.referredByCode) ?? 0) + 1);
              }
            }
            const rows = [...counts.entries()].map(([code, n]) => ({ code, n }));
            return Promise.resolve(rows);
          },
          // Search: where(or(...)).orderBy(desc).limit(n)
          orderBy(_col: unknown) {
            // The search route escapes %/_ then wraps the user's q in %…%.
            // Recover the original q from any param shaped like %…%.
            const wildParam = params.find(
              (p) => typeof p === "string" && p.startsWith("%") && p.endsWith("%"),
            );
            const q = wildParam
              ? wildParam.slice(1, -1).replace(/\\([%_])/g, "$1").toLowerCase()
              : "";
            const matched = q
              ? state.users.filter((u) => {
                  const haystacks = [
                    u.firstName ?? "",
                    u.lastName ?? "",
                    `${u.firstName ?? ""} ${u.lastName ?? ""}`,
                    u.phone ?? "",
                    u.email ?? "",
                    u.referralCode ?? "",
                  ].map((s) => s.toLowerCase());
                  return haystacks.some((h) => h.includes(q));
                })
              : [];
            matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return {
              limit(n: number) {
                return Promise.resolve(matched.slice(0, n));
              },
            };
          },
          // BFS levels: where(inArray(referredByCode, codes)) awaited directly.
          then(
            resolve: (v: UserRow[]) => unknown,
            reject?: (e: unknown) => unknown,
          ) {
            const rows = state.users.filter(
              (u) => u.referredByCode != null && params.includes(u.referredByCode),
            );
            return Promise.resolve(rows).then(resolve, reject);
          },
          catch(reject: (e: unknown) => unknown) {
            return Promise.resolve([]).catch(reject);
          },
        };
        return result;
      },
    };
  }

  function selectFromAdmins() {
    return {
      where(cond: unknown) {
        const params = extractStringParams(cond);
        return {
          limit(n: number) {
            const rows = params.includes(ADMIN_ID) ? [{ id: ADMIN_ID }] : [];
            return Promise.resolve(rows.slice(0, n));
          },
        };
      },
    };
  }

  function selectFromEarnings() {
    return {
      where(cond: unknown) {
        const params = extractStringParams(cond);
        return {
          // Per-user totals split by status: only `credited` rows count.
          groupBy(_col: unknown) {
            const totals = new Map<string, number>();
            for (const e of state.earnings) {
              if (!params.includes(e.userId)) continue;
              if (e.status !== "credited") continue;
              totals.set(e.userId, (totals.get(e.userId) ?? 0) + e.amount);
            }
            const rows = [...totals.entries()].map(([userId, totalEarnings]) => ({
              userId,
              totalEarnings,
            }));
            return Promise.resolve(rows);
          },
        };
      },
    };
  }

  function selectFromLevels() {
    return {
      orderBy(_col: unknown) {
        return Promise.resolve([] as unknown[]);
      },
    };
  }

  const db = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          if (table === usersTable) return selectFromUsers();
          if (table === adminsTable) return selectFromAdmins();
          if (table === referralEarningsTable) return selectFromEarnings();
          if (table === referralLevelsTable) return selectFromLevels();
          // Safe fallback for unexpected joins (the MLM routes don't use any).
          return {
            where: () => ({
              limit: () => Promise.resolve([]),
              groupBy: () => Promise.resolve([]),
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
              then: (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
            }),
            leftJoin: () => ({
              where: () => ({ orderBy: () => Promise.resolve([]) }),
            }),
          };
        },
      };
    },
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock auth so we can swap the bearer's identity per-test.
// ---------------------------------------------------------------------------

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyToken: vi.fn(() => ({ sub: callerStore.sub, kind: callerStore.kind })),
  };
});

// ---------------------------------------------------------------------------
// Import app AFTER mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";
const AUTH = { Authorization: "Bearer fake-admin-token" };

function asAdmin() {
  callerStore.sub = ADMIN_ID;
  callerStore.kind = "admin";
}
function asUser() {
  callerStore.sub = USER_ID;
  callerStore.kind = "user";
}

let userCounter = 0;
function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  userCounter += 1;
  const id =
    overrides.id ??
    `aaaaaaaa-aaaa-aaaa-aaaa-${userCounter.toString().padStart(12, "0")}`;
  return {
    id,
    firstName: overrides.firstName ?? `User${userCounter}`,
    lastName: overrides.lastName ?? "Test",
    phone: overrides.phone ?? `+100000${userCounter.toString().padStart(5, "0")}`,
    email: overrides.email ?? null,
    referralCode: overrides.referralCode ?? null,
    referredByCode: overrides.referredByCode ?? null,
    appMode: overrides.appMode ?? "rider",
    driverStatus: overrides.driverStatus ?? "not_applied",
    isActive: overrides.isActive ?? true,
    createdAt:
      overrides.createdAt ??
      new Date(`2025-01-${String((userCounter % 28) + 1).padStart(2, "0")}T00:00:00Z`),
  };
}

let earningCounter = 0;
function makeEarning(overrides: Partial<EarningRow> & {
  userId: string;
  fromUserId: string;
  amount: number;
  status?: "credited" | "reversed";
  level?: number;
}): EarningRow {
  earningCounter += 1;
  return {
    id: `e-${earningCounter}`,
    userId: overrides.userId,
    fromUserId: overrides.fromUserId,
    rideId: overrides.rideId ?? `r-${earningCounter}`,
    level: overrides.level ?? 1,
    percentage: overrides.percentage ?? 5,
    amount: overrides.amount,
    status: overrides.status ?? "credited",
    createdAt: overrides.createdAt ?? new Date("2025-02-01T00:00:00Z"),
  };
}

// ===========================================================================
// GET /api/admin/mlm-report/:userId
// ===========================================================================

describe("GET /api/admin/mlm-report/:userId", () => {
  beforeEach(() => {
    resetState();
    userCounter = 0;
    earningCounter = 0;
    asAdmin();
  });

  it("returns 401 without an Authorization header", async () => {
    const root = makeUser({ id: USER_ID, referralCode: "ROOT" });
    state.users.push(root);

    const res = await request(app).get(`${BASE}/admin/mlm-report/${USER_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is for a regular user (non-admin)", async () => {
    asUser();
    const root = makeUser({ id: USER_ID, referralCode: "ROOT" });
    state.users.push(root);

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);
    expect(res.status).toBe(401);
  });

  it("returns 400 when the userId path param is not a UUID", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/not-a-uuid`)
      .set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_user_id");
  });

  it("returns 404 when the user does not exist", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });

  it("returns an empty downline when the user has no referees", async () => {
    state.users.push(makeUser({ id: USER_ID, referralCode: "ROOT" }));

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.root.id).toBe(USER_ID);
    expect(res.body.tree).toEqual([]);
    expect(res.body.summary).toMatchObject({
      level1Count: 0,
      level2Count: 0,
      level3Count: 0,
      totalEarnings: 0,
      paidRewards: 0,
      pendingRewards: 0,
    });
  });

  it("builds a full 3-level downline tree with correct parent links and summary", async () => {
    const root = makeUser({ id: USER_ID, referralCode: "ROOT" });
    const l1a = makeUser({ referralCode: "L1A", referredByCode: "ROOT" });
    const l1b = makeUser({ referralCode: "L1B", referredByCode: "ROOT" });
    const l2a = makeUser({ referralCode: "L2A", referredByCode: "L1A" });
    const l2b = makeUser({ referralCode: "L2B", referredByCode: "L1B" });
    const l3a = makeUser({ referralCode: "L3A", referredByCode: "L2A" });
    state.users.push(root, l1a, l1b, l2a, l2b, l3a);

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      level1Count: 2,
      level2Count: 2,
      level3Count: 1,
    });

    const tree = res.body.tree as Array<{
      id: string;
      level: number;
      referredByUserId: string | null;
      directReferrals: number;
      children: Array<{
        id: string;
        level: number;
        referredByUserId: string | null;
        children: Array<{ id: string; level: number; referredByUserId: string | null }>;
      }>;
    }>;
    expect(tree).toHaveLength(2);
    const l1aNode = tree.find((n) => n.id === l1a.id)!;
    const l1bNode = tree.find((n) => n.id === l1b.id)!;
    expect(l1aNode.level).toBe(1);
    expect(l1aNode.referredByUserId).toBe(root.id);
    expect(l1aNode.directReferrals).toBe(1);
    expect(l1aNode.children).toHaveLength(1);

    const l2aNode = l1aNode.children[0];
    expect(l2aNode.id).toBe(l2a.id);
    expect(l2aNode.level).toBe(2);
    expect(l2aNode.referredByUserId).toBe(l1a.id);
    expect(l2aNode.children).toHaveLength(1);

    const l3aNode = l2aNode.children[0];
    expect(l3aNode.id).toBe(l3a.id);
    expect(l3aNode.level).toBe(3);
    expect(l3aNode.referredByUserId).toBe(l2a.id);

    const l2bNode = l1bNode.children[0];
    expect(l2bNode.id).toBe(l2b.id);
    expect(l2bNode.level).toBe(2);
    expect(l2bNode.children).toHaveLength(0);
  });

  it("ignores cycles in referral codes (visited users are not re-emitted)", async () => {
    // Cycle: ROOT → L1 → L2 (whose referralCode is ROOT again). The second
    // appearance of ROOT must NOT be inserted into the tree (visited guard).
    const root = makeUser({ id: USER_ID, referralCode: "ROOT" });
    const l1 = makeUser({ referralCode: "L1", referredByCode: "ROOT" });
    const l2 = makeUser({ referralCode: "ROOT", referredByCode: "L1" });
    state.users.push(root, l1, l2);

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.summary.level1Count).toBe(1);
    expect(res.body.summary.level2Count).toBe(1);
    // Without cycle protection, l1 would re-appear at level 3 because its
    // referredByCode "ROOT" matches l2's referralCode. The visited set must
    // prevent that.
    expect(res.body.summary.level3Count).toBe(0);
  });

  it("counts only credited earnings; reversed earnings are excluded from totals", async () => {
    const root = makeUser({ id: USER_ID, referralCode: "ROOT" });
    const l1 = makeUser({ referralCode: "L1", referredByCode: "ROOT" });
    state.users.push(root, l1);

    state.earnings.push(
      makeEarning({ userId: root.id, fromUserId: l1.id, amount: 10, status: "credited" }),
      makeEarning({ userId: l1.id, fromUserId: l1.id, amount: 7, status: "credited" }),
      makeEarning({ userId: l1.id, fromUserId: l1.id, amount: 3, status: "reversed" }),
    );

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/${USER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    // The reversed 3 must not be counted; only the credited 7 for l1.
    // (Root's own earnings are not part of the downline summary — the route
    // only sums earnings for users in usersByLevel.)
    expect(res.body.summary.totalEarnings).toBeCloseTo(7, 5);
    expect(res.body.summary.paidRewards).toBeCloseTo(7, 5);
    expect(res.body.summary.pendingRewards).toBe(0);

    const l1Node = (res.body.tree as Array<{ id: string; totalEarnings: number; paidRewards: number; pendingRewards: number }>)
      .find((n) => n.id === l1.id)!;
    expect(l1Node.totalEarnings).toBeCloseTo(7, 5);
    expect(l1Node.paidRewards).toBeCloseTo(7, 5);
    expect(l1Node.pendingRewards).toBe(0);
  });
});

// ===========================================================================
// GET /api/admin/mlm-report/search
// ===========================================================================

describe("GET /api/admin/mlm-report/search", () => {
  beforeEach(() => {
    resetState();
    userCounter = 0;
    asAdmin();
  });

  it("returns 401 without an Authorization header", async () => {
    const res = await request(app).get(`${BASE}/admin/mlm-report/search?q=alice`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search`)
      .set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  it("matches by first name", async () => {
    state.users.push(
      makeUser({ firstName: "Alice", lastName: "Wonder" }),
      makeUser({ firstName: "Bob", lastName: "Builder" }),
    );

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search?q=alic`)
      .set(AUTH);

    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ name: string }>;
    expect(results).toHaveLength(1);
    expect(results[0].name).toContain("Alice");
  });

  it("matches by phone", async () => {
    state.users.push(
      makeUser({ firstName: "Alice", phone: "+15551234567" }),
      makeUser({ firstName: "Bob", phone: "+15559999999" }),
    );

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search?q=12345`)
      .set(AUTH);

    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ phone: string | null }>;
    expect(results).toHaveLength(1);
    expect(results[0].phone).toBe("+15551234567");
  });

  it("matches by email", async () => {
    state.users.push(
      makeUser({ firstName: "Alice", email: "alice@example.com" }),
      makeUser({ firstName: "Bob", email: "bob@other.com" }),
    );

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search?q=example.com`)
      .set(AUTH);

    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ email: string | null }>;
    expect(results).toHaveLength(1);
    expect(results[0].email).toBe("alice@example.com");
  });

  it("matches by referral code", async () => {
    state.users.push(
      makeUser({ firstName: "Alice", referralCode: "ALICE123" }),
      makeUser({ firstName: "Bob", referralCode: "BOBXYZ" }),
    );

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search?q=alice12`)
      .set(AUTH);

    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ referralCode: string | null }>;
    expect(results).toHaveLength(1);
    expect(results[0].referralCode).toBe("ALICE123");
  });

  it("caps the result set at 20 even when many users match", async () => {
    // 25 users that all match "match".
    for (let i = 0; i < 25; i++) {
      state.users.push(makeUser({ firstName: `match${i}`, lastName: "User" }));
    }

    const res = await request(app)
      .get(`${BASE}/admin/mlm-report/search?q=match`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect((res.body.results as unknown[]).length).toBe(20);
  });
});
