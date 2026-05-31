import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  runAgentTurn,
  type LlmCaller,
  type LlmResponse,
  type ToolUseBlock,
} from "@/domain/agent/runner";
import { DEFAULT_SETTINGS } from "@/domain/agent/types";
import { FIXTURE_LIBRARY } from "./fixtures";

// ── Scripted LLM helpers ─────────────────────────────────────────────────────
let toolId = 0;
function toolUse(name: string, input: Record<string, unknown>): ToolUseBlock {
  return { type: "tool_use", id: `tool_${++toolId}`, name, input };
}
function textResp(text: string): LlmResponse {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}
function toolResp(...uses: ToolUseBlock[]): LlmResponse {
  return { stop_reason: "tool_use", content: uses };
}

// Returns a caller that replays a fixed script, plus a record of every call so
// tests can assert what the agent sent to the model.
function scripted(responses: LlmResponse[]) {
  const calls: Parameters<LlmCaller>[0][] = [];
  let i = 0;
  const caller: LlmCaller = async (args) => {
    calls.push(args);
    return responses[Math.min(i++, responses.length - 1)];
  };
  return { caller, calls };
}

const base = {
  settings: DEFAULT_SETTINGS,
  library: FIXTURE_LIBRARY,
};

test("runs tools, applies the patches, then returns the final text", async () => {
  const { caller, calls } = scripted([
    toolResp(
      toolUse("set_target_painting", { query: "Van Gogh swirling sky" }),
      toolUse("set_patch_density", { direction: "more", amount: "slight" }),
    ),
    textResp("Switched to Van Gogh and tightened the texture a bit."),
  ]);

  const result = await runAgentTurn({
    userMessage: "use a swirling van gogh look, a bit more detail",
    callLlm: caller,
    ...base,
  });

  // Settings were updated by the tools
  assert.equal(result.settings.targetArtworkId, "met-437984");
  assert.equal(result.settings.patchCount, 2900); // 2500 + slight(400)

  // Both tool calls are reported and succeeded
  assert.equal(result.toolCalls.length, 2);
  assert.ok(result.toolCalls.every((c) => c.ok));

  // Final assistant text is returned
  assert.match(result.reply, /Van Gogh/);

  // The agent made exactly two model calls (tool round + final round)
  assert.equal(calls.length, 2);
  // First call carried the tool definitions and a system prompt
  assert.ok(calls[0].tools.length > 0);
  assert.ok(calls[0].system.includes("Hidden in Art"));

  // Transcript shape: user, assistant(tool_use), user(tool_result), assistant(text)
  const roles = result.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
  const toolResultMsg = result.messages[2];
  assert.ok(Array.isArray(toolResultMsg.content));
  assert.equal((toolResultMsg.content as { type: string }[])[0].type, "tool_result");
});

test("returns text directly when the model calls no tools", async () => {
  const { caller, calls } = scripted([textResp("Your current setup already looks great!")]);

  const result = await runAgentTurn({
    userMessage: "how does it look?",
    callLlm: caller,
    ...base,
  });

  assert.equal(calls.length, 1);
  assert.equal(result.toolCalls.length, 0);
  assert.deepEqual(result.settings, DEFAULT_SETTINGS); // unchanged
  assert.match(result.reply, /looks great/);
});

test("surfaces tool failures without changing settings, then continues", async () => {
  const { caller } = scripted([
    toolResp(toolUse("set_target_painting", { query: "a painting that does not exist" })),
    textResp("I couldn't find that one — want to try Monet or Van Gogh?"),
  ]);

  const result = await runAgentTurn({
    userMessage: "use the lost masterpiece style",
    callLlm: caller,
    ...base,
  });

  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].ok, false);
  assert.equal(result.settings.targetArtworkId, null); // unchanged
  assert.match(result.reply, /couldn't find/);
});

test("stops at maxSteps instead of looping forever", async () => {
  // A pathological model that always asks for another tool, never answering.
  const caller: LlmCaller = async () =>
    toolResp(toolUse("set_patch_density", { direction: "more", amount: "slight" }));

  const result = await runAgentTurn({
    userMessage: "keep going",
    callLlm: caller,
    maxSteps: 3,
    ...base,
  });

  // Exactly maxSteps tool rounds, then a graceful fallback reply
  assert.equal(result.toolCalls.length, 3);
  assert.ok(result.reply.length > 0);
  // patchCount climbed by 3 × slight(400), clamped within bounds
  assert.equal(result.settings.patchCount, 2500 + 3 * 400);
});

test("buildSystemPrompt reflects the live settings and library", () => {
  const prompt = buildSystemPrompt(
    { ...DEFAULT_SETTINGS, patchCount: 3100, colorMatch: "dither" },
    FIXTURE_LIBRARY,
  );
  assert.match(prompt, /patches=3100/);
  assert.match(prompt, /colorMatch=dither/);
  assert.match(prompt, /Monet/);
});
