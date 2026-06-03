// Retry/backoff decorator for any LlmCaller.
//
// Production LLM endpoints fail transiently: 429 rate limits, 5xx blips, and
// network timeouts. withRetry wraps a caller so those are retried with
// exponential backoff plus jitter, honoring a server-supplied Retry-After when
// present. Permanent failures (4xx other than 429, validation errors) are NOT
// retried — they'd just fail again. `sleep` and `random` are injectable so the
// policy is unit-tested without real waiting.

import type { LlmCaller } from "@/domain/agent/runner";
import { LlmHttpError, LlmTimeoutError } from "./errors";

export type RetryOptions = {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms (grows ~2^n). Default 500. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff wait. Default 8000. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Observability hook fired before each retry wait. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

/** Is this failure worth retrying, or is it permanent? */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof LlmTimeoutError) return true;
  if (err instanceof LlmHttpError) {
    return err.status === 429 || err.status === 408 || err.status >= 500;
  }
  // fetch throws a TypeError on DNS/connection failures — treat as transient.
  if (err instanceof TypeError) return true;
  return false;
}

/**
 * Compute the wait before the next attempt. A server-suggested Retry-After wins
 * (still capped). Otherwise exponential growth with "equal jitter": half fixed,
 * half random, so retries don't thunder in lockstep.
 */
export function backoffDelayMs(
  attempt: number, // 1-based: the attempt that just failed
  opts: { baseDelayMs: number; maxDelayMs: number; retryAfterMs?: number; random: () => number },
): number {
  if (opts.retryAfterMs !== undefined) {
    return Math.min(opts.retryAfterMs, opts.maxDelayMs);
  }
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  const half = exp / 2;
  return Math.round(half + opts.random() * half);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function withRetry(caller: LlmCaller, options: RetryOptions = {}): LlmCaller {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  return async (args) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await caller(args);
      } catch (err) {
        lastError = err;
        const isLast = attempt >= maxAttempts;
        if (isLast || !isRetryableError(err)) throw err;

        const retryAfterMs = err instanceof LlmHttpError ? err.retryAfterMs : undefined;
        const delayMs = backoffDelayMs(attempt, {
          baseDelayMs,
          maxDelayMs,
          retryAfterMs,
          random,
        });
        options.onRetry?.({ attempt, delayMs, error: err });
        await sleep(delayMs);
      }
    }
    // Unreachable: the loop either returns or throws, but satisfy the compiler.
    throw lastError;
  };
}
