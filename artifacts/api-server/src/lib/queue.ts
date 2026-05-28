import { Queue, Worker, type Processor } from "bullmq";
import { getRedis } from "./redis";
import { logger } from "./logger";

export const BIDDING_EXPIRY_QUEUE = "biddi-bidding-expiry";
export const BIDDING_EXPIRY_JOB_NAME = "sweep";

let biddingExpiryQueue: Queue | null = null;
let biddingExpiryWorker: Worker | null = null;

/**
 * Returns the lazily-created BullMQ queue for bidding-expiry sweeps,
 * or null when Redis is unavailable. Callers should treat null as
 * "BullMQ disabled" and fall back to in-process scheduling.
 */
export function getBiddingExpiryQueue(): Queue | null {
  if (biddingExpiryQueue) return biddingExpiryQueue;
  const connection = getRedis();
  if (!connection) return null;
  biddingExpiryQueue = new Queue(BIDDING_EXPIRY_QUEUE, { connection });
  return biddingExpiryQueue;
}

/**
 * Registers the worker that processes scheduled bidding-expiry jobs. Idempotent.
 * Returns null when Redis is unavailable.
 */
export function startBiddingExpiryWorker(processor: Processor): Worker | null {
  if (biddingExpiryWorker) return biddingExpiryWorker;
  const connection = getRedis();
  if (!connection) return null;
  biddingExpiryWorker = new Worker(BIDDING_EXPIRY_QUEUE, processor, {
    connection,
    concurrency: 1,
  });
  biddingExpiryWorker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "[queue] bidding-expiry job failed");
  });
  return biddingExpiryWorker;
}

/**
 * Schedule a repeating sweep job using BullMQ's repeatable jobs. Safe to
 * call multiple times — BullMQ deduplicates repeatable jobs by their key.
 */
export async function scheduleBiddingExpirySweeps(everyMs: number): Promise<boolean> {
  const queue = getBiddingExpiryQueue();
  if (!queue) return false;
  // jobId is the dedup key for repeatable jobs (combined with the pattern).
  await queue.add(
    BIDDING_EXPIRY_JOB_NAME,
    {},
    {
      repeat: { every: everyMs },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  return true;
}

export async function closeBiddingExpiryQueue(): Promise<void> {
  if (biddingExpiryWorker) {
    await biddingExpiryWorker.close().catch(() => undefined);
    biddingExpiryWorker = null;
  }
  if (biddingExpiryQueue) {
    await biddingExpiryQueue.close().catch(() => undefined);
    biddingExpiryQueue = null;
  }
}
