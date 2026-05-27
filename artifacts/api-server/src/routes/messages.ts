import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, ridesTable, tripMessagesTable, usersTable } from "@workspace/db";
import { and, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";
import {
  emitToRide,
  emitToUser,
  isUserInChat,
} from "../lib/io";
import { ObjectStorageService } from "../lib/objectStorage";
import { checkLimit } from "../lib/rateLimit";
import { sendPushFromTemplate } from "../lib/push";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const CHAT_ALLOWED_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/aac",
  "audio/wav",
  "audio/ogg",
]);

const MAX_CHAT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 2 * 60_000;

const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._-]{1,128}$/;

const CreateMessageBody = z.object({
  type: z.enum(["text", "image", "voice"]),
  content: z.string().min(1).max(4000),
  audioDurationMs: z.number().int().positive().max(MAX_AUDIO_DURATION_MS).optional(),
  clientId: z.string().min(1).max(64).optional(),
});

const ChatUploadBody = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  size: z.number().int().positive(),
  contentType: z.string(),
});

const ChatFinalizeBody = z.object({
  tripId: z.string().uuid(),
  objectPath: z.string().regex(OBJECT_PATH_RE, "Invalid objectPath"),
});

const MarkReadBody = z
  .object({
    upToMessageId: z.string().uuid().optional(),
  })
  .optional();

const ACTIVE_TRIP_STATUSES = ["driver_arriving", "in_progress"] as const;

// 30 messages / minute / (user, trip) — sufficient for normal chat,
// blocks runaway clients from spamming the recipient and the DB.
const SEND_RATE_MAX = 30;
const SEND_RATE_WINDOW_MS = 60_000;

async function assertParticipant(
  tripId: string,
  userId: string,
): Promise<typeof ridesTable.$inferSelect | null> {
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.id, tripId),
        or(
          eq(ridesTable.riderId, userId),
          eq(ridesTable.acceptedDriverId, userId),
        ),
      ),
    )
    .limit(1);
  return ride ?? null;
}

/** Sanitize text content: collapse control characters, strip null bytes, trim. */
function sanitizeText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
}

/** Pick the peer userId for a 1:1 trip chat. */
function peerOf(
  ride: typeof ridesTable.$inferSelect,
  userId: string,
): string | null {
  if (ride.riderId === userId) return ride.acceptedDriverId ?? null;
  if (ride.acceptedDriverId === userId) return ride.riderId;
  return null;
}

async function unreadCountForTrip(tripId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(tripMessagesTable)
    .where(
      and(
        eq(tripMessagesTable.tripId, tripId),
        ne(tripMessagesTable.senderId, userId),
        isNull(tripMessagesTable.readAt),
      ),
    );
  return row?.value ?? 0;
}

/**
 * GET /trips/:tripId/messages
 * Fetch the message history for a trip. Caller must be the rider or accepted driver,
 * and the trip must still be active (driver_arriving or in_progress). Chat history
 * is ephemeral and unavailable once a trip has ended.
 */
