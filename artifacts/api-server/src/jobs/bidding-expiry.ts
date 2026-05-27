import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, bidsTable, ridesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { emitToRide, emitToUser } from "../lib/io";
import {
  scheduleBiddingExpirySweeps,
  startBiddingExpiryWorker,
  closeBiddingExpiryQueue,
} from "../lib/queue";

const TICK_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let bullmqActive = false;

async function sweepExpiredBids() {
  const now = new Date();
  const expired = await db
    .update(bidsTable)
    .set({ status: "expired" })
    .where(and(eq(bidsTable.status, "active"), isNotNull(bidsTable.expiresAt), lt(bidsTable.expiresAt, now)))
    .returning({
      id: bidsTable.id,
      rideId: bidsTable.rideId,
      driverId: bidsTable.driverId,
    });
  for (const b of expired) {
    emitToRide(b.rideId, "bidding:offer-expired", { rideId: b.rideId, bidId: b.id });
    emitToUser(b.driverId, "bidding:offer-expired", { rideId: b.rideId, bidId: b.id });
  }
  return expired.length;
}

async function sweepExpiredBiddingPosts() {
  const now = new Date();
  const expired = await db
    .update(ridesTable)
    .set({
      status: "cancelled",
      cancelledBy: "system",
      cancellationReason: "bidding_expired",
      updatedAt: now,
    })
    .where(and(eq(ridesTable.status, "bidding"), isNotNull(ridesTable.biddingExpiresAt), lt(ridesTable.biddingExpiresAt, now)))
    .returning({ id: ridesTable.id, riderId: ridesTable.riderId });

  for (const r of expired) {
    await db
      .update(bidsTable)
      .set({ status: "cancelled" })
      .where(and(eq(bidsTable.rideId, r.id), eq(bidsTable.status, "active")));
    emitToRide(r.id, "ride:cancelled", { rideId: r.id, reason: "bidding_expired" });
    emitToUser(r.riderId, "ride:cancelled", { rideId: r.id, reason: "bidding_expired" });
  }
  return expired.length;
}

export async function runBiddingExpirySweep(): Promise<{ bids: number; posts: number }> {
  const [bids, posts] = await Promise.all([
    sweepExpiredBids().catch((err) => {
      logger.warn({ err }, "[bidding-expiry] bid sweep failed");
      return 0;
    }),
    sweepExpiredBiddingPosts().catch((err) => {
      logger.warn({ err }, "[bidding-expiry] post sweep failed");
      return 0;
    }),
  ]);
  if (bids > 0 || posts > 0) {
    logger.info({ bids, posts }, "[bidding-expiry] sweep complete");
  }
  return { bids, posts };
}

/**
 * Boot the bidding-expiry job. Prefers BullMQ when REDIS_URL is set so
 * the sweep can scale beyond this Node.js process; falls back to a local
 * setInterval when Redis isn't configured (dev convenience). Set
 * BIDDING_EXPIRY_DISABLED=true to opt out entirely (Vitest does this).
 */
export async function startBiddingExpiryJob(): Promise<void> {
  if (process.env.BIDDING_EXPIRY_DISABLED === "true") {
    logger.info("[bidding-expiry] disabled via BIDDING_EXPIRY_DISABLED");
    return;
  }

  if (process.env.REDIS_URL) {
    const worker = startBiddingExpiryWorker(async () => {
      const result = await runBiddingExpirySweep();
      return result;
    });
    if (worker) {
      const scheduled = await scheduleBiddingExpirySweeps(TICK_INTERVAL_MS);
      if (scheduled) {
        bullmqActive = true;
        logger.info(
          { intervalMs: TICK_INTERVAL_MS, driver: "bullmq" },
          "[bidding-expiry] scheduled",
        );
        return;
      }
    }
    logger.warn(
      "[bidding-expiry] REDIS_URL set but BullMQ worker could not start; falling back to in-process timer",
    );
  }

  if (timer) return;
  timer = setInterval(() => {
    void runBiddingExpirySweep();
  }, TICK_INTERVAL_MS);
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, driver: "setInterval" },
    "[bidding-expiry] scheduled",
  );
}

export async function stopBiddingExpiryJob(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (bullmqActive) {
    await closeBiddingExpiryQueue();
    bullmqActive = false;
  }
}
