/**
 * Integration tests for in-trip messaging endpoints.
 *
 * Covers:
 *  - Authentication enforcement (GET + POST without Bearer → 401)
 *  - Participant guard (non-participants → 403)
 *  - Ephemeral read policy: GET returns empty messages when trip is not active
 *  - Write status gate: POST returns 409 when trip is not active
 *  - Happy path: GET returns messages for an active trip
 *  - Happy path: POST creates a message and broadcasts it for an active trip
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory stores — hoisted so vi.mock() factories can close over them.
// ---------------------------------------------------------------------------

type RideRow = {
  id: string;
  riderId: string;
  acceptedDriverId: string | null;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: string;
  pickupLng: string;
  dropoffLat: string;
  dropoffLng: string;
  createdAt: Date;
};

type MessageRow = {
  id: string;
  tripId: string;
  senderId: string;
  type: string;
  content: string;
  clientId: string | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  createdAt: Date;
};

const { RIDER_ID, DRIVER_ID, TRIP_ID, rideStore, messageStore, resetStores } = vi.hoisted(() => {
  const RIDER_ID = "11111111-1111-1111-1111-111111111111";
  const DRIVER_ID = "22222222-2222-2222-2222-222222222222";
  const TRIP_ID = "33333333-3333-3333-3333-333333333333";

  const defaultRide: RideRow = {
    id: TRIP_ID,
    riderId: RIDER_ID,
    acceptedDriverId: DRIVER_ID,
    status: "in_progress",
    pickupAddress: "A",
    dropoffAddress: "B",
    pickupLat: "0",
    pickupLng: "0",
    dropoffLat: "1",
    dropoffLng: "1",
    createdAt: new Date(),
  };

  const rideStore: { current: RideRow | null } = { current: { ...defaultRide } };
  const messageStore: MessageRow[] = [];

  function resetStores() {
    rideStore.current = { ...defaultRide };
    messageStore.length = 0;
  }

  return { RIDER_ID, DRIVER_ID, TRIP_ID, rideStore, messageStore, resetStores };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { ridesTable, tripMessagesTable, usersTable } = actual;

  const db = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          if (table === ridesTable) {
            return {
              where(_cond: unknown) {
                const rows = rideStore.current ? [rideStore.current] : [];
                return {
                  limit(n: number) {
                    return Promise.resolve(rows.slice(0, n));
                  },
                  // Awaiting .where(...) directly should resolve to the rows
                  // (used by the global /chat/unread-count aggregator).
                  then: (resolve: (v: unknown) => void) => resolve(rows),
                };
              },
            };
          }
          if (table === tripMessagesTable) {
            const fullRows = () =>
              messageStore.map((m) => ({
                ...m,
                senderFirstName: "Test",
                senderLastName: "User",
              }));
            // Filter messages the way the unread-count queries do in production:
            // sender != caller AND readAt IS NULL. This is the single source of
            // truth for the count aggregator so tests can verify the filter is
            // actually being applied (not just message-store length).
            const peerUnread = () =>
              messageStore.filter(
                (m) => m.senderId !== callerStore.userId && (m.readAt ?? null) === null,
              );
            // Build a thenable that also exposes orderBy / groupBy so both
            // the GET (with leftJoin + orderBy) and the unread-count helpers
            // (which await .where(...) directly, plus optional groupBy) work.
            const makeAggregate = () => {
              const unread = peerUnread();
              // Group-by-tripId aggregation for /chat/unread-count.
              const grouped = new Map<string, number>();
              for (const m of unread) {
                grouped.set(m.tripId, (grouped.get(m.tripId) ?? 0) + 1);
              }
              const rows = [...grouped.entries()].map(([tripId, value]) => ({
                tripId,
                value,
              }));
              const single = [{ value: unread.length }];
              const thenable = {
                then: (resolve: (v: unknown) => void) => resolve(single),
                groupBy: () => Promise.resolve(rows),
                orderBy: () => Promise.resolve(fullRows()),
                limit: (_n: number) => {
                  const hint = idempotencyLookup.clientId;
                  if (!hint) return Promise.resolve([]);
                  const match = messageStore.find(
                    (m) =>
                      m.senderId === callerStore.userId && m.clientId === hint,
                  );
                  return Promise.resolve(match ? [match] : []);
                },
              };
              return thenable;
            };
            return {
              leftJoin(_t: unknown, _on: unknown) {
                return {
                  where(_cond: unknown) {
                    return {
                      orderBy(_col: unknown) {
                        return Promise.resolve(fullRows());
                      },
                    };
                  },
                };
              },
              where(_cond: unknown) {
                return makeAggregate();
              },
            };
          }
          if (table === usersTable) {
            return {
              where: () => ({
                limit: (n: number) =>
                  Promise.resolve(
                    [{ firstName: "Test", lastName: "User" }].slice(0, n),
                  ),
              }),
            };
          }
          return {
            where: () => ({ limit: () => Promise.resolve([]) }),
          };
        },
      };
    },

    insert(_table: unknown) {
      const buildReturn = (data: Record<string, unknown>) => {
        if (_table !== tripMessagesTable) return Promise.resolve([]);
        const cid =
          typeof data.clientId === "string" ? (data.clientId as string) : null;
        if (cid) {
          const existing = messageStore.find(
            (m) =>
              m.tripId === String(data.tripId ?? TRIP_ID) &&
              m.senderId === String(data.senderId ?? RIDER_ID) &&
              m.clientId === cid,
          );
          if (existing) return Promise.resolve([]);
        }
        const newMsg: MessageRow = {
          id: `msg-${messageStore.length + 1}`,
          tripId: String(data.tripId ?? TRIP_ID),
          senderId: String(data.senderId ?? RIDER_ID),
          type: String(data.type ?? "text"),
          content: String(data.content ?? ""),
          clientId: cid,
          deliveredAt: (data.deliveredAt as Date | null | undefined) ?? null,
          readAt: (data.readAt as Date | null | undefined) ?? null,
          createdAt: new Date(),
        };
        messageStore.push(newMsg);
        return Promise.resolve([newMsg]);
      };
      return {
        values(data: Record<string, unknown>) {
          return {
            returning: () => buildReturn(data),
            onConflictDoNothing: (_opts?: unknown) => ({
              returning: () => buildReturn(data),
            }),
          };
        },
      };
    },

    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              return {
                returning(_cols?: unknown) {
                  if (_table === tripMessagesTable) {
                    // Mark all unread messages from non-caller as read AND
                    // actually mutate messageStore so tests can assert the
                    // persisted readAt / deliveredAt transitions, mirroring
                    // production's `set({ readAt: now, deliveredAt: COALESCE(...) })`
                    // behavior.
                    const targets = messageStore.filter(
                      (m) =>
                        m.senderId !== callerStore.userId &&
                        (m.readAt ?? null) === null,
                    );
                    const readAt = (values["readAt"] as Date | undefined) ?? new Date();
                    for (const m of targets) {
                      m.readAt = readAt;
                      // COALESCE(deliveredAt, now): only set deliveredAt if it was null.
                      if ((m.deliveredAt ?? null) === null) {
                        m.deliveredAt = readAt;
                      }
                    }
                    return Promise.resolve(
                      targets.map((m) => ({ id: m.id, senderId: m.senderId })),
                    );
                  }
                  return Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },
  };

  return { ...actual, db };
});

// ---------------------------------------------------------------------------
// Mock Socket.IO so emitToRide does not blow up in tests.
// ---------------------------------------------------------------------------

vi.mock("../lib/io", () => ({
  emitToRide: vi.fn(),
  emitToUser: vi.fn(),
  getIO: vi.fn(() => null),
  initIO: vi.fn(),
  isUserSocketConnected: vi.fn(() => false),
  isUserInChat: vi.fn(() => false),
  getChatPeers: vi.fn(() => new Set<string>()),
  addChatPresence: vi.fn(),
  removeChatPresence: vi.fn(),
  removeAllChatPresenceForSocket: vi.fn(),
}));

vi.mock("../lib/push", () => ({
  sendPushFromTemplate: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock ObjectStorageService so upload endpoints work without real storage.
// ---------------------------------------------------------------------------

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityUploadURL = vi.fn().mockResolvedValue(
      "https://storage.example.com/upload?sig=test",
    );
    normalizeObjectEntityPath = vi.fn().mockReturnValue("/objects/uploads/test-file.jpg");
    trySetObjectEntityAclPolicy = vi.fn().mockResolvedValue("/objects/uploads/test-file.jpg");
  },
}));

// ---------------------------------------------------------------------------
// Mock auth to accept a fake token for the rider.
// The test can override callerUserId to test different participants.
// ---------------------------------------------------------------------------

const { callerStore, idempotencyLookup } = vi.hoisted(() => ({
  callerStore: { userId: "11111111-1111-1111-1111-111111111111" },
  idempotencyLookup: { clientId: null as string | null },
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
// Import app AFTER mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app";
import * as ioModule from "../lib/io";

const emitToUserMock = vi.mocked(ioModule.emitToUser);
const emitToRideMock = vi.mocked(ioModule.emitToRide);
const isUserInChatMock = vi.mocked(ioModule.isUserInChat);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";
const FAKE_TOKEN = "fake-test-token";
const AUTH = { Authorization: `Bearer ${FAKE_TOKEN}` };
const TRIP_URL = `${BASE}/trips/${TRIP_ID}/messages`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("In-trip messaging endpoints", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  // --- Authentication ---

  it("GET returns 401 without Authorization header", async () => {
    const res = await request(app).get(TRIP_URL);
    expect(res.status).toBe(401);
  });

  it("POST returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .send({ type: "text", content: "hello" });
    expect(res.status).toBe(401);
  });

  // --- Participant guard ---

  it("GET returns 403 when caller is not a participant", async () => {
    rideStore.current = null;
    const res = await request(app).get(TRIP_URL).set(AUTH);
    expect(res.status).toBe(403);
  });

  it("POST returns 403 when caller is not a participant", async () => {
    rideStore.current = null;
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "hello" });
    expect(res.status).toBe(403);
  });

  // --- Ephemeral read policy ---

  it("GET returns empty messages when trip is completed (ephemeral enforcement)", async () => {
    rideStore.current!.status = "completed";
    messageStore.push({
      id: "msg-old",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "earlier message",
      createdAt: new Date(),
    });
    const res = await request(app).get(TRIP_URL).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it("GET returns empty messages when trip is cancelled (ephemeral enforcement)", async () => {
    rideStore.current!.status = "cancelled";
    const res = await request(app).get(TRIP_URL).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  // --- Write status gate ---

  it("POST returns 409 when trip is not active (completed)", async () => {
    rideStore.current!.status = "completed";
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "late message" });
    expect(res.status).toBe(409);
  });

  it("POST returns 409 when trip status is bidding", async () => {
    rideStore.current!.status = "bidding";
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "too early" });
    expect(res.status).toBe(409);
  });

  // --- Happy paths ---

  it("GET returns messages for an active (in_progress) trip", async () => {
    messageStore.push({
      id: "msg-001",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "Are you close?",
      createdAt: new Date(),
    });
    const res = await request(app).get(TRIP_URL).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe("Are you close?");
  });

  it("GET returns messages for driver_arriving trip", async () => {
    rideStore.current!.status = "driver_arriving";
    const res = await request(app).get(TRIP_URL).set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("POST creates a text message for an active trip", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "On my way!" });
    expect(res.status).toBe(201);
    expect(res.body.message.content).toBe("On my way!");
    expect(res.body.message.type).toBe("text");
    expect(messageStore).toHaveLength(1);
  });

  it("POST as driver creates a message for an active trip", async () => {
    callerStore.userId = DRIVER_ID;
    rideStore.current!.status = "driver_arriving";
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "2 minutes away" });
    expect(res.status).toBe(201);
    expect(res.body.message.content).toBe("2 minutes away");
  });

  it("POST returns 400 for invalid message type", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "sticker", content: "hello" });
    expect(res.status).toBe(400);
  });

  it("POST returns 400 for empty content", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "" });
    expect(res.status).toBe(400);
  });

  it("POST never sets deliveredAt/readAt at insert time", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "fresh send" });
    expect(res.status).toBe(201);
    expect(res.body.message.deliveredAt).toBeNull();
    expect(res.body.message.readAt).toBeNull();
    const row = messageStore.at(-1)!;
    expect(row.deliveredAt ?? null).toBeNull();
    expect(row.readAt ?? null).toBeNull();
  });

  it("POST is idempotent on retry: same clientId returns existing row (200)", async () => {
    const CLIENT_ID = "client-id-abc-123";
    messageStore.push({
      id: "msg-existing",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "hello from rider (original)",
      clientId: CLIENT_ID,
      createdAt: new Date(),
    });
    idempotencyLookup.clientId = CLIENT_ID;
    try {
      const res = await request(app)
        .post(TRIP_URL)
        .set(AUTH)
        .send({ type: "text", content: "retry", clientId: CLIENT_ID });
      expect(res.status).toBe(200);
      expect(res.body.message.id).toBe("msg-existing");
      expect(res.body.message.content).toBe("hello from rider (original)");
      expect(res.body.message.clientId).toBe(CLIENT_ID);
      expect(messageStore.length).toBe(1);
    } finally {
      idempotencyLookup.clientId = null;
    }
  });

  it("POST returns 429 with Retry-After when rate limit exceeded", async () => {
    // Use a unique trip+sender bucket so this test doesn't share state with
    // other tests in the suite (the limiter is module-level / in-memory).
    const UNIQUE_TRIP = "44444444-4444-4444-4444-444444444444";
    rideStore.current!.id = UNIQUE_TRIP;
    const url = `${BASE}/trips/${UNIQUE_TRIP}/messages`;
    let lastStatus = 0;
    let lastRes: request.Response | undefined;
    for (let i = 0; i < 31; i++) {
      lastRes = await request(app)
        .post(url)
        .set(AUTH)
        .send({ type: "text", content: `m${i}` });
      lastStatus = lastRes.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
    expect(lastRes!.headers["retry-after"]).toBeDefined();
    expect(Number(lastRes!.headers["retry-after"])).toBeGreaterThanOrEqual(0);
    expect(lastRes!.body).toHaveProperty("retryAfterMs");
  });
});

describe("Unread count endpoints", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("GET /trips/:tripId/unread-count returns 401 without auth", async () => {
    const res = await request(app).get(`${BASE}/trips/${TRIP_ID}/unread-count`);
    expect(res.status).toBe(401);
  });

  it("GET /trips/:tripId/unread-count returns 403 for non-participant", async () => {
    rideStore.current = null;
    const res = await request(app)
      .get(`${BASE}/trips/${TRIP_ID}/unread-count`)
      .set(AUTH);
    expect(res.status).toBe(403);
  });

  it("GET /trips/:tripId/unread-count returns 0 for inactive trip", async () => {
    rideStore.current!.status = "completed";
    const res = await request(app)
      .get(`${BASE}/trips/${TRIP_ID}/unread-count`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(0);
  });

  it("GET /chat/unread-count returns 401 without auth", async () => {
    const res = await request(app).get(`${BASE}/chat/unread-count`);
    expect(res.status).toBe(401);
  });

  it("GET /chat/unread-count returns aggregate shape", async () => {
    const res = await request(app).get(`${BASE}/chat/unread-count`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("unread");
    expect(res.body).toHaveProperty("byTrip");
  });
});

describe("Mark-read endpoint", () => {
  const MARK_READ_URL = `${BASE}/trips/${TRIP_ID}/messages/mark-read`;

  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app).post(MARK_READ_URL).send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a participant", async () => {
    rideStore.current = null;
    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(403);
  });

  it("returns 0 updated when trip is inactive", async () => {
    rideStore.current!.status = "completed";
    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.messageIds).toEqual([]);
  });

  it("happy path: marks unread peer messages as read", async () => {
    // Caller is RIDER, so messages from DRIVER are the ones marked read.
    messageStore.push({
      id: "msg-d1",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "hi",
      createdAt: new Date(),
    });
    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.messageIds)).toBe(true);
    // Response now includes the recomputed remaining unread count so
    // partial-read scenarios (upToMessageId) don't desync the badge.
    expect(res.body).toHaveProperty("unread");
    expect(typeof res.body.unread).toBe("number");
  });
});

describe("Chat attachment upload authorization", () => {
  const UPLOAD_URL = `${BASE}/storage/uploads/chat-request-url`;

  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .send({ tripId: TRIP_ID, name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a trip participant", async () => {
    rideStore.current = null;
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when trip is not active (completed)", async () => {
    rideStore.current!.status = "completed";
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(409);
  });

  it("returns 400 for missing tripId", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported MIME type", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "doc.pdf", size: 1024, contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when file exceeds 10 MB limit", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "photo.jpg", size: 11 * 1024 * 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(400);
  });

  it("returns presigned URL for valid image upload on an active trip", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("uploadURL");
    expect(res.body).toHaveProperty("objectPath");
  });

  it("returns presigned URL for valid audio upload on an active trip", async () => {
    const res = await request(app)
      .post(UPLOAD_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, name: "voice.m4a", size: 512000, contentType: "audio/m4a" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("uploadURL");
  });
});

describe("Chat attachment finalize authorization", () => {
  const FINALIZE_URL = `${BASE}/storage/uploads/chat-finalize`;
  const VALID_OBJECT_PATH = "/objects/uploads/chat-photo.jpg";

  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post(FINALIZE_URL)
      .send({ tripId: TRIP_ID, objectPath: VALID_OBJECT_PATH });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing tripId", async () => {
    const res = await request(app)
      .post(FINALIZE_URL)
      .set(AUTH)
      .send({ objectPath: VALID_OBJECT_PATH });
    expect(res.status).toBe(400);
  });

  it("returns 403 when caller is not a trip participant", async () => {
    rideStore.current = null;
    const res = await request(app)
      .post(FINALIZE_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, objectPath: VALID_OBJECT_PATH });
    expect(res.status).toBe(403);
  });

  it("returns 409 when trip is not active (completed)", async () => {
    rideStore.current!.status = "completed";
    const res = await request(app)
      .post(FINALIZE_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, objectPath: VALID_OBJECT_PATH });
    expect(res.status).toBe(409);
  });

  it("returns objectPath for valid finalize on active trip", async () => {
    const res = await request(app)
      .post(FINALIZE_URL)
      .set(AUTH)
      .send({ tripId: TRIP_ID, objectPath: VALID_OBJECT_PATH });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("objectPath");
  });
});

// ---------------------------------------------------------------------------
// Mark-read socket emissions — verify the read-receipt + badge flow on the
// wire, not just the database side-effect captured by the response body.
// ---------------------------------------------------------------------------

describe("Mark-read socket emissions", () => {
  const MARK_READ_URL = `${BASE}/trips/${TRIP_ID}/messages/mark-read`;

  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
    emitToUserMock.mockClear();
    emitToRideMock.mockClear();
  });

  it("emits chat:message:read to peer (sender) and chat:unread:update to caller", async () => {
    messageStore.push({
      id: "msg-d-unread",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "ping",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);

    const readEmits = emitToUserMock.mock.calls.filter(
      (c) => c[0] === DRIVER_ID && c[1] === "chat:message:read",
    );
    expect(readEmits).toHaveLength(1);
    const [, , readPayload] = readEmits[0]!;
    expect(readPayload).toMatchObject({
      tripId: TRIP_ID,
      messageIds: expect.any(Array),
      readAt: expect.any(String),
    });
    expect((readPayload as { messageIds: string[] }).messageIds.length).toBeGreaterThanOrEqual(1);
    // readAt must be a valid ISO timestamp.
    expect(
      Number.isFinite(Date.parse((readPayload as { readAt: string }).readAt)),
    ).toBe(true);

    const unreadEmits = emitToUserMock.mock.calls.filter(
      (c) => c[0] === RIDER_ID && c[1] === "chat:unread:update",
    );
    expect(unreadEmits).toHaveLength(1);
    expect(unreadEmits[0]![2]).toMatchObject({
      tripId: TRIP_ID,
      unread: expect.any(Number),
    });
  });

  it("does NOT emit chat:message:read when there were no unread peer messages", async () => {
    // No peer messages in store → updated = 0 → no read receipt to send.
    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);

    const readEmits = emitToUserMock.mock.calls.filter(
      (c) => c[1] === "chat:message:read",
    );
    expect(readEmits).toHaveLength(0);

    // chat:unread:update is still emitted to the caller so the badge stays
    // in sync even on a no-op mark-read (e.g. background tab refresh).
    const unreadEmits = emitToUserMock.mock.calls.filter(
      (c) => c[0] === RIDER_ID && c[1] === "chat:unread:update",
    );
    expect(unreadEmits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Unread-count endpoints with active trips and real (non-zero) counts.
// The existing suite covers shape + inactive-trip behavior; this suite locks
// in the badge math itself.
// ---------------------------------------------------------------------------

describe("Unread counts for active trips", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("GET /trips/:tripId/unread-count returns the count of peer messages with readAt=null", async () => {
    messageStore.push({
      id: "msg-d1",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "hi",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });
    messageStore.push({
      id: "msg-d2",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "you there?",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app)
      .get(`${BASE}/trips/${TRIP_ID}/unread-count`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 2 });
  });

  it("GET /chat/unread-count returns aggregated total + byTrip map for active trips", async () => {
    messageStore.push({
      id: "msg-d-agg",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "hi",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app).get(`${BASE}/chat/unread-count`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 1, byTrip: { [TRIP_ID]: 1 } });
  });

  it("GET /chat/unread-count returns { unread: 0, byTrip: {} } when caller has no active trips", async () => {
    rideStore.current = null;
    const res = await request(app).get(`${BASE}/chat/unread-count`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 0, byTrip: {} });
  });
});

// ---------------------------------------------------------------------------
// POST /messages broadcast side-effects: trip:message to the ride room and
// chat:unread:update to the peer so the badge bumps in real time.
// ---------------------------------------------------------------------------

describe("POST /messages broadcasts", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
    emitToRideMock.mockClear();
    emitToUserMock.mockClear();
    isUserInChatMock.mockReset();
    isUserInChatMock.mockReturnValue(false);
  });

  it("emits trip:message to the ride and chat:unread:update to the peer with the new count", async () => {
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "Hey driver" });
    expect(res.status).toBe(201);

    expect(emitToRideMock).toHaveBeenCalledWith(
      TRIP_ID,
      "trip:message",
      expect.objectContaining({
        tripId: TRIP_ID,
        senderId: RIDER_ID,
        content: "Hey driver",
      }),
    );

    const unreadEmits = emitToUserMock.mock.calls.filter(
      (c) => c[0] === DRIVER_ID && c[1] === "chat:unread:update",
    );
    expect(unreadEmits).toHaveLength(1);
    expect(unreadEmits[0]![2]).toMatchObject({
      tripId: TRIP_ID,
      unread: expect.any(Number),
    });
    // The peer's unread count is recomputed from the peer's perspective —
    // we just verify the contract (a number gets emitted alongside the
    // tripId), not the specific value (the mock filters by caller, not
    // the dynamically passed peer userId in unreadCountForTrip).
    expect(
      (unreadEmits[0]![2] as { unread: number }).unread,
    ).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// deliveredAt / readAt assignment under varying peer presence on POST.
//
// The current contract is: POST always inserts deliveredAt=null and
// readAt=null regardless of whether the peer is currently in the chat,
// merely socket-connected, or fully offline. Receipts are set later by
// the mark-read flow. These tests exercise each presence scenario with
// the isUserInChat mock so that any future change to make POST presence-
// aware (e.g. set deliveredAt when peer is connected, readAt when peer
// is in chat) must be an intentional, test-visible change.
// ---------------------------------------------------------------------------

describe("POST /messages deliveredAt/readAt vs peer presence", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
    emitToRideMock.mockClear();
    emitToUserMock.mockClear();
    isUserInChatMock.mockReset();
  });

  it("peer is actively in chat: response + persisted row both have deliveredAt=null and readAt=null", async () => {
    isUserInChatMock.mockReturnValue(true);
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "peer is here" });
    expect(res.status).toBe(201);
    expect(res.body.message.deliveredAt).toBeNull();
    expect(res.body.message.readAt).toBeNull();
    const row = messageStore.at(-1)!;
    expect(row.deliveredAt ?? null).toBeNull();
    expect(row.readAt ?? null).toBeNull();
  });

  it("peer is connected but NOT in chat: response + persisted row both have deliveredAt=null and readAt=null", async () => {
    // isUserInChat reports false, simulating "socket connected but the chat
    // screen is not focused / not joined". The route only uses this signal
    // to decide whether to send a push notification, not for receipt
    // timestamps on insert.
    isUserInChatMock.mockReturnValue(false);
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "peer is connected only" });
    expect(res.status).toBe(201);
    expect(res.body.message.deliveredAt).toBeNull();
    expect(res.body.message.readAt).toBeNull();
    const row = messageStore.at(-1)!;
    expect(row.deliveredAt ?? null).toBeNull();
    expect(row.readAt ?? null).toBeNull();
  });

  it("peer is offline: response + persisted row both have deliveredAt=null and readAt=null", async () => {
    isUserInChatMock.mockReturnValue(false);
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "peer is offline" });
    expect(res.status).toBe(201);
    expect(res.body.message.deliveredAt).toBeNull();
    expect(res.body.message.readAt).toBeNull();
    const row = messageStore.at(-1)!;
    expect(row.deliveredAt ?? null).toBeNull();
    expect(row.readAt ?? null).toBeNull();
  });

  it("isUserInChat is consulted with (tripId, peerId) on POST so push gating uses the right peer", async () => {
    isUserInChatMock.mockReturnValue(true);
    const res = await request(app)
      .post(TRIP_URL)
      .set(AUTH)
      .send({ type: "text", content: "presence check" });
    expect(res.status).toBe(201);
    expect(isUserInChatMock).toHaveBeenCalledWith(TRIP_ID, DRIVER_ID);
  });
});

// ---------------------------------------------------------------------------
// mark-read writes deliveredAt + readAt together (COALESCE semantics).
// This locks in the receipt assignment that DOES happen — it's just on
// mark-read rather than at insert time.
// ---------------------------------------------------------------------------

describe("mark-read sets receipt timestamps and recomputes unread", () => {
  const MARK_READ_URL = `${BASE}/trips/${TRIP_ID}/messages/mark-read`;

  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
    emitToUserMock.mockClear();
  });

  it("returns updated count, messageIds, and the recomputed unread total", async () => {
    messageStore.push({
      id: "msg-d-mr",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "ack me",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      updated: expect.any(Number),
      messageIds: expect.any(Array),
      unread: expect.any(Number),
    });
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    expect(res.body.messageIds.length).toBe(res.body.updated);
  });

  it("persists readAt + deliveredAt on previously-unread peer rows (COALESCE semantics)", async () => {
    // Three rows: caller's own (must NOT be touched), peer-already-read (must
    // NOT be re-stamped), and peer-unread (must get readAt + deliveredAt set).
    const before = new Date(Date.now() - 60_000);
    messageStore.push({
      id: "msg-self",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "from me",
      clientId: null,
      readAt: null,
      deliveredAt: null,
      createdAt: before,
    });
    messageStore.push({
      id: "msg-peer-already-read",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "old read msg",
      clientId: null,
      readAt: before,
      deliveredAt: before,
      createdAt: before,
    });
    messageStore.push({
      id: "msg-peer-unread",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "ack me",
      clientId: null,
      readAt: null,
      deliveredAt: null,
      createdAt: new Date(),
    });

    const res = await request(app).post(MARK_READ_URL).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.messageIds).toEqual(["msg-peer-unread"]);
    expect(res.body.unread).toBe(0);

    const self = messageStore.find((m) => m.id === "msg-self")!;
    const oldRead = messageStore.find((m) => m.id === "msg-peer-already-read")!;
    const justRead = messageStore.find((m) => m.id === "msg-peer-unread")!;

    // Caller-sent row is untouched.
    expect(self.readAt ?? null).toBeNull();
    expect(self.deliveredAt ?? null).toBeNull();
    // Already-read row keeps its original readAt/deliveredAt.
    expect(oldRead.readAt).toEqual(before);
    expect(oldRead.deliveredAt).toEqual(before);
    // Newly-read row got readAt and deliveredAt populated together.
    expect(justRead.readAt).toBeInstanceOf(Date);
    expect(justRead.deliveredAt).toBeInstanceOf(Date);
    expect((justRead.readAt as Date).getTime()).toBeGreaterThan(before.getTime());
    expect((justRead.deliveredAt as Date).getTime()).toEqual(
      (justRead.readAt as Date).getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// Unread-count filter sanity: mixed message store (caller-sent + peer-read +
// peer-unread) to verify the senderId != caller AND readAt IS NULL filter is
// actually being applied by the endpoints, not just message-store length.
// ---------------------------------------------------------------------------

describe("Unread-count filter sanity", () => {
  beforeEach(() => {
    resetStores();
    callerStore.userId = RIDER_ID;
  });

  it("excludes caller-sent rows and already-read peer rows from /trips/:tripId/unread-count", async () => {
    const past = new Date(Date.now() - 60_000);
    messageStore.push({
      id: "self-1",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "hi",
      clientId: null,
      readAt: null,
      createdAt: past,
    });
    messageStore.push({
      id: "peer-read",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "ack",
      clientId: null,
      readAt: past,
      createdAt: past,
    });
    messageStore.push({
      id: "peer-unread-1",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "u there?",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });
    messageStore.push({
      id: "peer-unread-2",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "?",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app)
      .get(`${BASE}/trips/${TRIP_ID}/unread-count`)
      .set(AUTH);
    expect(res.status).toBe(200);
    // 4 rows in store, but only 2 should be counted (peer + readAt=null).
    expect(res.body.unread).toBe(2);
  });

  it("excludes caller-sent rows and already-read peer rows from /chat/unread-count byTrip aggregation", async () => {
    const past = new Date(Date.now() - 60_000);
    messageStore.push({
      id: "self-1",
      tripId: TRIP_ID,
      senderId: RIDER_ID,
      type: "text",
      content: "self",
      clientId: null,
      readAt: null,
      createdAt: past,
    });
    messageStore.push({
      id: "peer-read",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "old",
      clientId: null,
      readAt: past,
      createdAt: past,
    });
    messageStore.push({
      id: "peer-unread",
      tripId: TRIP_ID,
      senderId: DRIVER_ID,
      type: "text",
      content: "new",
      clientId: null,
      readAt: null,
      createdAt: new Date(),
    });

    const res = await request(app).get(`${BASE}/chat/unread-count`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 1, byTrip: { [TRIP_ID]: 1 } });
  });
});

// ---------------------------------------------------------------------------
// Rate limiter unit tests — direct coverage of the in-memory token bucket
// used by POST /messages so the 429 / Retry-After contract is locked in.
// ---------------------------------------------------------------------------

describe("checkLimit (in-memory rate limiter)", () => {
  it("allows up to `max` calls in a window then returns ok=false with retryAfterMs > 0", async () => {
    const { checkLimit } = await import("../lib/rateLimit");
    const key = `test:limiter:${Math.random()}`;
    const max = 3;
    const windowMs = 1_000;

    for (let i = 0; i < max; i++) {
      const r = checkLimit(key, max, windowMs);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(max - i - 1);
    }
    const blocked = checkLimit(key, max, windowMs);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  it("resets after the window elapses", async () => {
    const { checkLimit } = await import("../lib/rateLimit");
    const key = `test:limiter:reset:${Math.random()}`;
    expect(checkLimit(key, 1, 10).ok).toBe(true);
    expect(checkLimit(key, 1, 10).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 25));
    const after = checkLimit(key, 1, 10);
    expect(after.ok).toBe(true);
    expect(after.retryAfterMs).toBe(0);
  });

  it("uses independent buckets per key", async () => {
    const { checkLimit } = await import("../lib/rateLimit");
    const a = `test:limiter:a:${Math.random()}`;
    const b = `test:limiter:b:${Math.random()}`;
    expect(checkLimit(a, 1, 1_000).ok).toBe(true);
    expect(checkLimit(a, 1, 1_000).ok).toBe(false);
    // Different key gets its own fresh bucket.
    expect(checkLimit(b, 1, 1_000).ok).toBe(true);
  });
});