router.get("/trips/:tripId/messages", requireUser, async (req: Request, res: Response) => {
  const tripId = req.params.tripId as string;
  const userId = req.userId!;

  let ride: Awaited<ReturnType<typeof assertParticipant>>;
  try {
    ride = await assertParticipant(tripId, userId);
  } catch (err) {
    req.log.error({ err }, "Database error checking trip participant");
    res.status(500).json({ error: "Internal error" });
    return;
  }
  if (!ride) {
    res.status(403).json({ error: "Not a participant of this trip" });
    return;
  }

  if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
    res.json({ messages: [] });
    return;
  }

  try {
    const messages = await db
      .select({
        id: tripMessagesTable.id,
        tripId: tripMessagesTable.tripId,
        senderId: tripMessagesTable.senderId,
        type: tripMessagesTable.type,
        content: tripMessagesTable.content,
        audioDurationMs: tripMessagesTable.audioDurationMs,
        clientId: tripMessagesTable.clientId,
        deliveredAt: tripMessagesTable.deliveredAt,
        readAt: tripMessagesTable.readAt,
        createdAt: tripMessagesTable.createdAt,
        senderFirstName: usersTable.firstName,
        senderLastName: usersTable.lastName,
      })
      .from(tripMessagesTable)
      .leftJoin(usersTable, eq(usersTable.id, tripMessagesTable.senderId))
      .where(eq(tripMessagesTable.tripId, tripId))
      .orderBy(asc(tripMessagesTable.createdAt));

    res.json({ messages });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trip messages");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * GET /trips/:tripId/unread-count
 * Returns the number of messages addressed to the caller (i.e. not sent by them)
 * that haven't been marked read. Returns 0 for inactive trips.
 */
router.get(
  "/trips/:tripId/unread-count",
  requireUser,
  async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const userId = req.userId!;

    let ride: Awaited<ReturnType<typeof assertParticipant>>;
    try {
      ride = await assertParticipant(tripId, userId);
    } catch (err) {
      req.log.error({ err }, "Database error checking trip participant");
      res.status(500).json({ error: "Internal error" });
      return;
    }
    if (!ride) {
      res.status(403).json({ error: "Not a participant of this trip" });
      return;
    }
    if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
      res.json({ unread: 0 });
      return;
    }

    try {
      const unread = await unreadCountForTrip(tripId, userId);
      res.json({ unread });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch trip unread count");
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  },
);

/**
 * GET /chat/unread-count
 * Aggregate unread count across every active trip the caller participates in.
 * Powers the persistent in-app chat badge.
 */
router.get("/chat/unread-count", requireUser, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const activeRides = await db
      .select({ id: ridesTable.id })
      .from(ridesTable)
      .where(
        and(
          or(
            eq(ridesTable.riderId, userId),
            eq(ridesTable.acceptedDriverId, userId),
          ),
          inArray(
            ridesTable.status,
            ACTIVE_TRIP_STATUSES as readonly (typeof ACTIVE_TRIP_STATUSES)[number][],
          ),
        ),
      );

    if (activeRides.length === 0) {
      res.json({ unread: 0, byTrip: {} });
      return;
    }

    const ids = activeRides.map((r) => r.id);
    const rows = await db
      .select({
        tripId: tripMessagesTable.tripId,
        value: count(),
      })
      .from(tripMessagesTable)
      .where(
        and(
          inArray(tripMessagesTable.tripId, ids),
          ne(tripMessagesTable.senderId, userId),
          isNull(tripMessagesTable.readAt),
        ),
      )
      .groupBy(tripMessagesTable.tripId);

    const byTrip: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byTrip[r.tripId] = r.value;
      total += r.value;
    }
    res.json({ unread: total, byTrip });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch global unread chat count");
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

/**
 * POST /trips/:tripId/messages
 * Create a new message for a trip. Caller must be the rider or accepted driver.
 * Rate-limited per (user, trip) and content is sanitized. If the recipient
 * is offline or not currently focused on the chat, a push notification is
 * sent in addition to the realtime broadcast.
 */
router.post("/trips/:tripId/messages", requireUser, async (req: Request, res: Response) => {
  const tripId = req.params.tripId as string;
  const userId = req.userId!;

  let ride: Awaited<ReturnType<typeof assertParticipant>>;
  try {
    ride = await assertParticipant(tripId, userId);
  } catch (err) {
    req.log.error({ err }, "Database error checking trip participant");
    res.status(500).json({ error: "Internal error" });
    return;
  }
  if (!ride) {
    res.status(403).json({ error: "Not a participant of this trip" });
    return;
  }

  if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
    res.status(409).json({ error: "Chat is only available during an active trip" });
    return;
  }

  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid message body" });
    return;
  }

  const { type, audioDurationMs, clientId } = parsed.data;
  let content = parsed.data.content;
  if (type === "text") {
    content = sanitizeText(content);
    if (content.length === 0) {
      res.status(400).json({ error: "Empty content" });
      return;
    }
  }
  if (type === "voice" && audioDurationMs == null) {
    res.status(400).json({ error: "audioDurationMs is required for voice messages" });
    return;
  }

  const peerId = peerOf(ride, userId);

  try {
    if (clientId) {
      const [existing] = await db
        .select()
        .from(tripMessagesTable)
        .where(
          and(
            eq(tripMessagesTable.tripId, tripId),
            eq(tripMessagesTable.senderId, userId),
            eq(tripMessagesTable.clientId, clientId),
          ),
        )
        .limit(1);
      if (existing) {
        const [senderRow] = await db
          .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        res.status(200).json({
          message: {
            id: existing.id,
            tripId: existing.tripId,
            senderId: existing.senderId,
            type: existing.type,
            content: existing.content,
            audioDurationMs: existing.audioDurationMs,
            deliveredAt: existing.deliveredAt,
            readAt: existing.readAt,
            createdAt: existing.createdAt,
            senderFirstName: senderRow?.firstName ?? "",
            senderLastName: senderRow?.lastName ?? "",
            clientId,
          },
        });
        return;
      }
    }

    const limit = checkLimit(
      `chat:msg:${userId}:${tripId}`,
      SEND_RATE_MAX,
      SEND_RATE_WINDOW_MS,
    );
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      res.status(429).json({
        error: "Too many messages — slow down.",
        retryAfterMs: limit.retryAfterMs,
      });
      return;
    }

    const peerInChat = peerId ? isUserInChat(tripId, peerId) : false;

    const insertResult = await db
      .insert(tripMessagesTable)
      .values({
        tripId,
        senderId: userId,
        type,
        content,
        audioDurationMs: audioDurationMs ?? null,
        clientId: clientId ?? null,
        deliveredAt: null,
        readAt: null,
      })
      .onConflictDoNothing({
        target: [
          tripMessagesTable.tripId,
          tripMessagesTable.senderId,
          tripMessagesTable.clientId,
        ],
      })
      .returning();
    let message = insertResult[0];
    if (!message && clientId) {
      const [existing] = await db
        .select()
        .from(tripMessagesTable)
        .where(
          and(
            eq(tripMessagesTable.tripId, tripId),
            eq(tripMessagesTable.senderId, userId),
            eq(tripMessagesTable.clientId, clientId),
          ),
        )
        .limit(1);
      if (existing) {
        const [senderRow] = await db
          .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        res.status(200).json({
          message: {
            id: existing.id,
            tripId: existing.tripId,
            senderId: existing.senderId,
            type: existing.type,
            content: existing.content,
            audioDurationMs: existing.audioDurationMs,
            deliveredAt: existing.deliveredAt,
            readAt: existing.readAt,
            createdAt: existing.createdAt,
            senderFirstName: senderRow?.firstName ?? "",
            senderLastName: senderRow?.lastName ?? "",
            clientId,
          },
        });
        return;
      }
    }
    if (!message) {
      res.status(500).json({ error: "Insert returned no row" });
      return;
    }

    const [senderRow] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const payload = {
      id: message.id,
      tripId: message.tripId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      audioDurationMs: message.audioDurationMs,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
      createdAt: message.createdAt,
      senderFirstName: senderRow?.firstName ?? "",
      senderLastName: senderRow?.lastName ?? "",
      clientId: clientId ?? null,
    };

    emitToRide(tripId, "trip:message", payload);

    if (peerId) {
      try {
        const unread = await unreadCountForTrip(tripId, peerId);
        emitToUser(peerId, "chat:unread:update", { tripId, unread });
      } catch (err) {
        req.log.warn({ err }, "Failed to emit chat:unread:update");
      }
    }

    if (peerId && !peerInChat) {
      const senderName =
        `${senderRow?.firstName ?? ""} ${senderRow?.lastName ?? ""}`.trim() || "Trip partner";
      const isToRider = ride.riderId === peerId;
      const templateKey = isToRider
        ? "chat.new_message_to_rider"
        : "chat.new_message_to_driver";
      const preview =
        type === "text"
          ? content.slice(0, 120)
          : type === "image"
            ? "📷 Photo"
            : "🎙️ Voice message";
      void sendPushFromTemplate(
        peerId,
        templateKey,
        `${senderName} sent a message`,
        preview,
        { senderName, preview },
        { type: "chat_message", tripId, messageId: message.id },
        tripId,
        ride.acceptedDriverId === peerId ? "driverApp" : "userApp",
      ).catch((err) =>
        req.log.warn({ err, peerId }, "Failed to send chat push notification"),
      );
    }

    res.status(201).json({ message: payload });
  } catch (err) {
    req.log.error({ err }, "Failed to create trip message");
    res.status(500).json({ error: "Failed to create message" });
  }
});

