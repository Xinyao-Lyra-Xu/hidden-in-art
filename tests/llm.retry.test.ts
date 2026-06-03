import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withRetry,
  isRetryableError,
  backoffDelayMs,
  type RetryOptions,
} from "@/infrastructure/llm/retry";
import { LlmHttpError, LlmTimeoutError, parseRetryAfterMs } from "@/infrastructure/llm/errors";
import type { LlmCaller, LlmResponse } from "@/domain/agent/runner";

const ok: LlmResponse = { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] };

// Never actually wait in tests.
const noWait: RetryOptions = { sleep: async () => {}, random: () => 0.5 };

function callerThatFailsThenSucceeds(failures: number, error: unknown): {
  caller: LlmCaller;
  calls: () => number;
} {
  let n = 0;
  const caller: LlmCaller = async () => {
    n++;
    if (n <= failures) throw error;
    return ok;
  };
  return { caller, calls: () => n };
}

test("isRetryableError: 429 / 5xx / 408 / timeout are retryable; 4xx is not", () => {
  assert.equal(isRetryableError(new LlmHttpError(429)), true);
  assert.equal(isRetryableError(new LlmHttpError(503)), true);
  assert.equal(isRetryableError(new LlmHttpError(408)), true);
  assert.equal(isRetryableError(new LlmTimeoutError(30000)), true);
  assert.equal(isRetryableError(new TypeError("network down")), true);
  assert.equal(isRetryableError(new LlmHttpError(401)), false);
  assert.equal(isRetryableError(new LlmHttpError(400)), false);
  assert.equal(isRetryableError(new Error("boom")), false);
});

test("retries a transient 429 and then succeeds", async () => {
  const { caller, calls } = callerThatFailsThenSucceeds(2, new LlmHttpError(429));
  const wrapped = withRetry(caller, { ...noWait, maxAttempts: 3 });
  const res = await wrapped({ system: "s", messages: [], tools: [] });
  assert.equal(res.stop_reason, "end_turn");
  assert.equal(calls(), 3); // 2 failures + 1 success
});

test("does not retry a permanent 401", async () => {
  const { caller, calls } = callerThatFailsThenSucceeds(1, new LlmHttpError(401));
  const wrapped = withRetry(caller, { ...noWait, maxAttempts: 5 });
  await assert.rejects(() => wrapped({ system: "s", messages: [], tools: [] }), LlmHttpError);
  assert.equal(calls(), 1); // gave up immediately, no retry
});

test("gives up after maxAttempts and rethrows the last error", async () => {
  const { caller, calls } = callerThatFailsThenSucceeds(99, new LlmHttpError(500));
  const wrapped = withRetry(caller, { ...noWait, maxAttempts: 3 });
  await assert.rejects(() => wrapped({ system: "s", messages: [], tools: [] }), LlmHttpError);
  assert.equal(calls(), 3);
});

test("fires onRetry with attempt + delay for each retry", async () => {
  const { caller } = callerThatFailsThenSucceeds(2, new LlmHttpError(503));
  const seen: { attempt: number; delayMs: number }[] = [];
  const wrapped = withRetry(caller, {
    ...noWait,
    maxAttempts: 3,
    onRetry: ({ attempt, delayMs }) => seen.push({ attempt, delayMs }),
  });
  await wrapped({ system: "s", messages: [], tools: [] });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].attempt, 1);
  assert.equal(seen[1].attempt, 2);
});

test("backoff grows exponentially and is capped", () => {
  const base = { baseDelayMs: 500, maxDelayMs: 8000, random: () => 1 }; // max jitter -> full exp
  assert.equal(backoffDelayMs(1, base), 500); // half(250) + 1*half(250)
  assert.equal(backoffDelayMs(2, base), 1000);
  assert.equal(backoffDelayMs(3, base), 2000);
  assert.equal(backoffDelayMs(20, base), 8000); // capped
});

test("backoff honors a server Retry-After (capped to maxDelay)", () => {
  const r = backoffDelayMs(1, {
    baseDelayMs: 500,
    maxDelayMs: 8000,
    random: () => 0.5,
    retryAfterMs: 3000,
  });
  assert.equal(r, 3000);
  const capped = backoffDelayMs(1, {
    baseDelayMs: 500,
    maxDelayMs: 8000,
    random: () => 0.5,
    retryAfterMs: 999999,
  });
  assert.equal(capped, 8000);
});

test("parseRetryAfterMs accepts seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("30"), 30000);
  assert.equal(parseRetryAfterMs(null), undefined);
  assert.equal(parseRetryAfterMs("   "), undefined);
  assert.equal(parseRetryAfterMs("not-a-date"), undefined);
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const future = new Date(now + 5000).toUTCString();
  assert.equal(parseRetryAfterMs(future, now), 5000);
  const past = new Date(now - 5000).toUTCString();
  assert.equal(parseRetryAfterMs(past, now), 0);
});
