import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runChatTurn,
  sanitizeHistory,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_CHARS,
} from "@/application/agentChat";
import type { LlmCaller, Message } from "@/domain/agent/runner";
import { FIXTURE_LIBRARY } from "./fixtures";

test("sanitizeHistory drops malformed entries and keeps {role,text}", () => {
  const out = sanitizeHistory([
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
    { role: "system", text: "ignore me" }, // bad role
    { role: "user" }, // missing text
    { role: "user", text: "   " }, // empty after trim
    { nope: true },
    null,
    "garbage",
  ]);
  assert.deepEqual(out, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
});

test("sanitizeHistory returns [] for non-array input", () => {
  assert.deepEqual(sanitizeHistory(undefined), []);
  assert.deepEqual(sanitizeHistory("nope"), []);
  assert.deepEqual(sanitizeHistory({ role: "user", text: "x" }), []);
});

test("sanitizeHistory windows to the most recent MAX_HISTORY_MESSAGES", () => {
  const many = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    text: `m${i}`,
  }));
  const out = sanitizeHistory(many);
  assert.equal(out.length, MAX_HISTORY_MESSAGES);
  // newest kept, oldest dropped
  assert.equal(out.at(-1)?.content, `m${MAX_HISTORY_MESSAGES + 4}`);
  assert.equal(out[0]?.content, "m5");
});

test("sanitizeHistory trims oldest-first to stay under the char budget", () => {
  const big = "x".repeat(3000);
  const out = sanitizeHistory([
    { role: "user", text: big },
    { role: "assistant", text: big },
    { role: "user", text: big }, // 9000 > 8000 -> oldest dropped
  ]);
  const total = out.reduce(
    (s, m) => s + (typeof m.content === "string" ? m.content.length : 0),
    0,
  );
  assert.ok(total <= MAX_HISTORY_CHARS);
  assert.equal(out.length, 2);
});

test("runChatTurn prepends sanitized history before the new message", async () => {
  let seen: Message[] = [];
  const caller: LlmCaller = async ({ messages }) => {
    seen = [...messages]; // snapshot: the runner mutates this array afterward
    return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
  };

  await runChatTurn({
    message: "and now?",
    history: [
      { role: "user", text: "use van gogh" },
      { role: "assistant", text: "Switched to Van Gogh." },
      { role: "assistant", text: "" }, // dropped
    ],
    library: FIXTURE_LIBRARY,
    callLlm: caller,
  });

  assert.equal(seen.length, 3); // 2 history + 1 new user message
  assert.equal(seen[0].content, "use van gogh");
  assert.equal(seen[1].content, "Switched to Van Gogh.");
  assert.equal(seen[2].content, "and now?");
  assert.equal(seen[2].role, "user");
});
