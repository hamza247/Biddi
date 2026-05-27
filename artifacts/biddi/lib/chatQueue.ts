import { ApiError } from "./api";
import { getJSON, setJSON, remove } from "./storage";

export type QueuedMessageType = "text" | "image" | "voice";

export interface QueuedMessage {
  clientId: string;
  tripId: string;
  type: QueuedMessageType;
  content: string;
  createdAt: string;
  attempts: number;
  contentType?: string;
  fileName?: string;
  fileSize?: number;
  audioDurationMs?: number;
}

const queueKey = (tripId: string) => `chatQueue:${tripId}`;

export async function loadQueue(tripId: string): Promise<QueuedMessage[]> {
  const list = await getJSON<QueuedMessage[]>(queueKey(tripId));
  return Array.isArray(list) ? list : [];
}

export async function saveQueue(
  tripId: string,
  items: QueuedMessage[],
): Promise<void> {
  if (items.length === 0) {
    await remove(queueKey(tripId));
    return;
  }
  await setJSON(queueKey(tripId), items);
}

export async function clearQueue(tripId: string): Promise<void> {
  await remove(queueKey(tripId));
}

/**
 * Computes the next retry delay using exponential backoff with jitter.
 * 1st retry ~2s, then 4s, 8s, 16s, 30s (capped). ±25% jitter avoids
 * thundering-herd when many queued messages flush together.
 */
export function nextBackoffMs(attempts: number): number {
  const exp = Math.min(30000, 2000 * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.round(exp * (0.75 + Math.random() * 0.5));
}

/**
 * Determines whether a send error should be retried automatically.
 * Permanent failures (validation, auth, not-found) are not retried so the
 * user can take action. Network errors, 5xx, and 429 are transient.
 */
export function isTransientSendError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 0) return true;
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    return false;
  }
  return true;
}
