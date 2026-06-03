// Global (cross-instance) rate limiting backed by Upstash Redis.
//
// The in-process limiter (limiter.ts) only guards a single server instance. On
// Vercel / multi-instance, each instance has its own buckets, so a caller can
// exceed the intended limit by fanning out. This implementation keeps the bucket
// in Redis and mutates it with an atomic Lua script (one REST round-trip), so the
// limit holds no matter how many instances serve the request.
//
// fetch is injectable so the policy is unit-tested against a mock REST endpoint
// without a real database. On any Redis/transport error we FAIL OPEN — a degraded
// limiter must never take the whole feature down.

import type { RateLimitResult } from "./limiter";

export type RedisFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type RedisRateLimiterOptions = {
  url: string;
  token: string;
  capacity: number;
  refillPerSec: number;
  fetchImpl?: RedisFetch;
  now?: () => number;
  onError?: (err: unknown) => void;
};

export type AsyncRateLimiter = {
  take: (key: string, cost?: number) => Promise<RateLimitResult>;
};

// Atomic token bucket. Reads {tokens, ts}, refills by elapsed time, spends `cost`
// if available, and sets a TTL so idle buckets self-expire. Returns
// [allowed, retryAfterMs, remaining].
const BUCKET_SCRIPT = `
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
if tokens == nil then
  tokens = capacity
  ts = now
end
local elapsed = (now - ts) / 1000
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / refill * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
local ttl = math.ceil(capacity / refill) + 10
redis.call('EXPIRE', KEYS[1], ttl)
return {allowed, retry, math.floor(tokens)}
`;

export function createRedisRateLimiter(options: RedisRateLimiterOptions): AsyncRateLimiter {
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as RedisFetch);
  const now = options.now ?? Date.now;
  const base = options.url.replace(/\/+$/, "");

  return {
    async take(key, cost = 1) {
      // Upstash REST: POST a command as a JSON array; reply is { result }.
      const command = [
        "EVAL",
        BUCKET_SCRIPT,
        "1",
        `ratelimit:${key}`,
        String(options.capacity),
        String(options.refillPerSec),
        String(now()),
        String(cost),
      ];
      try {
        const res = await doFetch(base, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(command),
        });
        const raw = await res.text();
        if (!res.ok) throw new Error(`Upstash ${res.status}: ${raw.slice(0, 200)}`);

        const parsed = JSON.parse(raw) as { result?: [number, number, number]; error?: string };
        if (parsed.error) throw new Error(parsed.error);
        const [allowed, retry, remaining] = parsed.result ?? [1, 0, options.capacity];
        return { allowed: allowed === 1, retryAfterMs: retry, remaining };
      } catch (err) {
        // Fail open: never block a real user because the limiter is unreachable.
        options.onError?.(err);
        return { allowed: true, retryAfterMs: 0, remaining: options.capacity };
      }
    },
  };
}
