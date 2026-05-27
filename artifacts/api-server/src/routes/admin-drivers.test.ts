/**
 * Integration tests for GET /api/admin/drivers.
 *
 * Why this exists: the endpoint regressed to a 500 because of a Postgres
 * parameter-typing issue inside the rating-aggregation SQL, and the bug only
 * surfaced in the admin UI as an empty list. These tests exercise the route
 * end-to-end against an in-memory @workspace/db mock so the same class of
 * regression (rating aggregation behaviour, status-tab filtering, response
 * shape) is caught automatically.
 *
 * Coverage:
 *  - Each `status` filter (pending/approved/rejected/suspended/all) returns
 *    200 with the correct subset of drivers and the route handler does not
 *    blow up when the rating aggregation runs.
 *  - With at least two approved drivers, the rated driver's response rating
 *    reflects the rides aggregation and the unrated driver falls back to
 *    the stored value.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory stores — hoisted so vi.mock() factories can close over them.
// ---------------------------------------------------------------------------

type DriverStatus = "not_applied" | "pending" | "approved" | "rejected" | "suspended";

type DriverRow = {
  id: string;
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  gender: string | null;
  country: string | null;
  city: string | null;
  photoUrl: string | null;
  walletBalance: string;
  isActive: boolean;
  phoneVerified: boolean;
  password: string | null;
  appMode: "rider" | "driver";
  driverStatus: DriverStatus;
  driverOnline: boolean;
  submittedDocs: unknown[];
  rating: string;
  trips: string;
  driverRejectionReason: string | null;
  driverSuspensionReason: string | null;
  expoPushToken: string | null;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  lastKnownHeading: number | null;
  lastKnownAt: Date | null;
  createdAt: Date;
};

type RideRow = {
  id: string;
  acceptedDriverId: string | null;
  status: string;
  ratingScore: number | null;
  updatedAt: Date;
  createdAt: Date;
};

const STATUS_VALUES: DriverStatus[] = [
  "not_applied",
  "pending",
  "approved",
  "rejected",
  "suspended",
];

function makeDriver(overrides: Partial<DriverRow>): DriverRow {
  return {
    id: overrides.id ?? "driver-default",
    phone: overrides.phone ?? "+10000000000",
    countryCode: "+1",
    firstName: "Driver",
    lastName: "Test",
    email: null,
    gender: null,
    country: null,
    city: null,
    photoUrl: null,
    walletBalance: "0",
    isActive: true,
    phoneVerified: true,
    password: null,
    appMode: "driver",
    driverStatus: "approved",
    driverOnline: false,
    submittedDocs: [],
    rating: "4.92",
    trips: "0",
    driverRejectionReason: null,
    driverSuspensionReason: null,
    expoPushToken: null,
    lastKnownLat: null,
    lastKnownLng: null,
    lastKnownHeading: null,
    lastKnownAt: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

const { ADMIN_ID, driverStore, rideStore, resetStores } = vi.hoisted(() => {
  const ADMIN_ID = "00000000-0000-0000-0000-0000000000ad";
  const driverStore: DriverRow[] = [];
  const rideStore: RideRow[] = [];

  function resetStores() {
    driverStore.length = 0;
    rideStore.length = 0;
  }

  return { ADMIN_ID, driverStore, rideStore, resetStores };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db
//
// Provides only the chain shape the admin/drivers route + requireAdmin
// middleware need:
//   - select(...).from(adminsTable).where(...).limit(n)
//   - select(...).from(usersTable)
//       .leftJoin(...).leftJoin(...).leftJoin(...)
//       .where(cond).orderBy(col)
//   - db.execute(sql\`...\`) for the rating aggregation
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { adminsTable, usersTable } = actual;

  function extractParamValues(node: unknown): string[] {
    // The drizzle SQL builder mixes a few primitive shapes inside
    // `queryChunks`. We need to walk them all so we can see every dynamic
    // value the route fed into the query (driver IDs, status enum strings,
    // etc.) regardless of which wrapper drizzle chose for that interpolation.
    if (node == null) return [];
    // Plain interpolated values like `sql`${id}`` end up as bare primitives
    // inside the parent SQL's queryChunks (see drizzle-orm SQL.append).
    if (typeof node !== "object") return [String(node)];
    const obj = node as Record<string, unknown>;
    // Drizzle Param: { value, encoder } — produced by `eq(col, value)` etc.
    if ("value" in obj && "encoder" in obj) {
      const v = obj["value"];
      if (v != null && typeof v !== "object") return [String(v)];
      return [];
    }
    // Drizzle SQL: { queryChunks: SQLChunk[] } — recurse.
    if ("queryChunks" in obj && Array.isArray(obj["queryChunks"])) {
      return (obj["queryChunks"] as unknown[]).flatMap(extractParamValues);
    }
    return [];
  }

  function resolveDriverRows(conditions: unknown[]) {
    const params = new Set(conditions.flatMap((c) => extractParamValues(c)));

    // /admin/drivers either filters by an exact driverStatus value (param)
    // or, for the "all" tab, uses raw SQL `driverStatus <> 'not_applied'`
    // which has no params — we mirror both branches here.
    const explicitStatus = STATUS_VALUES.find(
      (s): s is DriverStatus => s !== "not_applied" && params.has(s),
    );

    let rows = driverStore.slice();
    if (explicitStatus) {
      rows = rows.filter((d) => d.driverStatus === explicitStatus);
    } else {
      rows = rows.filter((d) => d.driverStatus !== "not_applied");
    }

    return rows.map((d) => ({
      user: d,
      vehicle: null,
      vehicleTypeName: null,
      zoneName: null,
    }));
  }

  function makeUsersBuilder() {
    const conditions: unknown[] = [];
    const b: Record<string, unknown> = {};
    b["leftJoin"] = (_t: unknown, _on: unknown) => b;
    b["where"] = (cond: unknown) => {
      conditions.push(cond);
      return b;
    };
    b["orderBy"] = (_c: unknown) => Promise.resolve(resolveDriverRows(conditions));
    return b;
  }

  function makeAdminsBuilder() {
    const conditions: unknown[] = [];
    const b: Record<string, unknown> = {};
    b["where"] = (cond: unknown) => {
      conditions.push(cond);
      return b;
    };
    b["limit"] = (n: number) => {
      const params = new Set(conditions.flatMap((c) => extractParamValues(c)));
      const rows = params.has(ADMIN_ID) ? [{ id: ADMIN_ID }] : [];
      return Promise.resolve(rows.slice(0, n));
    };
    return b;
  }

  const db = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          if (table === usersTable) return makeUsersBuilder();
          if (table === adminsTable) return makeAdminsBuilder();
          // Safe fallback for any other unexpected table. Supports the
          // chain shapes used by computeDriverRatesBatch — i.e. plain
          // .where(...).groupBy(...) — by always resolving to an empty
          // result set (the test fixtures seed no rides/bids/dispatch
          // logs, so 0 counts and null rates are the expected output).
          return {
            leftJoin: () => ({
              where: () => ({ orderBy: () => Promise.resolve([]) }),
            }),
            where: () => ({
              limit: () => Promise.resolve([]),
              orderBy: () => Promise.resolve([]),
              groupBy: () => Promise.resolve([]),
            }),
            groupBy: () => Promise.resolve([]),
          };
        },
      };
    },

    /**
     * Mocks the rating-aggregation SQL by reading the in-memory rideStore.
     * For each driverId encoded in the SQL params, compute the average
     * `ratingScore` across completed rated rides and return rows in the
     * same shape the real query produces: { driver_id, avg_rating }.
     */
    execute(sqlObj: unknown) {
      const params = new Set(extractParamValues(sqlObj));
      const byDriver = new Map<string, number[]>();
      for (const ride of rideStore) {
        if (
          ride.status === "completed" &&
          ride.ratingScore != null &&
          ride.acceptedDriverId &&
          params.has(ride.acceptedDriverId)
        ) {
          const arr = byDriver.get(ride.acceptedDriverId) ?? [];
          arr.push(ride.ratingScore);
          byDriver.set(ride.acceptedDriverId, arr);
        }
      }
      const rows: { driver_id: string; avg_rating: number }[] = [];
      for (const [driverId, scores] of byDriver) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        rows.push({ driver_id: driverId, avg_rating: avg });
      }
      return Promise.resolve({ rows });
    },
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock auth so the requireAdmin middleware accepts a fake bearer token.
// ---------------------------------------------------------------------------

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyToken: vi.fn().mockReturnValue({ sub: ADMIN_ID, kind: "admin" }),
  };
});

