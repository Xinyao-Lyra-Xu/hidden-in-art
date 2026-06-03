// In-process rate limiting and concurrency guards.
//
// IMPORTANT: state lives in this process only. On serverless / multi-instance
// deployments each instance has its own buckets, so this is a best-effort guard
// (and a real one for single-instance / local dev), NOT a global limit. The
// upgrade path is a shared store (Upstash Redis) behind the same interface.
//
// Both helpers take an injectable clock so the policy is unit-tested without
// real time passing.

export type RateLimitResult = { allowed: boolean; retryAfterMs: number; remaining: number };

export type RateLimiterOptions = {
  /** Max tokens in a bucket (burst size). */
  capacity: number;
  /** Tokens regenerated per second (sustained rate). */
  refillPerSec: number;
  now?: () => number;
};

type Bucket = { tokens: number; lastRefill: number };

export type RateLimiter = {
  /** Try to spend `cost` tokens for `key`. */
  take: (key: string, cost?: number) => RateLimitResult;
  /** Drop buckets idle longer than maxIdleMs (call periodically to cap memory). */
  sweep: (maxIdleMs: number) => void;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSec } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, t: number): void {
    const elapsedSec = Math.max(0, (t - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
    bucket.lastRefill = t;
  }

  return {
    take(key, cost = 1) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefill: t };
        buckets.set(key, bucket);
      }
      refill(bucket, t);

      if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        return { allowed: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
      }
      const deficit = cost - bucket.tokens;
      const retryAfterMs = refillPerSec > 0 ? Math.ceil((deficit / refillPerSec) * 1000) : Infinity;
      return { allowed: false, retryAfterMs, remaining: Math.floor(bucket.tokens) };
    },
    sweep(maxIdleMs) {
      const t = now();
      for (const [key, bucket] of buckets) {
        if (t - bucket.lastRefill > maxIdleMs) buckets.delete(key);
      }
    },
  };
}

export type ConcurrencyLimiter = {
  /** Acquire a slot; returns a release fn, or null if at capacity. */
  acquire: () => (() => void) | null;
  inFlight: () => number;
};

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  let inFlight = 0;
  return {
    acquire() {
      if (inFlight >= max) return null;
      inFlight++;
      let released = false;
      return () => {
        if (released) return; // idempotent
        released = true;
        inFlight--;
      };
    },
    inFlight: () => inFlight,
  };
}
