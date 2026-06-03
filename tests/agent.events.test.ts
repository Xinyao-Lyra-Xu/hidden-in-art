import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn, type AgentEvent, type LlmCaller, type LlmResponse } from "@/domain/agent/runner";
import { DEFAULT_SETTINGS } from "@/domain/agent/types";
import { FIXTURE_LIBRARY } from "./fixtures";

test("emits llm_call + turn_end events with usage on a plain reply", async () => {
  const caller: LlmCaller = async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Looks great." }],
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  });

  const events: AgentEvent[] = [];
  await runAgentTurn({
    userMessage: "how does it look?",
    settings: { ...DEFAULT_SETTINGS },
    library: FIXTURE_LIBRARY,
    callLlm: caller,
    onEvent: (e) => events.push(e),
  });

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["llm_call_start", "llm_call_end", "turn_end"]);

  const end = events.find((e) => e.type === "llm_call_end");
  assert.ok(end && end.type === "llm_call_end");
  assert.equal(end.usage?.totalTokens, 120);
  assert.equal(typeof end.ms, "number");
});

test("emits a tool_call event for each tool the model invokes", async () => {
  let i = 0;
  const script: LlmResponse[] = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "set_target_painting", input: { query: "van gogh" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Switched." }] },
  ];
  const caller: LlmCaller = async () => script[Math.min(i++, script.length - 1)];

  const events: AgentEvent[] = [];
  await runAgentTurn({
    userMessage: "use a van gogh look",
    settings: { ...DEFAULT_SETTINGS },
    library: FIXTURE_LIBRARY,
    callLlm: caller,
    onEvent: (e) => events.push(e),
  });

  const toolEvents = events.filter((e) => e.type === "tool_call");
  assert.equal(toolEvents.length, 1);
  assert.ok(toolEvents[0].type === "tool_call" && toolEvents[0].name === "set_target_painting");
  assert.equal(toolEvents[0].type === "tool_call" && toolEvents[0].ok, true);
});

test("stops at the token budget and emits budget_exceeded", async () => {
  // A model that keeps calling tools forever, reporting tokens each time.
  const caller: LlmCaller = async () => ({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t", name: "adjust_abstraction", input: { direction: "more" } }],
    usage: { promptTokens: 300, completionTokens: 200, totalTokens: 500 },
  });

  const events: AgentEvent[] = [];
  const result = await runAgentTurn({
    userMessage: "more more more",
    settings: { ...DEFAULT_SETTINGS },
    library: FIXTURE_LIBRARY,
    callLlm: caller,
    maxSteps: 20,
    maxTokens: 1200, // ~3 calls of 500 -> stops at step 3, not 20
    onEvent: (e) => events.push(e),
  });

  assert.ok(events.some((e) => e.type === "budget_exceeded"));
  assert.ok(!events.some((e) => e.type === "max_steps")); // budget tripped first
  const llmCalls = events.filter((e) => e.type === "llm_call_start").length;
  assert.ok(llmCalls < 20 && llmCalls >= 3);
  assert.match(result.reply, /limit/i);
});