/**
 * POST /trips/:tripId/messages/mark-read
 * Marks every message in this trip not sent by the caller as read (and delivered)
 * up to and including `upToMessageId` (or all if omitted). Emits chat:message:read
 * to the sender so their tick turns blue, and chat:unread:update to the caller.
 */
router.post(
  "/trips/:tripId/messages/mark-read",
  requireUser,
  async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const userId = req.userId!;

    let ride: Awaited<ReturnType<typeof assertParticipant>>;
    try {
      ride = await assertParticipant(tripId, userId);
    } catch (err) {
      req.log.error({ err }, "Database error checking trip participant");
      res.status(500).json({ error: "Internal error" });
      return;
    }
    if (!ride) {
      res.status(403).json({ error: "Not a participant of this trip" });
      return;
    }
    if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
      res.json({ updated: 0, messageIds: [], unread: 0 });
      return;
    }

    const parsed = MarkReadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const upToMessageId = parsed.data?.upToMessageId;

    try {
      let cutoff: Date | null = null;
      if (upToMessageId) {
        const [row] = await db
          .select({ createdAt: tripMessagesTable.createdAt })
          .from(tripMessagesTable)
          .where(
            and(
              eq(tripMessagesTable.id, upToMessageId),
              eq(tripMessagesTable.tripId, tripId),
            ),
          )
          .limit(1);
        if (!row) {
          res.status(404).json({ error: "upToMessageId not found in trip" });
          return;
        }
        cutoff = row.createdAt;
      }

      const now = new Date();
      const condParts = [
        eq(tripMessagesTable.tripId, tripId),
        ne(tripMessagesTable.senderId, userId),
        isNull(tripMessagesTable.readAt),
      ];
      if (cutoff) {
        condParts.push(sql`${tripMessagesTable.createdAt} <= ${cutoff}`);
      }

      const updated = await db
        .update(tripMessagesTable)
        .set({ readAt: now, deliveredAt: sql`COALESCE(${tripMessagesTable.deliveredAt}, ${now})` })
        .where(and(...condParts))
        .returning({ id: tripMessagesTable.id, senderId: tripMessagesTable.senderId });

      const ids = updated.map((u) => u.id);
      const peerId = peerOf(ride, userId);

      if (peerId && ids.length > 0) {
        emitToUser(peerId, "chat:message:read", {
          tripId,
          messageIds: ids,
          readAt: now.toISOString(),
        });
      }
      let remaining = 0;
      try {
        remaining = await unreadCountForTrip(tripId, userId);
      } catch (err) {
        req.log.warn({ err }, "Failed to recompute unread after mark-read");
      }
      emitToUser(userId, "chat:unread:update", { tripId, unread: remaining });

      res.json({ updated: ids.length, messageIds: ids, unread: remaining });
    } catch (err) {
      req.log.error({ err }, "Failed to mark messages read");
      res.status(500).json({ error: "Failed to mark messages read" });
    }
  },
);

