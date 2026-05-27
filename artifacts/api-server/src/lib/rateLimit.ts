// Tiny in-memory token-bucket / fixed-window limiter. Sufficient for a single
// node demo deployment. Replace with Redis-backed limiter for horizontal scale.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface LimitResult {
  ok: boolean;
  retryAfterMs: number;
  remaining: number;
}

export function checkLimit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0, remaining: max - 1 };
  }
  if (b.count >= max) {
    return { ok: false, retryAfterMs: b.resetAt - now, remaining: 0 };
  }
  b.count += 1;
  return { ok: true, retryAfterMs: 0, remaining: max - b.count };
}

// periodic cleanup so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref?.();
