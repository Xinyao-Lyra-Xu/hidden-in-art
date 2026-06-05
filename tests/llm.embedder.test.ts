import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatEmbedder } from "@/infrastructure/llm/embedder";
import type { FetchLike } from "@/infrastructure/llm/openaiCompatCaller";
import { resolveEmbeddingConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function embeddingsResponse(vectors: number[][], shuffle = false) {
  const data = vectors.map((embedding, index) => ({ embedding, index }));
  if (shuffle) data.reverse();
  return jsonResponse({ data });
}

test("embedder posts texts to /embeddings and returns one vector each", async () => {
  const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return embeddingsResponse([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  };

  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1/",
    apiKey: "sk-test",
    model: "embed-model",
    fetchImpl,
  });

  const vectors = await embed(["hello", "world"]);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://example.test/v1/embeddings");
  assert.equal(seen[0].init.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "embed-model");
  assert.deepEqual(body.input, ["hello", "world"]);

  assert.deepEqual(vectors, [
    [1, 2, 3],
    [4, 5, 6],
  ]);
});

test("embedder reorders results by the API's index", async () => {
  const fetchImpl: FetchLike = async () =>
    embeddingsResponse(
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      true, // response comes back reversed
    );
  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl,
  });
  const vectors = await embed(["a", "b", "c"]);
  assert.deepEqual(vectors, [
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
});

test("embedder short-circuits an empty input without calling fetch", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return jsonResponse({ data: [] });
  };
  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl,
  });
  assert.deepEqual(await embed([]), []);
  assert.equal(called, false);
});

test("embedder throws on a non-2xx response", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse({ error: "nope" }, false, 429);
  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl,
  });
  await assert.rejects(() => embed(["x"]), /failed \(429\)/);
});

test("embedder throws when the response count doesn't match the input", async () => {
  const fetchImpl: FetchLike = async () => embeddingsResponse([[1, 2, 3]]);
  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl,
  });
  await assert.rejects(() => embed(["a", "b"]), /count mismatch/);
});

test("resolveEmbeddingConfig defaults to Gemini's free embedding model", () => {
  const cfg = resolveEmbeddingConfig({ LLM_API_KEY: "k" });
  assert.equal(cfg.provider, "gemini");
  assert.equal(cfg.model, "gemini-embedding-001");
  assert.equal(cfg.dimensions, 768);
  assert.match(cfg.baseUrl, /generativelanguage/);
});

test("resolveEmbeddingConfig stays on Gemini embeddings even when chat is Groq", () => {
  // Groq has no embeddings API, so the embedder must not follow LLM_PROVIDER.
  const cfg = resolveEmbeddingConfig({ LLM_PROVIDER: "groq", LLM_API_KEY: "k" });
  assert.equal(cfg.model, "gemini-embedding-001");
  assert.match(cfg.baseUrl, /generativelanguage/);
});

test("resolveEmbeddingConfig honors an explicit LLM_EMBED_DIMENSIONS override", () => {
  const cfg = resolveEmbeddingConfig({ LLM_API_KEY: "k", LLM_EMBED_DIMENSIONS: "1536" });
  assert.equal(cfg.dimensions, 1536);
});

test("embedder forwards dimensions in the request body when set", async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl: FetchLike = async (_url, init) => {
    sentBody = JSON.parse(init.body) as Record<string, unknown>;
    return embeddingsResponse([[1, 2]]);
  };
  const embed = createOpenAiCompatEmbedder({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    dimensions: 768,
    fetchImpl,
  });
  await embed(["x"]);
  assert.equal(sentBody.dimensions, 768);
});

test("resolveEmbeddingConfig honors LLM_EMBED_* overrides and key fallback", () => {
  const cfg = resolveEmbeddingConfig({
    LLM_API_KEY: "chat-key",
    LLM_EMBED_PROVIDER: "openai",
    LLM_EMBED_MODEL: "text-embedding-3-large",
  });
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "text-embedding-3-large");
  assert.equal(cfg.apiKey, "chat-key"); // falls back to LLM_API_KEY
});

test("resolveEmbeddingConfig throws MissingLlmKeyError with no key", () => {
  assert.throws(() => resolveEmbeddingConfig({}), MissingLlmKeyError);
});
