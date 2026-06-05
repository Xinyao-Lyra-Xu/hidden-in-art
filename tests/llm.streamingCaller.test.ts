import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAiCompatStreamingCaller,
  type StreamFetchLike,
} from "@/infrastructure/llm/openaiCompatStreamingCaller";
import { LlmHttpError } from "@/infrastructure/llm/errors";
import { ART_AGENT_TOOLS } from "@/domain/agent/tools";
import type { TextBlock, ToolUseBlock } from "@/domain/agent/runner";

// One SSE data frame carrying a JSON chunk.
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// A StreamFetchLike that replays `chunks` (arbitrary byte boundaries) as the SSE
// body, or a non-2xx error when `error` is given.
function streamFetch(
  chunks: string[],
  error?: { status: number; body?: string; retryAfter?: string },
): StreamFetchLike {
  const enc = new TextEncoder();
  return async () => {
    if (error) {
      return {
        ok: false,
        status: error.status,
        body: null,
        text: async () => error.body ?? "",
        headers: { get: (n: string) => (n === "retry-after" ? error.retryAfter ?? null : null) },
      };
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    return { ok: true, status: 200, body, text: async () => "", headers: { get: () => null } };
  };
}

const baseConfig = { baseUrl: "https://example.test/v1", apiKey: "k", model: "m" };

function call(fetchImpl: StreamFetchLike, onText?: (d: string) => void) {
  const caller = createOpenAiCompatStreamingCaller({ ...baseConfig, fetchImpl });
  return caller({
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    tools: ART_AGENT_TOOLS,
    onText,
  });
}

test("streams text fragments in order and assembles an end_turn response", async () => {
  const fetchImpl = streamFetch([
    sse({ choices: [{ delta: { content: "Hello" } }] }),
    sse({ choices: [{ delta: { content: " there" } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    "data: [DONE]\n\n",
  ]);

  const deltas: string[] = [];
  const res = await call(fetchImpl, (d) => deltas.push(d));

  assert.deepEqual(deltas, ["Hello", " there"]);
  assert.equal(res.stop_reason, "end_turn");
  assert.equal((res.content[0] as TextBlock).text, "Hello there");
  assert.equal(res.usage?.totalTokens, 15);
});

test("reassembles tool-call arguments fragmented across chunks", async () => {
  const fetchImpl = streamFetch([
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_a", function: { name: "set_target_painting", arguments: "" } },
            ],
          },
        },
      ],
    }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"van ' } }] } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'gogh"}' } }] } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    "data: [DONE]\n\n",
  ]);

  const deltas: string[] = [];
  const res = await call(fetchImpl, (d) => deltas.push(d));

  assert.deepEqual(deltas, []); // no assistant text in a pure tool turn
  assert.equal(res.stop_reason, "tool_use");
  const block = res.content.find((b): b is ToolUseBlock => b.type === "tool_use");
  assert.ok(block);
  assert.equal(block.id, "call_a");
  assert.equal(block.name, "set_target_painting");
  assert.deepEqual(block.input, { query: "van gogh" });
});

test("keeps two index-less tool calls separate (Gemini shape)", async () => {
  // Gemini's OpenAI surface streams each tool call complete in one array element
  // and omits `index`. Two calls in one chunk must NOT collapse into one.
  const fetchImpl = streamFetch([
    sse({
      choices: [
        {
          delta: {
            role: "assistant",
            tool_calls: [
              {
                type: "function",
                id: "function-call-1",
                function: {
                  name: "set_target_painting",
                  arguments: '{"query":"The Starry Night"}',
                },
              },
              {
                type: "function",
                id: "function-call-2",
                function: {
                  name: "set_patch_density",
                  arguments: '{"direction":"more","amount":"slight"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);

  const res = await call(fetchImpl);
  assert.equal(res.stop_reason, "tool_use");
  const tools = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "set_target_painting");
  assert.deepEqual(tools[0].input, { query: "The Starry Night" });
  assert.equal(tools[1].name, "set_patch_density");
  assert.deepEqual(tools[1].input, { direction: "more", amount: "slight" });
});

test("buffers frames split across read boundaries", async () => {
  // A single data frame arrives in two byte chunks, split mid-JSON.
  const fetchImpl = streamFetch([
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo"}}]}\n\n',
    "data: [DONE]\n\n",
  ]);

  const res = await call(fetchImpl);
  assert.equal((res.content[0] as TextBlock).text, "Hello");
});

test("throws a retryable LlmHttpError on a non-2xx status", async () => {
  const fetchImpl = streamFetch([], { status: 429, body: "slow down", retryAfter: "2" });
  await assert.rejects(
    () => call(fetchImpl),
    (err: unknown) => err instanceof LlmHttpError && err.status === 429 && err.retryAfterMs === 2000,
  );
});