// ---------------------------------------------------------------------------
// Import app AFTER all mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";
import { DEFAULT_DRIVER_RATING } from "../lib/driverRating";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";
const AUTH = { Authorization: "Bearer fake-admin-token" };

function getDrivers(status?: string) {
  const url = status
    ? `${BASE}/admin/drivers?status=${status}`
    : `${BASE}/admin/drivers`;
  return request(app).get(url).set(AUTH);
}

const RATED_ID = "11111111-1111-1111-1111-111111111111";
const UNRATED_ID = "22222222-2222-2222-2222-222222222222";
const PENDING_ID = "33333333-3333-3333-3333-333333333333";
const REJECTED_ID = "44444444-4444-4444-4444-444444444444";
const SUSPENDED_ID = "55555555-5555-5555-5555-555555555555";
const NOT_APPLIED_ID = "66666666-6666-6666-6666-666666666666";

function seedAllDriverStatuses() {
  driverStore.push(
    makeDriver({
      id: RATED_ID,
      phone: "+10000000001",
      firstName: "Rated",
      driverStatus: "approved",
      rating: "3.50",
    }),
    makeDriver({
      id: UNRATED_ID,
      phone: "+10000000002",
      firstName: "Unrated",
      driverStatus: "approved",
      rating: "4.20",
    }),
    makeDriver({
      id: PENDING_ID,
      phone: "+10000000003",
      firstName: "Pending",
      driverStatus: "pending",
    }),
    makeDriver({
      id: REJECTED_ID,
      phone: "+10000000004",
      firstName: "Rejected",
      driverStatus: "rejected",
    }),
    makeDriver({
      id: SUSPENDED_ID,
      phone: "+10000000005",
      firstName: "Suspended",
      driverStatus: "suspended",
    }),
    makeDriver({
      id: NOT_APPLIED_ID,
      phone: "+10000000006",
      firstName: "NotApplied",
      driverStatus: "not_applied",
    }),
  );

  // Two completed rated rides for the "rated" driver → avg = 4.5.
  // The unrated driver has no completed rated rides → must fall back to
  // its stored rating ("4.20" → 4.2).
  rideStore.push(
    {
      id: "ride-1",
      acceptedDriverId: RATED_ID,
      status: "completed",
      ratingScore: 4,
      updatedAt: new Date("2025-02-01T00:00:00Z"),
      createdAt: new Date("2025-02-01T00:00:00Z"),
    },
    {
      id: "ride-2",
      acceptedDriverId: RATED_ID,
      status: "completed",
      ratingScore: 5,
      updatedAt: new Date("2025-02-02T00:00:00Z"),
      createdAt: new Date("2025-02-02T00:00:00Z"),
    },
    // Cancelled / unrated rides must be ignored by the aggregation.
    {
      id: "ride-3",
      acceptedDriverId: RATED_ID,
      status: "cancelled",
      ratingScore: 1,
      updatedAt: new Date("2025-02-03T00:00:00Z"),
      createdAt: new Date("2025-02-03T00:00:00Z"),
    },
    {
      id: "ride-4",
      acceptedDriverId: UNRATED_ID,
      status: "completed",
      ratingScore: null,
      updatedAt: new Date("2025-02-04T00:00:00Z"),
      createdAt: new Date("2025-02-04T00:00:00Z"),
    },
  );
}

