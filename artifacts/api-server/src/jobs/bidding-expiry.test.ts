/**
 * Tests for the bidding-expiry boot-time driver selection. We don't exercise
 * the SQL sweep here (covered by the integration suite); these tests confirm:
 *
 *  - BIDDING_EXPIRY_DISABLED=true short-circuits boot with no timer + no
 *    BullMQ activity.
 *  - When REDIS_URL is unset the job falls back to setInterval.
 *  - When REDIS_URL is set the job goes through the BullMQ helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const scheduleSpy = vi.fn().mockResolvedValue(true);
const startWorkerSpy = vi.fn().mockReturnValue({} as object);
const closeQueueSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/queue", () => ({
  scheduleBiddingExpirySweeps: (...args: unknown[]) => scheduleSpy(...args),
  startBiddingExpiryWorker: (...args: unknown[]) => startWorkerSpy(...args),
  closeBiddingExpiryQueue: (...args: unknown[]) => closeQueueSpy(...args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
  bidsTable: {},
  ridesTable: {},
}));

vi.mock("../lib/io", () => ({
  emitToRide: vi.fn(),
  emitToUser: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { startBiddingExpiryJob, stopBiddingExpiryJob } from "./bidding-expiry";

describe("startBiddingExpiryJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scheduleSpy.mockClear();
    startWorkerSpy.mockClear();
    closeQueueSpy.mockClear();
    delete process.env.REDIS_URL;
    delete process.env.BIDDING_EXPIRY_DISABLED;
  });

  afterEach(async () => {
    await stopBiddingExpiryJob();
    vi.useRealTimers();
  });

  it("does nothing when BIDDING_EXPIRY_DISABLED=true", async () => {
    process.env.BIDDING_EXPIRY_DISABLED = "true";
    await startBiddingExpiryJob();
    expect(startWorkerSpy).not.toHaveBeenCalled();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("uses setInterval fallback when REDIS_URL is unset", async () => {
    await startBiddingExpiryJob();
    expect(startWorkerSpy).not.toHaveBeenCalled();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("registers a BullMQ worker + schedule when REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    await startBiddingExpiryJob();
    expect(startWorkerSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(15_000);
  });

  it("falls back to setInterval when worker registration fails (no Redis connection)", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    startWorkerSpy.mockReturnValueOnce(null);
    await startBiddingExpiryJob();
    expect(startWorkerSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
