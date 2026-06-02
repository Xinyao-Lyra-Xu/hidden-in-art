import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatCaller, type FetchLike } from "@/infrastructure/llm/openaiCompatCaller";
import { resolveLlmConfig, MissingLlmKeyError, LLM_PRESETS } from "@/infrastructure/llm/config";
import { ART_AGENT_TOOLS } from "@/domain/agent/tools";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

test("caller posts to /chat/completions with auth header and translated body", async () => {
  const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return jsonResponse({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }],
    });
  };

  const caller = createOpenAiCompatCaller({
    baseUrl: "https://example.test/v1/",
    apiKey: "sk-test",
    model: "test-model",
    fetchImpl,
  });

  const res = await caller({
    system: "SYS",
    messages: [{ role: "user", content: "hi" }],
    tools: ART_AGENT_TOOLS,
  });

  assert.equal(seen.length, 1);
  // trailing slash on baseUrl is normalized
  assert.equal(seen[0].url, "https://example.test/v1/chat/completions");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].role, "system");
  assert.ok(body.tools.length > 0);

  assert.equal(res.stop_reason, "end_turn");
  assert.match((res.content[0] as { text: string }).text, /done/);
});

test("caller throws a descriptive error on non-2xx", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse({ error: "nope" }, false, 401);
  const caller = createOpenAiCompatCaller({
    baseUrl: "https://example.test/v1",
    apiKey: "bad",
    model: "m",
    fetchImpl,
  });
  await assert.rejects(
    () => caller({ system: "s", messages: [{ role: "user", content: "x" }], tools: ART_AGENT_TOOLS }),
    /failed \(401\)/,
  );
});

test("resolveLlmConfig defaults to the gemini preset", () => {
  const cfg = resolveLlmConfig({ LLM_API_KEY: "k" });
  assert.equal(cfg.provider, "gemini");
  assert.equal(cfg.baseUrl, LLM_PRESETS.gemini.baseUrl);
  assert.equal(cfg.model, LLM_PRESETS.gemini.model);
});

test("resolveLlmConfig honors provider preset and explicit overrides", () => {
  const cfg = resolveLlmConfig({
    LLM_PROVIDER: "groq",
    LLM_API_KEY: "k",
    LLM_MODEL: "custom-model",
  });
  assert.equal(cfg.provider, "groq");
  assert.equal(cfg.baseUrl, LLM_PRESETS.groq.baseUrl); // preset
  assert.equal(cfg.model, "custom-model"); // override wins
});

test("resolveLlmConfig throws when no key is present", () => {
  assert.throws(() => resolveLlmConfig({}), MissingLlmKeyError);
});
