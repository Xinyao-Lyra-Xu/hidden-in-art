import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedisRateLimiter, type RedisFetch } from "@/infrastructure/ratelimit/redisLimiter";

function mockFetch(result: [number, number, number]): { fetchImpl: RedisFetch; calls: () => unknown[] } {
  const calls: unknown[] = [];
  const fetchImpl: RedisFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ result }) };
  };
  return { fetchImpl, calls: () => calls };
}

test("posts an EVAL command to Upstash with auth and the bucket key", async () => {
  const { fetchImpl, calls } = mockFetch([1, 0, 5]);
  const rl = createRedisRateLimiter({
    url: "https://x.upstash.io/",
    token: "tok",
    capacity: 6,
    refillPerSec: 1,
    fetchImpl,
    now: () => 1000,
  });

  const res = await rl.take("1.2.3.4");
  assert.deepEqual(res, { allowed: true, retryAfterMs: 0, remaining: 5 });

  const call = calls()[0] as { url: string; body: string[] };
  assert.equal(call.url, "https://x.upstash.io"); // trailing slash trimmed
  assert.equal(call.body[0], "EVAL");
  assert.equal(call.body[2], "1"); // numkeys
  assert.equal(call.body[3], "ratelimit:1.2.3.4");
  assert.equal(call.body[4], "6"); // capacity
  assert.equal(call.body[7], "1"); // cost
});

test("maps a denied result to allowed:false with retryAfterMs", async () => {
  const { fetchImpl } = mockFetch([0, 2000, 0]);
  const rl = createRedisRateLimiter({
    url: "https://x.upstash.io",
    token: "tok",
    capacity: 3,
    refillPerSec: 0.5,
    fetchImpl,
  });
  const res = await rl.take("ip");
  assert.equal(res.allowed, false);
  assert.equal(res.retryAfterMs, 2000);
});

test("fails open when Redis is unreachable", async () => {
  const fetchImpl: RedisFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  let sawError = false;
  const rl = createRedisRateLimiter({
    url: "https://x.upstash.io",
    token: "tok",
    capacity: 9,
    refillPerSec: 1,
    fetchImpl,
    onError: () => (sawError = true),
  });
  const res = await rl.take("ip");
  assert.equal(res.allowed, true); // never block on limiter failure
  assert.equal(res.remaining, 9);
  assert.equal(sawError, true);
});

test("fails open on a non-200 / error payload", async () => {
  const fetchImpl: RedisFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "upstream boom",
  });
  const rl = createRedisRateLimiter({
    url: "https://x.upstash.io",
    token: "tok",
    capacity: 4,
    refillPerSec: 1,
    fetchImpl,
  });
  const res = await rl.take("ip");
  assert.equal(res.allowed, true);
});
