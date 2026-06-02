import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatTurn, AgentInputError, MAX_MESSAGE_LENGTH } from "@/application/agentChat";
import { DEFAULT_SETTINGS } from "@/domain/agent/types";
import type { LlmCaller, LlmResponse } from "@/domain/agent/runner";
import { FIXTURE_LIBRARY } from "./fixtures";

const endTurn = (text: string): LlmResponse => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
});

const replyOnly: LlmCaller = async () => endTurn("Looks great as-is!");

test("rejects an empty message", async () => {
  await assert.rejects(
    () => runChatTurn({ message: "   ", library: FIXTURE_LIBRARY, callLlm: replyOnly }),
    AgentInputError,
  );
});

test("rejects an over-long message", async () => {
  await assert.rejects(
    () =>
      runChatTurn({
        message: "x".repeat(MAX_MESSAGE_LENGTH + 1),
        library: FIXTURE_LIBRARY,
        callLlm: replyOnly,
      }),
    AgentInputError,
  );
});

test("rejects a missing or empty library", async () => {
  await assert.rejects(
    () => runChatTurn({ message: "hi", library: [], callLlm: replyOnly }),
    AgentInputError,
  );
  await assert.rejects(
    () => runChatTurn({ message: "hi", library: undefined, callLlm: replyOnly }),
    AgentInputError,
  );
});

test("rejects a malformed library", async () => {
  await assert.rejects(
    () => runChatTurn({ message: "hi", library: [{ nope: true }], callLlm: replyOnly }),
    AgentInputError,
  );
});

test("runs a turn and applies tool patches over default settings", async () => {
  let i = 0;
  const script: LlmResponse[] = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "set_target_painting", input: { query: "van gogh" } },
      ],
    },
    endTurn("Switched to Van Gogh."),
  ];
  const caller: LlmCaller = async () => script[Math.min(i++, script.length - 1)];

  const result = await runChatTurn({
    message: "use a van gogh look",
    library: FIXTURE_LIBRARY,
    callLlm: caller,
  });

  assert.equal(result.settings.targetArtworkId, "met-437984");
  assert.equal(result.toolCalls.length, 1);
  assert.ok(result.toolCalls[0].ok);
  assert.match(result.reply, /Van Gogh/);
});

test("merges provided settings onto defaults", async () => {
  const result = await runChatTurn({
    message: "how does it look?",
    settings: { patchCount: 3300 },
    library: FIXTURE_LIBRARY,
    callLlm: replyOnly,
  });
  // Provided field overrides default, untouched fields keep their default.
  assert.equal(result.settings.patchCount, 3300);
  assert.equal(result.settings.colorMatch, DEFAULT_SETTINGS.colorMatch);
  assert.equal(result.toolCalls.length, 0);
});
