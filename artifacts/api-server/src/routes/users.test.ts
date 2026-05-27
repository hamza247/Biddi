/**
 * Integration tests for PATCH /api/users/me.
 *
 * Covers route registration, authentication enforcement, and name persistence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory user store — hoisted so vi.mock() factories can close over it.
// ---------------------------------------------------------------------------

type UserRow = {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  countryCode: string;
  email: string | null;
  gender: string | null;
  country: string | null;
  city: string | null;
  photoUrl: string | null;
  walletBalance: string;
  isActive: boolean;
  phoneVerified: boolean;
  appMode: "rider" | "driver";
  driverStatus: "not_applied" | "pending" | "approved" | "rejected" | "suspended";
  driverOnline: boolean;
  driverRejectionReason: string | null;
  driverSuspensionReason: string | null;
  rating: string;
  trips: string;
  submittedDocs: unknown[];
  expoPushToken: string | null;
};

const { USER_ID, userStore, resetUser } = vi.hoisted(() => {
  const USER_ID = "test-user-id-abc";
  const defaultUser: UserRow = {
    id: USER_ID,
    phone: "+13339990000",
    firstName: "Original",
    lastName: "Name",
    countryCode: "+1",
    email: null,
    gender: null,
    country: null,
    city: null,
    photoUrl: null,
    walletBalance: "0",
    isActive: true,
    phoneVerified: false,
    appMode: "rider",
    driverStatus: "not_applied",
    driverOnline: false,
    driverRejectionReason: null,
    driverSuspensionReason: null,
    rating: "4.9",
    trips: "0",
    submittedDocs: [],
    expoPushToken: null,
  };
  const userStore: { current: UserRow } = { current: { ...defaultUser } };

  function resetUser() {
    userStore.current = { ...defaultUser };
  }

  return { USER_ID, userStore, resetUser };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db — provide enough surface for requireUser + PATCH handler.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { usersTable } = actual;

  const db = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          if (table === usersTable) {
            return {
              where(_cond: unknown) {
                return {
                  limit(n: number) {
                    return Promise.resolve([userStore.current].slice(0, n));
                  },
                };
              },
            };
          }
          return {
            where: () => ({ limit: () => Promise.resolve([]) }),
          };
        },
      };
    },

    update(table: unknown) {
      return {
        set(data: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              return {
                returning() {
                  if (table === usersTable) {
                    Object.assign(userStore.current, data);
                    return Promise.resolve([userStore.current]);
                  }
                  return Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },

    insert(_table: unknown) {
      return {
        values: () => ({
          returning: () => Promise.resolve([]),
          onConflictDoUpdate: () => Promise.resolve(),
        }),
      };
    },
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock ../lib/auth so verifyToken returns a known user payload without
// needing a real JWT secret (which is ephemeral in development).
// extractBearer is kept real so the Bearer header is still parsed.
// ---------------------------------------------------------------------------

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyToken: vi.fn().mockReturnValue({ sub: USER_ID, kind: "user" }),
  };
});

// ---------------------------------------------------------------------------
// Import app AFTER all mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";
const FAKE_TOKEN = "fake-test-token";
const AUTH = { Authorization: `Bearer ${FAKE_TOKEN}` };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/users/me (route registration & name persistence)", () => {
  beforeEach(() => {
    resetUser();
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .patch(`${BASE}/users/me`)
      .send({ firstName: "New" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_token");
  });

  it("returns 200 and updates firstName when authenticated", async () => {
    const res = await request(app)
      .patch(`${BASE}/users/me`)
      .set(AUTH)
      .send({ firstName: "Updated", lastName: "User" });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.firstName).toBe("Updated");
    expect(res.body.user.lastName).toBe("User");
  });

  it("persists only the provided fields and returns the updated user", async () => {
    const res = await request(app)
      .patch(`${BASE}/users/me`)
      .set(AUTH)
      .send({ firstName: "Alice" });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe("Alice");
    expect(res.body.user.id).toBe("test-user-id-abc");
  });

  it("returns 400 when firstName is empty after trimming", async () => {
    const res = await request(app)
      .patch(`${BASE}/users/me`)
      .set(AUTH)
      .send({ firstName: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  it("does not return 404 — route is correctly registered and reachable", async () => {
    const res = await request(app)
      .patch(`${BASE}/users/me`)
      .set(AUTH)
      .send({ firstName: "Test" });

    expect(res.status).not.toBe(404);
  });
});
