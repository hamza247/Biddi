/**
 * OTP auth flow tests.
 *
 * Covers:
 *  - normalizePhone unit tests (all phone-format variants)
 *  - HTTP integration tests for /auth/request-otp and /auth/verify-otp
 *    using an in-memory mock for @workspace/db and settings.
 *
 * Key invariant: any two phone strings that refer to the same subscriber
 * (e.g. "9992223333" and "+19992223333") must normalise to the same E.164
 * value so that an OTP written by request-otp can always be found by
 * verify-otp, regardless of which format each caller uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory stores — hoisted so they are visible inside vi.mock() factories.
// ---------------------------------------------------------------------------

type OtpRow = {
  id: number;
  phone: string;
  code: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};
type UserRow = {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  countryCode: string;
  role: string;
  status: string;
  createdAt: Date;
};

const { otpStore, userStore, resetStores } = vi.hoisted(() => {
  const otpStore: OtpRow[] = [];
  const userStore: UserRow[] = [];

  function resetStores() {
    otpStore.length = 0;
    userStore.length = 0;
  }

  return { otpStore, userStore, resetStores };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db
// Spread all real exports so other routes keep their table references.
// Override only `db` with an in-memory implementation.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { otpCodesTable, usersTable } = actual;

  // Extract all Param values from a drizzle SQL condition object so the mock
  // can do real code- and phone-based filtering without needing to run SQL.
  function extractParamValues(node: unknown): string[] {
    if (!node || typeof node !== "object") return [];
    const obj = node as Record<string, unknown>;
    // Drizzle Param: { value, encoder }
    if ("value" in obj && "encoder" in obj) {
      const v = obj["value"];
      if (v != null && typeof v !== "object") return [String(v)];
      return [];
    }
    // Drizzle SQL: { queryChunks: SQLChunk[] }
    if ("queryChunks" in obj && Array.isArray(obj["queryChunks"])) {
      return (obj["queryChunks"] as unknown[]).flatMap(extractParamValues);
    }
    return [];
  }

  // Chainable SELECT builder with condition-aware filtering.
  function makeSelectBuilder(initialRows: unknown[], isOtpTable: boolean) {
    let rows = initialRows;
    const b: Record<string, unknown> = {};
    b["where"] = (condition: unknown) => {
      const params = new Set(extractParamValues(condition));
      if (params.size > 0) {
        if (isOtpTable) {
          // OTP lookup requires BOTH phone AND code to match, exactly as the
          // real query does: eq(phone, ?) AND eq(code, ?).
          rows = (rows as OtpRow[]).filter(
            (r) => params.has(r.phone) && params.has(r.code),
          );
        } else {
          // User lookup filters by phone or id (string).
          rows = (rows as UserRow[]).filter(
            (r) => params.has(r.phone) || params.has(r.id),
          );
        }
      }
      return b;
    };
    b["orderBy"] = (_c: unknown) => b;
    b["limit"] = (n: number) => Promise.resolve(rows.slice(0, n));
    return b;
  }

  const db = {
    insert(table: unknown) {
      return {
        values(data: Record<string, unknown>) {
          if (table === otpCodesTable) {
            const row: OtpRow = {
              id: otpStore.length + 1,
              phone: data["phone"] as string,
              code: data["code"] as string,
              expiresAt: data["expiresAt"] as Date,
              consumedAt: null,
              createdAt: new Date(),
            };
            otpStore.push(row);
            return Promise.resolve();
          }
          if (table === usersTable) {
            return {
              returning() {
                const row: UserRow = {
                  id: String(userStore.length + 1),
                  phone: data["phone"] as string,
                  firstName: (data["firstName"] as string) ?? "",
                  lastName: (data["lastName"] as string) ?? "",
                  countryCode: (data["countryCode"] as string) ?? "+1",
                  role: "user",
                  status: "active",
                  createdAt: new Date(),
                };
                userStore.push(row);
                return Promise.resolve([row]);
              },
            };
          }
          // Any other table (e.g. settingsTable) — safe no-op
          return {
            onConflictDoUpdate: () => Promise.resolve(),
            returning: () => Promise.resolve([]),
          };
        },
      };
    },

    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          if (table === otpCodesTable) {
            // Start with non-consumed, non-expired rows; where() refines further.
            const rows = otpStore.filter(
              (r) => !r.consumedAt && r.expiresAt > new Date(),
            );
            return makeSelectBuilder(rows, true);
          }
          if (table === usersTable) {
            return makeSelectBuilder([...userStore], false);
          }
          return makeSelectBuilder([], false);
        },
      };
    },

    update(table: unknown) {
      return {
        set(data: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const params = new Set(extractParamValues(cond));
              if (table === otpCodesTable) {
                // auth.ts uses: .where(eq(otpCodesTable.id, otp.id))
                // Find the exact row whose id appears in the WHERE params.
                const row = otpStore.find((r) => params.has(String(r.id)));
                if (row) {
                  row.consumedAt = (data["consumedAt"] as Date) ?? new Date();
                }
              }
              if (table === usersTable) {
                return {
                  returning() {
                    // auth.ts uses: .where(eq(usersTable.id, user.id))
                    const row = userStore.find((r) =>
                      params.has(r.id),
                    );
                    if (row) Object.assign(row, data);
                    return Promise.resolve(row ? [row] : []);
                  },
                };
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock settings — always return demo_fixed with code "1122".
// ---------------------------------------------------------------------------

vi.mock("../lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/settings")>();
  return {
    ...actual,
    getConfig: vi.fn().mockResolvedValue({
      smsMode: "demo_fixed",
      smsDemoCode: "1122",
      moroccansmsPrefix: "212",
    }),
    invalidateConfigCache: vi.fn(),
    ensureSettingsSeeded: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Mock rate limiter — always allow requests so tests don't hit limits.
// ---------------------------------------------------------------------------

vi.mock("../lib/rateLimit", () => ({
  checkLimit: vi.fn().mockReturnValue({ ok: true, retryAfterMs: 0, remaining: 100 }),
}));

// ---------------------------------------------------------------------------
// Import app AFTER all mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";
import { normalizePhone } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";

function postRequestOtp(phone: string) {
  return request(app).post(`${BASE}/auth/request-otp`).send({ phone });
}

function postVerifyOtp(phone: string, code: string) {
  return request(app)
    .post(`${BASE}/auth/verify-otp`)
    .send({ phone, code, firstName: "Test" });
}

// ===========================================================================
// Unit tests — normalizePhone
// ===========================================================================

describe("normalizePhone (unit)", () => {
  it("passes E.164 input through unchanged", () => {
    expect(normalizePhone("+19992223333", "1")).toBe("+19992223333");
  });

  it("prepends +1 to a bare 10-digit US number", () => {
    expect(normalizePhone("9992223333", "1")).toBe("+19992223333");
  });

  it("local US format and E.164 format resolve to the same value", () => {
    expect(normalizePhone("9992223333", "1")).toBe(
      normalizePhone("+19992223333", "1"),
    );
  });

  it("prepends +212 to a bare 9-digit Moroccan number", () => {
    expect(normalizePhone("600000000", "212")).toBe("+212600000000");
  });

  it("drops trunk 0 from a Moroccan local number", () => {
    expect(normalizePhone("0600000000", "212")).toBe("+212600000000");
  });

  it("local Moroccan and E.164 Moroccan resolve to the same value", () => {
    expect(normalizePhone("600000000", "212")).toBe(
      normalizePhone("+212600000000", "212"),
    );
  });

  it("does not double-prefix a number that already includes the country code", () => {
    expect(normalizePhone("19992223333", "1")).toBe("+19992223333");
  });
});

// ===========================================================================
// Integration tests — /auth/request-otp + /auth/verify-otp HTTP endpoints
// ===========================================================================

describe("OTP flow (integration)", () => {
  beforeEach(() => {
    resetStores();
  });

  // ── request-otp ─────────────────────────────────────────────────────────

  it("request-otp responds 200 and reveals devCode in demo_fixed mode", async () => {
    const res = await postRequestOtp("+19992223333");

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.devCode).toBe("1122");
  });

  it("request-otp with local-format phone normalises to E.164 before storing", async () => {
    const res = await postRequestOtp("9992223333");

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("+19992223333");
    // The row written to the OTP table must already be in E.164 form.
    expect(otpStore).toHaveLength(1);
    expect(otpStore[0].phone).toBe("+19992223333");
  });

  it("request-otp with E.164 phone stores the same normalised value", async () => {
    const res = await postRequestOtp("+19992223333");

    expect(res.status).toBe(200);
    expect(otpStore[0].phone).toBe("+19992223333");
  });

  // ── verify-otp ──────────────────────────────────────────────────────────

  it("verify-otp accepts the demo fixed code 1122 and returns a JWT", async () => {
    await postRequestOtp("+19992223333");

    const res = await postVerifyOtp("+19992223333", "1122");

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.user.phone).toBe("+19992223333");
  });

  it("verify-otp rejects an incorrect code with 401", async () => {
    await postRequestOtp("+19992223333");

    const res = await postVerifyOtp("+19992223333", "9999");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_or_expired_code");
  });

  // ── cross-format: local request → E.164 verify ──────────────────────────

  it("verify-otp with E.164 succeeds after request-otp with local format", async () => {
    // request-otp receives the local 10-digit form
    const reqRes = await postRequestOtp("9992223333");
    expect(reqRes.status).toBe(200);
    // Confirm the stored OTP phone is E.164
    expect(otpStore[0].phone).toBe("+19992223333");

    // verify-otp receives the E.164 form — both must normalise identically
    const verRes = await postVerifyOtp("+19992223333", "1122");
    expect(verRes.status).toBe(200);
    expect(verRes.body.token).toBeTruthy();
  });

  // ── cross-format: E.164 request → local verify ──────────────────────────

  it("verify-otp with local format succeeds after request-otp with E.164", async () => {
    // request-otp receives E.164
    const reqRes = await postRequestOtp("+19992223333");
    expect(reqRes.status).toBe(200);
    expect(otpStore[0].phone).toBe("+19992223333");

    // verify-otp receives the local 10-digit form
    const verRes = await postVerifyOtp("9992223333", "1122");
    expect(verRes.status).toBe(200);
    expect(verRes.body.token).toBeTruthy();
  });

  // ── phone isolation — OTP is bound to the requesting phone ──────────────

  it("verify-otp with a different phone is rejected even with the correct code", async () => {
    // Request OTP for one number
    await postRequestOtp("+19992223333");

    // Attempt to verify using a completely different phone — must fail even
    // if the code happens to be the same (1122 in demo mode).
    const res = await postVerifyOtp("+12223334444", "1122");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_or_expired_code");
  });

  // ── one-time use ─────────────────────────────────────────────────────────

  it("a consumed OTP cannot be used a second time", async () => {
    await postRequestOtp("+19992223333");

    const first = await postVerifyOtp("+19992223333", "1122");
    expect(first.status).toBe(200);

    // Second attempt must fail even with the correct code
    const second = await postVerifyOtp("+19992223333", "1122");
    expect(second.status).toBe(401);
  });
});
