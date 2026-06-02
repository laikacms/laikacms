/**
 * Tiny in-memory token bucket per key. Production: swap for Redis (e.g.
 * `rate-limiter-flexible`) — interface stays the same.
 */
interface Bucket {
  tokens: number;
  refilledAt: number;
}

export interface RateLimit {
  check(key: string): { ok: true } | { ok: false, retryAfterSeconds: number };
}

export function createRateLimit({
  capacity,
  refillPerSecond,
}: {
  capacity: number,
  refillPerSecond: number,
}): RateLimit {
  const buckets = new Map<string, Bucket>();
  return {
    check(key) {
      const now = Date.now();
      const b = buckets.get(key) ?? { tokens: capacity, refilledAt: now };
      const elapsed = (now - b.refilledAt) / 1000;
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSecond);
      b.refilledAt = now;
      if (b.tokens < 1) {
        buckets.set(key, b);
        return { ok: false, retryAfterSeconds: Math.ceil((1 - b.tokens) / refillPerSecond) };
      }
      b.tokens -= 1;
      buckets.set(key, b);
      return { ok: true };
    },
  };
}