/**
 * POST /storage/uploads/chat-request-url
 * Request a presigned URL for a chat image or voice upload.
 * Caller must be a participant in an active trip.
 */
router.post(
  "/storage/uploads/chat-request-url",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = ChatUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { tripId, name, size, contentType } = parsed.data;
    const userId = req.userId!;

    let ride: Awaited<ReturnType<typeof assertParticipant>>;
    try {
      ride = await assertParticipant(tripId, userId);
    } catch (err) {
      req.log.error({ err }, "Database error checking trip participant");
      res.status(500).json({ error: "Internal error" });
      return;
    }
    if (!ride) {
      res.status(403).json({ error: "Not a participant of this trip" });
      return;
    }
    if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
      res.status(409).json({ error: "Chat uploads are only allowed during an active trip" });
      return;
    }

    if (!CHAT_ALLOWED_MIME_TYPES.has(contentType)) {
      res.status(400).json({
        error: "Unsupported content type for chat attachments.",
      });
      return;
    }

    if (size > MAX_CHAT_UPLOAD_BYTES) {
      res.status(400).json({
        error: `File too large. Max ${MAX_CHAT_UPLOAD_BYTES / 1024 / 1024} MB.`,
      });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (err) {
      req.log.error({ err }, "Error generating chat upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /storage/uploads/chat-finalize
 * Finalize a chat attachment upload (set public ACL).
 * Caller must be a participant in an active trip to prevent cross-context finalize.
 */
router.post(
  "/storage/uploads/chat-finalize",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = ChatFinalizeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid tripId / objectPath" });
      return;
    }

    const { tripId, objectPath } = parsed.data;
    const userId = req.userId!;

    let ride: Awaited<ReturnType<typeof assertParticipant>>;
    try {
      ride = await assertParticipant(tripId, userId);
    } catch (err) {
      req.log.error({ err }, "Database error checking trip participant");
      res.status(500).json({ error: "Internal error" });
      return;
    }
    if (!ride) {
      res.status(403).json({ error: "Not a participant of this trip" });
      return;
    }
    if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(ride.status)) {
      res.status(409).json({ error: "Chat uploads are only allowed during an active trip" });
      return;
    }

    try {
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        objectPath,
        { owner: userId, visibility: "public" },
      );
      res.json({ objectPath: normalized });
    } catch (err) {
      req.log.error({ err }, "Error finalizing chat upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

export default router;