// ===========================================================================
// Tests
// ===========================================================================

describe("GET /api/admin/drivers", () => {
  beforeEach(() => {
    resetStores();
  });

  it("requires an admin bearer token", async () => {
    const res = await request(app).get(`${BASE}/admin/drivers?status=approved`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with both approved drivers when status=approved", async () => {
    seedAllDriverStatuses();

    const res = await getDrivers("approved");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.drivers)).toBe(true);
    const ids = (res.body.drivers as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(RATED_ID);
    expect(ids).toContain(UNRATED_ID);
    expect(ids).toHaveLength(2);
  });

  it("rated driver's rating reflects rides aggregation; unrated falls back to stored value", async () => {
    seedAllDriverStatuses();

    const res = await getDrivers("approved");
    expect(res.status).toBe(200);

    const drivers = res.body.drivers as Array<{ id: string; rating: number }>;
    const rated = drivers.find((d) => d.id === RATED_ID);
    const unrated = drivers.find((d) => d.id === UNRATED_ID);

    expect(rated).toBeDefined();
    expect(unrated).toBeDefined();

    // Two completed rated rides scoring 4 and 5 → avg = 4.5. The stored
    // rating ("3.50") must NOT win when the aggregation produced a value.
    expect(rated!.rating).toBeCloseTo(4.5, 5);

    // No rated completed rides → must fall back to the stored value.
    expect(unrated!.rating).toBeCloseTo(4.2, 5);
  });

  it("unrated driver with no stored rating falls back to the default", async () => {
    driverStore.push(
      makeDriver({
        id: RATED_ID,
        firstName: "NoStoredRating",
        driverStatus: "approved",
        // Empty rating mimics a brand new driver row before any rides.
        rating: "",
      }),
    );

    const res = await getDrivers("approved");
    expect(res.status).toBe(200);

    const driver = (res.body.drivers as Array<{ id: string; rating: number }>)[0];
    expect(driver.rating).toBeCloseTo(DEFAULT_DRIVER_RATING, 5);
  });

  it.each(["pending", "approved", "rejected", "suspended"] as const)(
    "status=%s returns 200 with only matching drivers",
    async (status) => {
      seedAllDriverStatuses();

      const res = await getDrivers(status);

      expect(res.status).toBe(200);
      const drivers = res.body.drivers as Array<{
        id: string;
        driverStatus: string;
      }>;
      expect(drivers.length).toBeGreaterThan(0);
      for (const d of drivers) {
        expect(d.driverStatus).toBe(status);
      }
    },
  );

  it("status=all returns 200 and excludes not_applied drivers", async () => {
    seedAllDriverStatuses();

    const res = await getDrivers("all");

    expect(res.status).toBe(200);
    const drivers = res.body.drivers as Array<{
      id: string;
      driverStatus: string;
    }>;
    const ids = drivers.map((d) => d.id);

    // Every applied-status driver is included.
    expect(ids).toContain(RATED_ID);
    expect(ids).toContain(UNRATED_ID);
    expect(ids).toContain(PENDING_ID);
    expect(ids).toContain(REJECTED_ID);
    expect(ids).toContain(SUSPENDED_ID);
    // The not_applied driver is excluded.
    expect(ids).not.toContain(NOT_APPLIED_ID);
    for (const d of drivers) {
      expect(d.driverStatus).not.toBe("not_applied");
    }
  });

  it("returns 200 with an empty list when no drivers match the filter", async () => {
    // Only seed an approved driver so a status=pending request is empty.
    driverStore.push(
      makeDriver({
        id: RATED_ID,
        driverStatus: "approved",
      }),
    );

    const res = await getDrivers("pending");

    expect(res.status).toBe(200);
    expect(res.body.drivers).toEqual([]);
  });
});
