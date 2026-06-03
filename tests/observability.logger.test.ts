import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, newRequestId } from "@/infrastructure/observability/logger";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (l) => lines.push(l),
    now: () => new Date("2026-06-02T00:00:00.000Z"),
  });
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test("emits one JSON line per call with level, ts, and msg", () => {
  const { logger, parsed } = capture();
  logger.info("hello", { foo: 1 });
  const [rec] = parsed();
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "hello");
  assert.equal(rec.ts, "2026-06-02T00:00:00.000Z");
  assert.equal(rec.foo, 1);
});

test("child logger merges bound fields into every line", () => {
  const { logger, parsed } = capture();
  const child = logger.child({ requestId: "abc123" });
  child.warn("watch out");
  child.error("boom", { code: 500 });
  const recs = parsed();
  assert.equal(recs[0].requestId, "abc123");
  assert.equal(recs[0].level, "warn");
  assert.equal(recs[1].requestId, "abc123");
  assert.equal(recs[1].code, 500);
});

test("explicit fields override bound fields", () => {
  const { logger, parsed } = capture();
  logger.child({ stage: "a" }).info("x", { stage: "b" });
  assert.equal(parsed()[0].stage, "b");
});

test("newRequestId returns a short non-empty id", () => {
  const id = newRequestId();
  assert.equal(typeof id, "string");
  assert.ok(id.length >= 6);
  assert.notEqual(newRequestId(), id);
});
