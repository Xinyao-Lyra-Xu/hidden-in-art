// A concrete LlmCaller backed by any OpenAI-compatible chat-completions endpoint
// (Gemini's OpenAI surface, Groq, OpenAI, OpenRouter…). The base URL, model and
// key are all injected, and fetch is injectable so the caller is testable
// without a network round-trip.

import type { LlmCaller } from "@/domain/agent/runner";
import { LlmHttpError, LlmTimeoutError, parseRetryAfterMs } from "./errors";
import {
  fromOpenAiResponse,
  toOpenAiMessages,
  toOpenAiTools,
  type OpenAiRequestBody,
  type OpenAiResponseBody,
} from "./translate";

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  // Real fetch Responses expose this; tests may omit it. Used to read Retry-After.
  headers?: { get: (name: string) => string | null };
}>;

export type OpenAiCompatConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Cap output tokens per call to bound cost. Omitted = provider default. */
  maxOutputTokens?: number;
  /** Sampling temperature. Omitted = provider default. */
  temperature?: number;
};

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function createOpenAiCompatCaller(config: OpenAiCompatConfig): LlmCaller {
  const doFetch = (config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  const timeoutMs = config.timeoutMs ?? 30_000;

  return async ({ system, messages, tools }) => {
    const body: OpenAiRequestBody = {
      model: config.model,
      messages: toOpenAiMessages(system, messages),
      tools: toOpenAiTools(tools),
      tool_choice: "auto",
      ...(config.maxOutputTokens !== undefined ? { max_tokens: config.maxOutputTokens } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

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
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers?.get("retry-after"));
        throw new LlmHttpError(res.status, raw, retryAfterMs);
      }

      let parsed: OpenAiResponseBody;
      try {
        parsed = JSON.parse(raw) as OpenAiResponseBody;
      } catch {
        throw new Error(`LLM returned non-JSON response: ${raw.slice(0, 200)}`);
      }
      return fromOpenAiResponse(parsed);
    } catch (err) {
      // An abort we triggered is a timeout; re-wrap so the retry layer sees it.
      if (timedOut) throw new LlmTimeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
