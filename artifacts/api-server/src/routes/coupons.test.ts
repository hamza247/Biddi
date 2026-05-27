/**
 * Coupon redemption tests.
 *
 * Covers the money-critical coupon flow end-to-end across three layers:
 *
 *  1. Pure unit tests for `computeCouponDiscount` (percentage/fixed, caps,
 *     never-negative invariants).
 *  2. Unit tests for `validateCoupon` covering every CouponInvalidCode
 *     reason + the happy path. Uses an in-memory db mock for the
 *     first-ride and per-user-cap lookups.
 *  3. HTTP integration tests for POST /coupons/validate (rider-side
 *     preview).
 *  4. HTTP integration tests for the atomic redemption-on-completion
 *     transaction in POST /rides/:id/complete:
 *       - exactly one redemption row inserted on success
 *       - coupons.totalUsed incremented by exactly 1
 *       - per-user cap re-checked inside the transaction (concurrency)
 *       - global cap re-checked inside the transaction (concurrency)
 *       - cancelled rides never insert a redemption
 *       - completion-time validation failure → ride completes without
 *         a discount, no redemption, no totalUsed change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Identifiers + in-memory stores — hoisted so vi.mock factories see them.
// ---------------------------------------------------------------------------

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscount: number | null;
  minTripAmount: number | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  totalUsed: number;
  validFrom: Date | null;
  validUntil: Date | null;
  firstRideOnly: boolean;
  countryCodes: string[] | null;
  vehicleTypeIds: string[] | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RedemptionRow = {
  id: string;
  couponId: string;
  userId: string;
  rideId: string;
  discountAmount: number;
  redeemedAt: Date;
};

type RideRow = {
  id: string;
  riderId: string;
  acceptedDriverId: string | null;
  acceptedBidId: string | null;
  status: string;
  pickupLat: number | null;
  pickupLng: number | null;
  vehicleTypeId: string | null;
  paymentMethod: string;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  inTransitWaitingMin: number | null;
  finalAmount: number | null;
  fareBreakdown: unknown;
  couponId: string | null;
  couponDiscount: number | null;
  sharedGroupId: string | null;
  pickupAddress: string;
  dropoffAddress: string;
};

type BidRow = { id: string; rideId: string; amount: number };

type UserRow = {
  id: string;
  firstName: string;
  countryCode: string | null;
  walletBalance: string;
  rating: string;
};

type EarningRow = { id: string; rideId: string };

const {
  RIDER_ID,
  DRIVER_ID,
  RIDE_ID,
  BID_ID,
  COUPON_ID,
  couponStore,
  redemptionStore,
  rideStore,
  bidStore,
  userStore,
  earningsStore,
  completedRideCountForRider,
  forUpdateCalls,
  resetStores,
} = vi.hoisted(() => {
  const RIDER_ID = "11111111-1111-1111-1111-111111111111";
  const DRIVER_ID = "22222222-2222-2222-2222-222222222222";
  const RIDE_ID = "33333333-3333-3333-3333-333333333333";
  const BID_ID = "44444444-4444-4444-4444-444444444444";
  const COUPON_ID = "55555555-5555-5555-5555-555555555555";

  const couponStore: Map<string, CouponRow> = new Map();
  const redemptionStore: RedemptionRow[] = [];
  const rideStore: Map<string, RideRow> = new Map();
  const bidStore: Map<string, BidRow> = new Map();
  const userStore: Map<string, UserRow> = new Map();
  const earningsStore: EarningRow[] = [];
  const completedRideCountForRider: { value: number } = { value: 0 };
  const forUpdateCalls: { value: number } = { value: 0 };

  function resetStores() {
    couponStore.clear();
    redemptionStore.length = 0;
    rideStore.clear();
    bidStore.clear();
    userStore.clear();
    earningsStore.length = 0;
    completedRideCountForRider.value = 0;
    forUpdateCalls.value = 0;

    userStore.set(RIDER_ID, {
      id: RIDER_ID,
      firstName: "Rider",
      countryCode: "+1",
      walletBalance: "0",
      rating: "5.0",
    });
    userStore.set(DRIVER_ID, {
      id: DRIVER_ID,
      firstName: "Driver",
      countryCode: "+1",
      walletBalance: "0",
      rating: "5.0",
    });
  }

  return {
    RIDER_ID,
    DRIVER_ID,
    RIDE_ID,
    BID_ID,
    COUPON_ID,
    couponStore,
    redemptionStore,
    rideStore,
    bidStore,
    userStore,
    earningsStore,
    completedRideCountForRider,
    forUpdateCalls,
    resetStores,
  };
});

function makeCoupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: COUPON_ID,
    code: "WELCOME10",
    description: null,
    discountType: "percentage",
    discountValue: 10,
    maxDiscount: null,
    minTripAmount: null,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    totalUsed: 0,
    validFrom: null,
    validUntil: null,
    firstRideOnly: false,
    countryCodes: null,
    vehicleTypeIds: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRide(overrides: Partial<RideRow> = {}): RideRow {
  return {
    id: RIDE_ID,
    riderId: RIDER_ID,
    acceptedDriverId: DRIVER_ID,
    acceptedBidId: BID_ID,
    status: "in_progress",
    pickupLat: null,
    pickupLng: null,
    vehicleTypeId: null,
    paymentMethod: "cash",
    estimatedDistanceKm: 5,
    estimatedDurationMin: 15,
    inTransitWaitingMin: 0,
    finalAmount: null,
    fareBreakdown: null,
    couponId: null,
    couponDiscount: null,
    sharedGroupId: null,
    pickupAddress: "A",
    dropoffAddress: "B",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const {
    couponsTable,
    couponRedemptionsTable,
    ridesTable,
    bidsTable,
    usersTable,
    earningsTable,
    adminsTable,
    vehicleTypesTable,
    tripMessagesTable,
    restrictedAreasTable,
    serviceAreasTable,
    rideDispatchLogsTable,
    walletTransactionsTable,
    commissionExemptionsTable,
    cancellationReasonsTable,
    vehiclesTable,
  } = actual;
  // Suppress unused-vars; these are referenced in fallback dispatch.
  void restrictedAreasTable;
  void serviceAreasTable;
  void rideDispatchLogsTable;
  void walletTransactionsTable;
  void commissionExemptionsTable;
  void cancellationReasonsTable;
  void vehiclesTable;

  // Walk a drizzle SQL/condition object and pull all literal Param values.
  // Recurses into any nested object/array because the exact shape (Param,
  // SQL, Placeholder, etc.) varies across drizzle helpers.
  function extractParamValues(
    node: unknown,
    seen: Set<unknown> = new Set(),
  ): string[] {
    if (node == null) return [];
    // Raw chunks (strings/numbers) are emitted directly into queryChunks by
    // drizzle's sql tag for interpolated values, so capture them too.
    if (typeof node === "string" || typeof node === "number") {
      return [String(node)];
    }
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
    // strings (column name, table name, fk paths) that would create false
    // positives in the param set.
    if ("columnType" in obj || "_" in obj) {
      return out;
    }
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
        // Pick up raw interpolated chunks inside arrays (queryChunks),
        // and explicit `value` properties on Param-like wrappers, but skip
        // arbitrary string fields like `name`/`brand` to avoid false hits.
        (isArray || key === "value")
      ) {
        out.push(String(v));
      }
    }
    return out;
  }

  function makeCountAwareSelect<T>(
    rowsFn: (params: Set<string>) => T[],
    isCount: boolean,
  ): unknown {
    const builder: Record<string, unknown> = {};
    let capturedParams = new Set<string>();
    builder["where"] = (cond: unknown) => {
      capturedParams = new Set(extractParamValues(cond));
      const out: Record<string, unknown> = {};
      out["limit"] = (n: number) => {
        const rows = rowsFn(capturedParams);
        if (isCount) return Promise.resolve([{ value: rows.length }]);
        return Promise.resolve(rows.slice(0, n));
      };
      // For count queries the route doesn't always call .limit().
      // Make the where() chain itself awaitable in that case.
      if (isCount) {
        const rows = rowsFn(capturedParams);
        const result = [{ value: rows.length }];
        // Allow `await db.select(...).from(...).where(...)` to resolve.
        out["then"] = (
          onFulfilled: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected);
      }
      return out;
    };
    builder["limit"] = (_n: number) => Promise.resolve([]);
    return builder;
  }

  function makeDb(transactional = false): unknown {
    const dbObj: Record<string, unknown> = {};

    dbObj["select"] = (fields?: Record<string, unknown>) => {
      const isCount =
        !!fields &&
        Object.values(fields).some(
          (v) =>
            v &&
            typeof v === "object" &&
            "queryChunks" in (v as Record<string, unknown>),
        );
      return {
        from(table: unknown) {
          if (table === couponsTable) {
            return {
              where(cond: unknown) {
                const params = new Set(
                  extractParamValues(cond).map((s) => s.toLowerCase()),
                );
                const rows = [...couponStore.values()].filter(
                  (c) =>
                    params.has(c.id.toLowerCase()) ||
                    params.has(c.code.toLowerCase()),
                );
                return {
                  for(_mode: string) {
                    forUpdateCalls.value += 1;
                    return {
                      limit(n: number) {
                        return Promise.resolve(rows.slice(0, n));
                      },
                    };
                  },
                  limit(n: number) {
                    return Promise.resolve(rows.slice(0, n));
                  },
                };
              },
            };
          }

          if (table === couponRedemptionsTable) {
            return makeCountAwareSelect((params) => {
              return redemptionStore.filter(
                (r) => params.has(r.couponId) && params.has(r.userId),
              );
            }, isCount);
          }

          if (table === ridesTable) {
            // Two shapes:
            //  - count of completed rides for first-ride check
            //  - select * by id with limit(1)
            if (isCount) {
              return makeCountAwareSelect(
                (_params) =>
                  Array.from({ length: completedRideCountForRider.value }),
                true,
              );
            }
            return {
              where(cond: unknown) {
                const params = new Set(extractParamValues(cond));
                const rows = [...rideStore.values()].filter((r) =>
                  params.has(r.id),
                );
                return {
                  limit: (n: number) => Promise.resolve(rows.slice(0, n)),
                  // POST /rides awaits .where(...) directly (no .limit()) for
                  // the active-rides cancellation query — return all rows.
                  then: (
                    onFulfilled: (v: unknown) => unknown,
                    onRejected?: (e: unknown) => unknown,
                  ) => Promise.resolve(rows).then(onFulfilled, onRejected),
                };
              },
            };
          }

          if (table === bidsTable) {
            return {
              where(cond: unknown) {
                const params = new Set(extractParamValues(cond));
                const rows = [...bidStore.values()].filter((b) =>
                  params.has(b.id) || params.has(b.rideId),
                );
                return {
                  limit: (n: number) => Promise.resolve(rows.slice(0, n)),
                };
              },
            };
          }

          if (table === usersTable) {
            // Build a chain that supports both the simple where().limit() shape
            // (used everywhere) AND the leftJoin().leftJoin().where().groupBy()
            // shape used by the dispatch query in POST /rides. The join shape
            // always resolves to an empty driver list so dispatch is a no-op.
            const joinedChain: Record<string, unknown> = {};
            joinedChain["leftJoin"] = () => joinedChain;
            joinedChain["innerJoin"] = () => joinedChain;
            joinedChain["where"] = () => joinedChain;
            joinedChain["groupBy"] = () => joinedChain;
            joinedChain["orderBy"] = () => joinedChain;
            joinedChain["limit"] = () => Promise.resolve([]);
            joinedChain["then"] = (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve([]).then(onFulfilled, onRejected);
            return {
              leftJoin: () => joinedChain,
              innerJoin: () => joinedChain,
              where(cond: unknown) {
                const params = new Set(extractParamValues(cond));
                const rows = [...userStore.values()].filter((u) =>
                  params.has(u.id),
                );
                return {
                  limit: (n: number) => Promise.resolve(rows.slice(0, n)),
                };
              },
            };
          }

          if (table === earningsTable) {
            return {
              where(cond: unknown) {
                const params = new Set(extractParamValues(cond));
                const rows = earningsStore.filter((e) => params.has(e.rideId));
                return {
                  limit: (n: number) => Promise.resolve(rows.slice(0, n)),
                };
              },
            };
          }

          if (table === adminsTable || table === vehicleTypesTable) {
            const chain: Record<string, unknown> = {
              where: () => chain,
              orderBy: () => chain,
              limit: () => Promise.resolve([]),
            };
            return chain;
          }

          if (table === tripMessagesTable) {
            const empty: unknown[] = [];
            const chain: Record<string, unknown> = {
              where: () => chain,
              orderBy: () => chain,
              limit: () => Promise.resolve(empty),
              then: (
                onFulfilled: (v: unknown) => unknown,
                onRejected?: (e: unknown) => unknown,
              ) => Promise.resolve(empty).then(onFulfilled, onRejected),
            };
            return chain;
          }

          const fallback: Record<string, unknown> = {
            where: () => fallback,
            orderBy: () => fallback,
            groupBy: () => fallback,
            innerJoin: () => fallback,
            leftJoin: () => fallback,
            limit: () => Promise.resolve([]),
            for: () => ({ limit: () => Promise.resolve([]) }),
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve([]).then(onFulfilled, onRejected),
          };
          return fallback;
        },
      };
    };

    dbObj["insert"] = (table: unknown) => ({
      values(data: Record<string, unknown>) {
        if (table === couponRedemptionsTable) {
          // Enforce the unique(rideId) constraint that the real schema has —
          // duplicate insert for the same ride must fail and abort the tx.
          if (redemptionStore.some((r) => r.rideId === data["rideId"])) {
            throw new Error(
              "duplicate key value violates unique constraint coupon_redemptions_ride_unique",
            );
          }
          const row: RedemptionRow = {
            id: `red-${redemptionStore.length + 1}`,
            couponId: String(data["couponId"]),
            userId: String(data["userId"]),
            rideId: String(data["rideId"]),
            discountAmount: Number(data["discountAmount"]),
            redeemedAt: new Date(),
          };
          redemptionStore.push(row);
          return Promise.resolve();
        }
        if (table === earningsTable) {
          earningsStore.push({
            id: `e-${earningsStore.length + 1}`,
            rideId: String(data["rideId"]),
          });
          return Promise.resolve();
        }
        if (table === ridesTable) {
          // POST /rides creates a brand-new ride row and destructures
          // `[ride]` from the .returning() result. Persist into rideStore so
          // subsequent re-fetches and update queries see the same row.
          const id = `new-ride-${rideStore.size + 1}`;
          const row = {
            id,
            riderId: String(data["riderId"] ?? RIDER_ID),
            acceptedDriverId: null,
            acceptedBidId: null,
            status: "bidding",
            pickupLat: (data["pickupLat"] ?? null) as number | null,
            pickupLng: (data["pickupLng"] ?? null) as number | null,
            vehicleTypeId: (data["vehicleTypeId"] ?? null) as string | null,
            paymentMethod: String(data["paymentMethod"] ?? "cash"),
            estimatedDistanceKm: Number(data["estimatedDistanceKm"] ?? 5),
            estimatedDurationMin: Number(data["estimatedDurationMin"] ?? 15),
            inTransitWaitingMin: 0,
            finalAmount: null,
            fareBreakdown: data["fareBreakdown"] ?? null,
            couponId: (data["couponId"] ?? null) as string | null,
            couponDiscount: null,
            sharedGroupId: null,
            pickupAddress: String(data["pickupAddress"] ?? ""),
            dropoffAddress: String(data["dropoffAddress"] ?? ""),
            // Extra fields the response payload reads through.
            pickupLabel: String(data["pickupLabel"] ?? ""),
            dropoffLabel: String(data["dropoffLabel"] ?? ""),
            dropoffLat: (data["dropoffLat"] ?? null) as number | null,
            dropoffLng: (data["dropoffLng"] ?? null) as number | null,
            routePolyline: (data["routePolyline"] ?? null) as string | null,
            initialFare: (data["initialFare"] ?? null) as number | null,
            vehicleClass: (data["vehicleClass"] ?? null) as string | null,
            isShared: !!data["isShared"],
            seatsRequested: Number(data["seatsRequested"] ?? 1),
            wheelchairRequested: !!data["wheelchairRequested"],
            petRequested: !!data["petRequested"],
            assistRequested: !!data["assistRequested"],
            createdAt: new Date(),
          } as unknown as RideRow & Record<string, unknown>;
          rideStore.set(id, row);
          // Awaitable directly AND via .returning(); some call sites use
          // either form.
          const result = [row];
          return {
            returning: () => Promise.resolve(result),
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve(result).then(onFulfilled, onRejected),
          };
        }
        // Generic insert (dispatch logs, wallet txns, etc.) — accept and
        // discard. Make it both awaitable and `.returning()`-compatible.
        return {
          returning: () => Promise.resolve([]),
          then: (
            onFulfilled: (v: unknown) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
        };
      },
    });

    dbObj["delete"] = (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    });

    dbObj["update"] = (table: unknown) => ({
      set(data: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            const params = new Set(extractParamValues(cond));
            if (table === couponsTable) {
              for (const c of couponStore.values()) {
                if (params.has(c.id)) {
                  // Apply totalUsed += 1 (the route uses sql`... + 1`).
                  if ("totalUsed" in data) {
                    c.totalUsed += 1;
                  }
                  if ("active" in data) c.active = data["active"] as boolean;
                  if ("updatedAt" in data) c.updatedAt = data["updatedAt"] as Date;
                }
              }
              return {
                returning: () => Promise.resolve([]),
              };
            }
            if (table === ridesTable) {
              const ride = [...rideStore.values()].find((r) =>
                params.has(r.id),
              );
              if (ride) {
                Object.assign(ride, data);
              }
              return {
                returning: () => Promise.resolve(ride ? [ride] : []),
              };
            }
            return Promise.resolve();
          },
        };
      },
    });

    if (!transactional) {
      dbObj["transaction"] = async (
        cb: (tx: unknown) => Promise<unknown>,
      ) => {
        // Snapshot mutable state so a thrown error rolls back atomically.
        const snapshot = {
          coupons: new Map(
            [...couponStore.entries()].map(([k, v]) => [k, { ...v }]),
          ),
          redemptions: redemptionStore.map((r) => ({ ...r })),
        };
        const tx = makeDb(true);
        try {
          const result = await cb(tx);
          return result;
        } catch (err) {
          // Roll back
          couponStore.clear();
          for (const [k, v] of snapshot.coupons) couponStore.set(k, v);
          redemptionStore.length = 0;
          for (const r of snapshot.redemptions) redemptionStore.push(r);
          throw err;
        }
      };
    }

    return dbObj;
  }

  return { ...actual, db: makeDb() };
});

// ---------------------------------------------------------------------------
// Mock auth — accept a fake bearer token for the rider/driver.
// ---------------------------------------------------------------------------

const { callerStore } = vi.hoisted(() => ({
  callerStore: { userId: "11111111-1111-1111-1111-111111111111" as string },
}));

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyToken: vi.fn().mockImplementation(() => ({
      sub: callerStore.userId,
      kind: "user",
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock side-effect heavy collaborators so the /complete handler can run
// without touching real services.
// ---------------------------------------------------------------------------

vi.mock("../lib/io", () => ({
  emitToRide: vi.fn(),
  emitToUser: vi.fn(),
  isUserSocketConnected: vi.fn(() => false),
  isUserInChat: vi.fn(() => false),
  getChatPeers: vi.fn(() => []),
  getDriverLivePosition: vi.fn(() => null),
  haversineKm: vi.fn(() => 0),
  initIO: vi.fn(),
  getIO: vi.fn(() => null),
}));

vi.mock("../lib/push", () => ({
  sendPushFromTemplate: vi.fn(async () => undefined),
}));

vi.mock("../lib/weather", () => ({
  resolveWeatherSurcharge: vi.fn(async () => null),
}));

vi.mock("../lib/maps", () => ({
  osrmRoute: vi.fn(async () => null),
}));

vi.mock("../lib/driverRating", () => ({
  recomputeAndStoreDriverRating: vi.fn(async () => undefined),
}));

vi.mock("../lib/driverStats", () => ({
  invalidateDriverRates: vi.fn(),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn();
    getObjectEntityUploadURL = vi.fn();
    normalizeObjectEntityPath = vi.fn();
    trySetObjectEntityAclPolicy = vi.fn();
  },
}));

// ---------------------------------------------------------------------------
// Import app + helpers AFTER mocks are wired.
// ---------------------------------------------------------------------------

import app from "../app";
import {
  computeCouponDiscount,
  validateCoupon,
} from "../lib/coupons";

const BASE = "/api";
const AUTH = { Authorization: "Bearer fake-test-token" };

// ===========================================================================
// 1. Pure unit tests — computeCouponDiscount
// ===========================================================================

describe("computeCouponDiscount (unit)", () => {
  it("returns 0 for non-positive subtotals", () => {
    expect(computeCouponDiscount(makeCoupon(), 0)).toBe(0);
    expect(computeCouponDiscount(makeCoupon(), -5)).toBe(0);
  });

  it("applies percentage discount", () => {
    const c = makeCoupon({ discountType: "percentage", discountValue: 10 });
    expect(computeCouponDiscount(c, 50)).toBe(5);
  });

  it("applies fixed discount", () => {
    const c = makeCoupon({ discountType: "fixed", discountValue: 7 });
    expect(computeCouponDiscount(c, 50)).toBe(7);
  });

  it("caps percentage discount at maxDiscount", () => {
    const c = makeCoupon({
      discountType: "percentage",
      discountValue: 50,
      maxDiscount: 10,
    });
    expect(computeCouponDiscount(c, 100)).toBe(10);
  });

  it("never exceeds the subtotal (fixed coupon larger than fare)", () => {
    const c = makeCoupon({ discountType: "fixed", discountValue: 100 });
    expect(computeCouponDiscount(c, 8)).toBe(8);
  });

  it("rounds to two decimals", () => {
    const c = makeCoupon({ discountType: "percentage", discountValue: 33 });
    // 33% of 9.99 = 3.2967 → 3.30
    expect(computeCouponDiscount(c, 9.99)).toBe(3.3);
  });
});

// ===========================================================================
// 2. validateCoupon — every CouponInvalidCode + happy path
// ===========================================================================

describe("validateCoupon (unit)", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("returns not_found when coupon is null", async () => {
    const res = await validateCoupon({
      coupon: null,
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("returns inactive for disabled coupons", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ active: false }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "inactive" });
  });

  it("returns not_yet_valid before validFrom", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ validFrom: new Date(Date.now() + 60_000) }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "not_yet_valid" });
  });

  it("returns expired after validUntil", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ validUntil: new Date(Date.now() - 60_000) }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "expired" });
  });

  it("returns minimum_not_met when subtotal is below minTripAmount", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ minTripAmount: 25 }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 10,
    });
    expect(res).toEqual({ ok: false, code: "minimum_not_met" });
  });

  it("returns invalid_country when rider country is not in the allow-list", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ countryCodes: ["+212"] }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "invalid_country" });
  });

  it("returns invalid_vehicle_type when category is not allowed", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ vehicleTypeIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "invalid_vehicle_type" });
  });

  it("returns first_ride_only_violation when rider already has a completed ride", async () => {
    completedRideCountForRider.value = 1;
    const res = await validateCoupon({
      coupon: makeCoupon({ firstRideOnly: true }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "first_ride_only_violation" });
  });

  it("returns limit_reached when the global cap is exhausted", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ usageLimitTotal: 100, totalUsed: 100 }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "limit_reached" });
  });

  it("returns per_user_limit_reached when this rider has already redeemed it the maximum times", async () => {
    couponStore.set(COUPON_ID, makeCoupon({ usageLimitPerUser: 1 }));
    redemptionStore.push({
      id: "prev",
      couponId: COUPON_ID,
      userId: RIDER_ID,
      rideId: "old-ride",
      discountAmount: 5,
      redeemedAt: new Date(),
    });
    const res = await validateCoupon({
      coupon: makeCoupon({ usageLimitPerUser: 1 }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 20,
    });
    expect(res).toEqual({ ok: false, code: "per_user_limit_reached" });
  });

  it("returns ok with the projected discount on the happy path", async () => {
    const res = await validateCoupon({
      coupon: makeCoupon({ discountType: "percentage", discountValue: 20 }),
      riderId: RIDER_ID,
      riderCountryCode: "+1",
      vehicleTypeId: null,
      estimatedSubtotal: 50,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.discount).toBe(10);
      expect(res.coupon.code).toBe("WELCOME10");
    }
  });
});

// ===========================================================================
// 3. POST /coupons/validate — HTTP integration
// ===========================================================================

describe("POST /coupons/validate (HTTP)", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post(`${BASE}/coupons/validate`)
      .send({ code: "WELCOME10", estimatedSubtotal: 20 });
    expect(res.status).toBe(401);
  });

  it("returns 422 with the typed reason for an unknown code", async () => {
    const res = await request(app)
      .post(`${BASE}/coupons/validate`)
      .set(AUTH)
      .send({ code: "NOPE", estimatedSubtotal: 20 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 422 expired when the coupon's validity window has passed", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({ validUntil: new Date(Date.now() - 60_000) }),
    );
    const res = await request(app)
      .post(`${BASE}/coupons/validate`)
      .set(AUTH)
      .send({ code: "WELCOME10", estimatedSubtotal: 20 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("expired");
  });

  it("returns the projected discount on success", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({ discountType: "fixed", discountValue: 4 }),
    );
    const res = await request(app)
      .post(`${BASE}/coupons/validate`)
      .set(AUTH)
      .send({ code: "WELCOME10", estimatedSubtotal: 20 });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("WELCOME10");
    expect(res.body.discount).toBe(4);
  });
});

// ===========================================================================
// 4. POST /rides/:id/complete — atomic redemption transaction
// ===========================================================================

describe("POST /rides/:id/complete coupon redemption", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = DRIVER_ID;
    bidStore.set(BID_ID, { id: BID_ID, rideId: RIDE_ID, amount: 25 });
  });

  it("inserts exactly one redemption row and increments totalUsed atomically", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({ discountType: "fixed", discountValue: 5, totalUsed: 0 }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );

    const res = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(redemptionStore).toHaveLength(1);
    expect(redemptionStore[0]).toMatchObject({
      couponId: COUPON_ID,
      userId: RIDER_ID,
      rideId: RIDE_ID,
      discountAmount: 5,
    });
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(1);
    // The redemption transaction must use a row-level lock (FOR UPDATE) so
    // concurrent completions can't race past the cap re-check.
    expect(forUpdateCalls.value).toBeGreaterThanOrEqual(1);
    // Ride was marked completed and the persisted couponId/discount match.
    const updated = rideStore.get(RIDE_ID)!;
    expect(updated.status).toBe("completed");
    expect(updated.couponId).toBe(COUPON_ID);
    expect(updated.couponDiscount).toBe(5);
  });

  it("does NOT insert a redemption when the global cap is already reached (concurrency-safe re-check)", async () => {
    // Coupon is at its global cap when /complete runs. The transaction's
    // re-check must abort before inserting and before incrementing totalUsed.
    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        usageLimitTotal: 3,
        totalUsed: 3,
      }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );

    const res = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});

    // Trip still completes (handler logs and proceeds without a discount).
    expect(res.status).toBe(200);
    expect(redemptionStore).toHaveLength(0);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(3);
    const updated = rideStore.get(RIDE_ID)!;
    expect(updated.status).toBe("completed");
    expect(updated.couponId).toBeNull();
    expect(updated.couponDiscount).toBeNull();
  });

  it("does NOT insert a redemption when the per-user cap is already reached", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        usageLimitPerUser: 1,
        totalUsed: 7,
      }),
    );
    // Rider already has one redemption for this coupon.
    redemptionStore.push({
      id: "previous",
      couponId: COUPON_ID,
      userId: RIDER_ID,
      rideId: "an-older-ride",
      discountAmount: 5,
      redeemedAt: new Date(),
    });
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );

    const res = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(200);
    // Only the original redemption remains; no new one was inserted.
    expect(redemptionStore).toHaveLength(1);
    expect(redemptionStore[0].rideId).toBe("an-older-ride");
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(7);
  });

  it("does NOT redeem an inactive coupon at completion time", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        active: false,
      }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );

    const res = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(redemptionStore).toHaveLength(0);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(0);
  });

  it("does not consume a redemption when the trip is cancelled (only /complete inserts)", async () => {
    // A cancelled ride never goes through /complete. Calling /complete on it
    // must not transition it to completed nor insert a redemption — proving
    // the redemption is gated strictly on the completion transition.
    couponStore.set(
      COUPON_ID,
      makeCoupon({ discountType: "fixed", discountValue: 5 }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({
        couponId: COUPON_ID,
        paymentMethod: "card",
        status: "cancelled",
      }),
    );

    const res = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});

    // The handler returns 409 for a non in_progress ride that wasn't already
    // completed. Either way, no redemption row is inserted and the coupon
    // counter is unchanged.
    expect([200, 409]).toContain(res.status);
    expect(redemptionStore).toHaveLength(0);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(0);
    expect(rideStore.get(RIDE_ID)!.status).toBe("cancelled");
  });

  it("enforces the global cap under concurrent completions: only one redemption succeeds", async () => {
    // Two different in-progress rides for two different riders, both
    // attempting to redeem a coupon with usageLimitTotal=1. The second
    // completion's transaction must observe totalUsed >= cap and abort.
    const RIDER_2 = "99999999-9999-9999-9999-999999999999";
    const RIDE_2 = "88888888-8888-8888-8888-888888888888";
    const BID_2 = "77777777-7777-7777-7777-777777777777";
    userStore.set(RIDER_2, {
      id: RIDER_2,
      firstName: "Other",
      countryCode: "+1",
      walletBalance: "0",
      rating: "5",
    });
    bidStore.set(BID_2, { id: BID_2, rideId: RIDE_2, amount: 25 });

    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        usageLimitTotal: 1,
        totalUsed: 0,
      }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );
    rideStore.set(
      RIDE_2,
      makeRide({
        id: RIDE_2,
        riderId: RIDER_2,
        acceptedBidId: BID_2,
        couponId: COUPON_ID,
        paymentMethod: "card",
      }),
    );

    // Drive both completions sequentially (the mock db.transaction runs
    // synchronously). The first must redeem, the second must observe the
    // exhausted cap and abort.
    callerStore.userId = DRIVER_ID;
    const r1 = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});
    const r2 = await request(app)
      .post(`${BASE}/rides/${RIDE_2}/complete`)
      .set(AUTH)
      .send({});

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Exactly one redemption row, totalUsed exactly 1.
    expect(redemptionStore).toHaveLength(1);
    expect(redemptionStore[0].rideId).toBe(RIDE_ID);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(1);
    // Second ride completed without a discount — coupon is dropped from it.
    expect(rideStore.get(RIDE_2)!.status).toBe("completed");
    expect(rideStore.get(RIDE_2)!.couponId).toBeNull();
  });

  it("enforces the per-user cap under concurrent completions: only one redemption per rider succeeds", async () => {
    // Same rider, two distinct in-progress rides, both attempting to redeem
    // a coupon with usageLimitPerUser=1. The second completion's
    // transaction must observe the per-user count at 1 and abort, even
    // though the global cap is far from exhausted.
    const RIDE_2 = "88888888-8888-8888-8888-888888888888";
    const BID_2 = "77777777-7777-7777-7777-777777777777";
    bidStore.set(BID_2, { id: BID_2, rideId: RIDE_2, amount: 25 });

    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        usageLimitPerUser: 1,
        usageLimitTotal: 100,
        totalUsed: 0,
      }),
    );
    rideStore.set(
      RIDE_ID,
      makeRide({ couponId: COUPON_ID, paymentMethod: "card" }),
    );
    rideStore.set(
      RIDE_2,
      makeRide({
        id: RIDE_2,
        // Same rider as RIDE_ID — the per-user cap is the gate.
        riderId: RIDER_ID,
        acceptedBidId: BID_2,
        couponId: COUPON_ID,
        paymentMethod: "card",
      }),
    );

    callerStore.userId = DRIVER_ID;
    const r1 = await request(app)
      .post(`${BASE}/rides/${RIDE_ID}/complete`)
      .set(AUTH)
      .send({});
    const r2 = await request(app)
      .post(`${BASE}/rides/${RIDE_2}/complete`)
      .set(AUTH)
      .send({});

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Exactly one redemption row (for the first ride) and totalUsed = 1.
    expect(redemptionStore).toHaveLength(1);
    expect(redemptionStore[0].rideId).toBe(RIDE_ID);
    expect(redemptionStore[0].userId).toBe(RIDER_ID);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(1);
    // Both rides completed; only the first carries the coupon.
    expect(rideStore.get(RIDE_ID)!.status).toBe("completed");
    expect(rideStore.get(RIDE_ID)!.couponId).toBe(COUPON_ID);
    expect(rideStore.get(RIDE_2)!.status).toBe("completed");
    expect(rideStore.get(RIDE_2)!.couponId).toBeNull();
    // Each completion should have taken a row-level lock (FOR UPDATE) so the
    // cap re-check is serialized in production.
    expect(forUpdateCalls.value).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 5. POST /rides — booking attaches a valid coupon to the new ride
// ===========================================================================

describe("POST /rides booking flow attaches coupon", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("attaches a valid coupon to the newly created ride and pins the projected discount", async () => {
    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        usageLimitTotal: 100,
        totalUsed: 0,
      }),
    );

    const res = await request(app)
      .post(`${BASE}/rides`)
      .set(AUTH)
      .send({
        pickupLabel: "Home",
        pickupAddress: "1 Main St",
        dropoffLabel: "Work",
        dropoffAddress: "2 Market St",
        estimatedDistanceKm: 5,
        estimatedDurationMin: 15,
        paymentMethod: "card",
        couponId: COUPON_ID,
      });

    expect([200, 201]).toContain(res.status);
    // The ride row must persist the coupon binding so the /complete
    // transaction has something to redeem.
    const inserted = [...rideStore.values()].find(
      (r) => r.couponId === COUPON_ID,
    );
    expect(inserted).toBeDefined();
    expect(inserted!.riderId).toBe(RIDER_ID);
    // Booking is non-redeeming: no rows in coupon_redemptions yet, no
    // increment to totalUsed.
    expect(redemptionStore).toHaveLength(0);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(0);
    // The pinned fareBreakdown reflects the coupon preview so the rider's
    // quote already shows the discount.
    const fb = inserted!.fareBreakdown as {
      couponCode?: string;
      couponDiscount?: number;
    } | null;
    expect(fb).not.toBeNull();
    expect(fb!.couponCode).toBe("WELCOME10");
    expect(fb!.couponDiscount).toBe(5);
  });

  it("rejects an invalid coupon at booking time without creating a ride", async () => {
    // Coupon exists but is inactive — booking must surface the typed
    // failure reason and never create a ride row.
    couponStore.set(
      COUPON_ID,
      makeCoupon({
        discountType: "fixed",
        discountValue: 5,
        active: false,
      }),
    );

    const res = await request(app)
      .post(`${BASE}/rides`)
      .set(AUTH)
      .send({
        pickupLabel: "Home",
        pickupAddress: "1 Main St",
        dropoffLabel: "Work",
        dropoffAddress: "2 Market St",
        estimatedDistanceKm: 5,
        estimatedDurationMin: 15,
        paymentMethod: "card",
        couponId: COUPON_ID,
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "coupon_invalid",
      reason: "inactive",
    });
    expect(rideStore.size).toBe(0);
    expect(redemptionStore).toHaveLength(0);
    expect(couponStore.get(COUPON_ID)!.totalUsed).toBe(0);
  });
});
