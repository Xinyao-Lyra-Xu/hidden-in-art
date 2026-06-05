// A concrete Embedder backed by any OpenAI-compatible /embeddings endpoint
// (Gemini's OpenAI surface, OpenAI, …). Mirrors openaiCompatCaller: base URL,
// model and key are injected, fetch is injectable for offline tests, and the
// same typed errors flow through the retry layer. Returns one vector per input
// text, preserving order (the API echoes an `index` we sort by defensively).

import type { Embedder } from "@/domain/agent/embedder";
import { LlmHttpError, LlmTimeoutError, parseRetryAfterMs } from "./errors";
import type { FetchLike } from "./openaiCompatCaller";

export type EmbedderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Request a specific output vector size (Matryoshka truncation). Omit for the
   * provider default. */
  dimensions?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

type EmbeddingsResponse = {
  data?: { embedding?: number[]; index?: number }[];
};

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/embeddings`;
}

export function createOpenAiCompatEmbedder(config: EmbedderConfig): Embedder {
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = config.timeoutMs ?? 30_000;

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const res = await doFetch(endpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
          ...(config.dimensions !== undefined ? { dimensions: config.dimensions } : {}),
        }),
        signal: controller.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers?.get("retry-after"));
        throw new LlmHttpError(res.status, raw, retryAfterMs);
      }

      let parsed: EmbeddingsResponse;
      try {
        parsed = JSON.parse(raw) as EmbeddingsResponse;
      } catch {
        throw new Error(`Embeddings endpoint returned non-JSON: ${raw.slice(0, 200)}`);
      }

      const data = parsed.data ?? [];
      if (data.length !== texts.length) {
        throw new Error(
          `Embeddings count mismatch: sent ${texts.length}, got ${data.length}.`,
        );
      }
      // Order by the API's index so a reordered response still lines up with the
      // inputs; fall back to response order when index is absent.
      const ordered = data
        .map((d, i) => ({ index: d.index ?? i, embedding: d.embedding }))
        .sort((a, b) => a.index - b.index);
      return ordered.map((d, i) => {
        if (!Array.isArray(d.embedding)) {
          throw new Error(`Embeddings response item ${i} has no embedding vector.`);
        }
        return d.embedding;
      });
    } catch (err) {
      if (timedOut) throw new LlmTimeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
