// Process-wide guardrail singletons for the agent endpoint.
//
// These live at module scope so they persist across requests within one server
// instance. Rate limiting upgrades to Upstash Redis (global, cross-instance)
// automatically when UPSTASH_REDIS_REST_URL/TOKEN are set, and falls back to the
// in-process limiter otherwise. Tunable via env with sane defaults.

import {
  createRateLimiter,
  createConcurrencyLimiter,
  type ConcurrencyLimiter,
} from "./limiter";
import { createRedisRateLimiter, type AsyncRateLimiter } from "./redisLimiter";

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function floatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Burst of `capacity` requests per client, refilling at `refillPerSec`.
// Defaults: burst 12, sustained 0.5/s (~30/min) — generous for one creative user.
const CAPACITY = intEnv(process.env.RATE_LIMIT_CAPACITY, 12);
const REFILL = floatEnv(process.env.RATE_LIMIT_REFILL_PER_SEC, 0.5);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Unified async limiter: Redis when configured, else in-process wrapped in a
// resolved promise. The route awaits either transparently.
export const rateLimiter: AsyncRateLimiter =
  UPSTASH_URL && UPSTASH_TOKEN
    ? createRedisRateLimiter({
        url: UPSTASH_URL,
        token: UPSTASH_TOKEN,
        capacity: CAPACITY,
        refillPerSec: REFILL,
        onError: (err) =>
          console.error("[ratelimit] redis error, failing open:", err instanceof Error ? err.message : err),
      })
    : (() => {
        const local = createRateLimiter({ capacity: CAPACITY, refillPerSec: REFILL });
        return { take: async (key: string, cost?: number) => local.take(key, cost) };
      })();

// True when the global (Redis) limiter is active — handy for startup logs.
export const usingGlobalRateLimit = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Cap simultaneous in-flight LLM turns to protect the provider quota.
export const concurrencyLimiter: ConcurrencyLimiter = createConcurrencyLimiter(
  intEnv(process.env.MAX_CONCURRENT_TURNS, 4),
);

// Per-turn token budget handed to the runner (0/unset = no budget).
export function turnTokenBudget(): number | undefined {
  const n = intEnv(process.env.LLM_TURN_TOKEN_BUDGET, 0);
  return n > 0 ? n : undefined;
}

// Best-effort client identifier from proxy headers. Not a security boundary —
// just a key to spread limits across callers.
export function clientKey(headers: { get: (name: string) => string | null }): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "anon";
}
