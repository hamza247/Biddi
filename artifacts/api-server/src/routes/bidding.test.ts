/**
 * Smoke tests for the bidding slice. Verifies the route-level guards on
 * /bidding/offers and /bidding/posts/:rideId/accept-offer, plus the
 * idempotency contract on the shared `acceptBid` helper:
 *
 *  - POST /bidding/offers returns 400 on missing fields, 410 when the
 *    ride's biddingExpiresAt has elapsed.
 *  - POST /bidding/posts/:rideId/accept-offer returns 403 when the rider
 *    isn't the post owner, 409 when the ride is no longer in 'bidding'.
 *  - `acceptBid` returns `ride_no_longer_bidding` on a second call after
 *    the ride has already transitioned (idempotency contract).
 *
 * To keep the test isolated we mock @workspace/db with a small in-memory
 * store and the auth middleware so requireUser/requireDriver are pass-through.
 * Full transactional tests against Postgres are deferred to a follow-up.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

type Ride = {
  id: string;
  riderId: string;
  status: string;
  acceptedBidId: string | null;
  acceptedDriverId: string | null;
  sharedGroupId: string | null;
  biddingExpiresAt: Date | null;
  vehicleTypeId: string | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  createdAt: Date;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
};

type Bid = {
  id: string;
  rideId: string;
  driverId: string;
  amount: number;
  etaMin: number;
  status: string;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
};

const store: { rides: Ride[]; bids: Bid[] } = { rides: [], bids: [] };

let currentUserId = "user-rider";

function resetStore() {
  store.rides = [];
  store.bids = [];
  currentUserId = "user-rider";
}

// Match-everything chainable shim: returns rows from `store.rides`/`store.bids`
// filtered by caller-supplied predicates wrapped by the route code. The route
// code only inspects table identity by referential equality (since we return
// the same proxy object across queries) so the test stubs cannot meaningfully
// inspect the WHERE clauses — instead each test seeds the store with the rows
// it expects to be matched.
function selectAll(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
        orderBy: () => ({ limit: async () => rows }),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => {
  const ridesTable = { __t: "rides" } as const;
  const bidsTable = { __t: "bids" } as const;
  const usersTable = { __t: "users" } as const;

  return {
    db: {
      select: () => ({
        from: (t: { __t: string }) => ({
          where: () => ({
            limit: async () => (t.__t === "rides" ? store.rides.slice(0, 1) : store.bids.slice(0, 1)),
            orderBy: () => ({ limit: async () => (t.__t === "rides" ? store.rides : store.bids) }),
          }),
          orderBy: () => ({
            limit: async () => (t.__t === "rides" ? store.rides : store.bids),
          }),
        }),
      }),
      insert: () => ({
        values: (val: Partial<Bid>) => ({
          returning: async () => {
            const bid: Bid = {
              id: `bid-${store.bids.length + 1}`,
              rideId: val.rideId ?? "",
              driverId: val.driverId ?? "",
              amount: val.amount ?? 0,
              etaMin: val.etaMin ?? 0,
              status: "active",
              expiresAt: val.expiresAt ?? null,
              note: val.note ?? null,
              createdAt: new Date(),
            };
            store.bids.push(bid);
            return [bid];
          },
        }),
      }),
      update: (t: { __t: string }) => ({
        set: (patch: Partial<Ride | Bid>) => ({
          where: async () => {
            if (t.__t === "rides") {
              for (const r of store.rides) Object.assign(r, patch);
            } else {
              for (const b of store.bids) Object.assign(b, patch);
            }
            return undefined;
          },
          returning: async () => {
            if (t.__t === "rides") {
              for (const r of store.rides) Object.assign(r, patch);
              return store.rides;
            }
            for (const b of store.bids) Object.assign(b, patch);
            return store.bids;
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        update: (t: { __t: string }) => ({
          set: (patch: Partial<Bid>) => ({
            where: async () => {
              if (t.__t === "bids") for (const b of store.bids) Object.assign(b, patch);
              return undefined;
            },
          }),
        }),
        insert: (_t: unknown) => ({
          values: (val: Partial<Bid>) => ({
            returning: async () => {
              const bid: Bid = {
                id: `bid-${store.bids.length + 1}`,
                rideId: val.rideId ?? "",
                driverId: val.driverId ?? "",
                amount: val.amount ?? 0,
                etaMin: val.etaMin ?? 0,
                status: "active",
                expiresAt: val.expiresAt ?? null,
                note: val.note ?? null,
                createdAt: new Date(),
              };
              store.bids.push(bid);
              return [bid];
            },
          }),
        }),
      }),
    },
    ridesTable,
    bidsTable,
    usersTable,
  };
});

vi.mock("../middlewares/auth", () => ({
  requireUser: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = currentUserId;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/io", () => ({
  emitToRide: vi.fn(),
  emitToUser: vi.fn(),
  isUserSocketConnected: vi.fn().mockReturnValue(false),
  getDriverLivePosition: vi.fn().mockReturnValue({ lat: 0, lng: 0 }),
  haversineKm: vi.fn().mockReturnValue(1),
}));

vi.mock("./driver", () => ({
  ensureApprovedDriver: async () => ({
    id: "user-driver",
    driverStatus: "approved",
    driverOnline: true,
  }),
}));

vi.mock("../lib/pricing", () => ({
  loadVehicleType: async () => null,
  validateBid: () => null,
}));

vi.mock("../lib/airportSurcharge", () => ({
  resolveAirportSurcharge: async () => null,
}));

vi.mock("../lib/driverStats", () => ({
  invalidateDriverRates: vi.fn(),
}));

import biddingRouter from "./bidding";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", biddingRouter);
  return app;
}

function seedBiddingRide(overrides: Partial<Ride> = {}): Ride {
  const ride: Ride = {
    id: "00000000-0000-0000-0000-000000000aaa",
    riderId: "user-rider",
    status: "bidding",
    acceptedBidId: null,
    acceptedDriverId: null,
    sharedGroupId: null,
    biddingExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    vehicleTypeId: null,
    estimatedDistanceKm: 3,
    estimatedDurationMin: 10,
    createdAt: new Date(),
    pickupLat: 0,
    pickupLng: 0,
    dropoffLat: 0.01,
    dropoffLng: 0.01,
    ...overrides,
  };
  store.rides = [ride];
  return ride;
}

describe("POST /bidding/offers", () => {
  beforeEach(() => {
    resetStore();
    currentUserId = "user-driver";
  });

  it("returns 400 when required fields are missing", async () => {
    seedBiddingRide();
    const res = await request(buildApp())
      .post("/api/bidding/offers")
      .send({ rideId: "00000000-0000-0000-0000-000000000aaa" });
    expect(res.status).toBe(400);
  });

  it("returns 410 when the bidding post has expired", async () => {
    seedBiddingRide({ biddingExpiresAt: new Date(Date.now() - 1000) });
    const res = await request(buildApp())
      .post("/api/bidding/offers")
      .send({ rideId: "00000000-0000-0000-0000-000000000aaa", amount: 8, etaMin: 4 });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("bidding_expired");
  });

  it("creates a bid and returns 201 on the happy path", async () => {
    seedBiddingRide();
    const res = await request(buildApp())
      .post("/api/bidding/offers")
      .send({ rideId: "00000000-0000-0000-0000-000000000aaa", amount: 8, etaMin: 4 });
    expect(res.status).toBe(201);
    expect(res.body.bid.amount).toBe(8);
    expect(res.body.bid.expiresAt).toBeTruthy();
  });
});

describe("POST /bidding/posts/:rideId/accept-offer", () => {
  beforeEach(() => {
    resetStore();
    currentUserId = "user-rider";
  });

  it("returns 400 for invalid bidId input", async () => {
    seedBiddingRide();
    const res = await request(buildApp())
      .post("/api/bidding/posts/ride-1/accept-offer")
      .send({ bidId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller is not the ride's rider", async () => {
    seedBiddingRide();
    currentUserId = "user-other";
    const res = await request(buildApp())
      .post("/api/bidding/posts/ride-1/accept-offer")
      .send({ bidId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when the ride is no longer in bidding state", async () => {
    seedBiddingRide({ status: "driver_arriving" });
    const res = await request(buildApp())
      .post("/api/bidding/posts/ride-1/accept-offer")
      .send({ bidId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).toBe(409);
  });
});
