import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromOpenAiResponse,
  toOpenAiMessages,
  toOpenAiTools,
  type OpenAiMessage,
} from "@/infrastructure/llm/translate";
import { ART_AGENT_TOOLS } from "@/domain/agent/tools";
import type { Message } from "@/domain/agent/runner";

test("toOpenAiTools maps each agent tool to a function tool", () => {
  const tools = toOpenAiTools(ART_AGENT_TOOLS);
  assert.equal(tools.length, ART_AGENT_TOOLS.length);
  for (const t of tools) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.length > 0);
    assert.equal((t.function.parameters as { type: string }).type, "object");
  }
});

test("toOpenAiMessages prepends the system prompt and keeps plain user text", () => {
  const messages: Message[] = [{ role: "user", content: "use a van gogh look" }];
  const out = toOpenAiMessages("SYS", messages);
  assert.deepEqual(out[0], { role: "system", content: "SYS" });
  assert.deepEqual(out[1], { role: "user", content: "use a van gogh look" });
});

test("assistant tool_use becomes tool_calls; tool_result fans out to tool messages", () => {
  const messages: Message[] = [
    { role: "user", content: "more detail" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "t1", name: "set_patch_density", input: { direction: "more" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "Patch density now 3400." }],
    },
  ];

  const out = toOpenAiMessages("SYS", messages);

  const assistant = out.find((m): m is Extract<OpenAiMessage, { role: "assistant" }> => m.role === "assistant");
  assert.ok(assistant);
  assert.equal(assistant.content, "ok");
  assert.equal(assistant.tool_calls?.length, 1);
  assert.equal(assistant.tool_calls?.[0].function.name, "set_patch_density");
  assert.deepEqual(JSON.parse(assistant.tool_calls![0].function.arguments), { direction: "more" });

  const tool = out.find((m) => m.role === "tool");
  assert.deepEqual(tool, { role: "tool", tool_call_id: "t1", content: "Patch density now 3400." });
});

test("assistant message with only tool_use has null content", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "t9", name: "set_focal_region", input: { region: "center" } }],
    },
  ];
  const out = toOpenAiMessages("SYS", messages);
  const assistant = out[1] as Extract<OpenAiMessage, { role: "assistant" }>;
  assert.equal(assistant.content, null);
  assert.equal(assistant.tool_calls?.length, 1);
});

test("fromOpenAiResponse maps tool_calls to tool_use with parsed input", () => {
  const res = fromOpenAiResponse({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "set_target_painting", arguments: '{"query":"Monet"}' } },
          ],
        },
      },
    ],
  });
  assert.equal(res.stop_reason, "tool_use");
  assert.equal(res.content.length, 1);
  assert.deepEqual(res.content[0], {
    type: "tool_use",
    id: "c1",
    name: "set_target_painting",
    input: { query: "Monet" },
  });
});

test("fromOpenAiResponse maps a plain message to end_turn text", () => {
  const res = fromOpenAiResponse({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "All set!" } }],
  });
  assert.equal(res.stop_reason, "end_turn");
  assert.deepEqual(res.content, [{ type: "text", text: "All set!" }]);
});

test("fromOpenAiResponse tolerates malformed tool arguments", () => {
  const res = fromOpenAiResponse({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{ id: "c2", type: "function", function: { name: "set_patch_density", arguments: "not json" } }],
        },
      },
    ],
  });
  assert.equal(res.stop_reason, "tool_use");
  assert.deepEqual((res.content[0] as { input: unknown }).input, {});
});
