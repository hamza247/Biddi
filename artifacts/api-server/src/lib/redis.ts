import IORedis, { type Redis } from "ioredis";
import { logger } from "./logger";

let connection: Redis | null = null;

/**
 * Returns the shared ioredis connection (BullMQ-friendly), or null when
 * REDIS_URL is unset. Callers MUST handle the null case — most workloads
 * fall back to in-process timers when Redis is unavailable so dev still
 * works without spinning up a Redis instance.
 *
 * Configured with `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * because BullMQ requires those settings on the connection it uses for
 * blocking commands.
 */
export function getRedis(): Redis | null {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
  connection.on("error", (err) => {
    logger.warn({ err: err.message }, "[redis] connection error");
  });
  connection.on("ready", () => {
    logger.info("[redis] connected");
  });
  return connection;
}

export async function closeRedis(): Promise<void> {
  if (!connection) return;
  await connection.quit().catch(() => undefined);
  connection = null;
}
