import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, createConcurrencyLimiter } from "@/infrastructure/ratelimit/limiter";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("allows up to capacity then denies with a retryAfter", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 3, refillPerSec: 1, now: clock.now });

  assert.equal(rl.take("ip").allowed, true);
  assert.equal(rl.take("ip").allowed, true);
  assert.equal(rl.take("ip").allowed, true);
  const denied = rl.take("ip");
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0);
});

test("refills over time at refillPerSec", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now });
  rl.take("ip");
  rl.take("ip");
  assert.equal(rl.take("ip").allowed, false);

  clock.advance(1000); // +1 token
  assert.equal(rl.take("ip").allowed, true);
  assert.equal(rl.take("ip").allowed, false);
});

test("buckets are isolated per key", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 1, refillPerSec: 1, now: clock.now });
  assert.equal(rl.take("a").allowed, true);
  assert.equal(rl.take("a").allowed, false);
  assert.equal(rl.take("b").allowed, true); // different key, fresh bucket
});

test("retryAfterMs reflects the deficit and refill rate", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 1, refillPerSec: 0.5, now: clock.now });
  rl.take("ip");
  const denied = rl.take("ip"); // need 1 token, 0.5/s -> 2000ms
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 2000);
});

test("sweep drops idle buckets", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 1, refillPerSec: 1, now: clock.now });
  rl.take("ip");
  clock.advance(10_000);
  rl.sweep(5000); // ip idle 10s > 5s -> removed
  // After removal the key gets a fresh full bucket again.
  assert.equal(rl.take("ip").allowed, true);
});

test("concurrency limiter caps in-flight and releases", () => {
  const cl = createConcurrencyLimiter(2);
  const r1 = cl.acquire();
  const r2 = cl.acquire();
  assert.ok(r1 && r2);
  assert.equal(cl.inFlight(), 2);
  assert.equal(cl.acquire(), null); // at capacity

  r1!();
  assert.equal(cl.inFlight(), 1);
  const r3 = cl.acquire();
  assert.ok(r3);
  assert.equal(cl.inFlight(), 2);

  // release is idempotent: re-releasing r1 must not double-decrement.
  r1!();
  assert.equal(cl.inFlight(), 2);
});
