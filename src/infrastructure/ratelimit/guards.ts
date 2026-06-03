// Process-wide guardrail singletons for the agent endpoint.
//
// These live at module scope so they persist across requests within one server
// instance. See limiter.ts for the multi-instance caveat (upgrade to Upstash
// Redis for a global limit). Tunable via env with sane defaults.

import {
  createRateLimiter,
  createConcurrencyLimiter,
  type RateLimiter,
  type ConcurrencyLimiter,
} from "./limiter";

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
export const rateLimiter: RateLimiter = createRateLimiter({
  capacity: intEnv(process.env.RATE_LIMIT_CAPACITY, 12),
  refillPerSec: floatEnv(process.env.RATE_LIMIT_REFILL_PER_SEC, 0.5),
});

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
