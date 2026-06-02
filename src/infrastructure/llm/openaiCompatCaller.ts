// A concrete LlmCaller backed by any OpenAI-compatible chat-completions endpoint
// (Gemini's OpenAI surface, Groq, OpenAI, OpenRouter…). The base URL, model and
// key are all injected, and fetch is injectable so the caller is testable
// without a network round-trip.

import type { LlmCaller } from "@/domain/agent/runner";
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
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type OpenAiCompatConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
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
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        throw new Error(`LLM request failed (${res.status}): ${raw.slice(0, 500)}`);
      }

      let parsed: OpenAiResponseBody;
      try {
        parsed = JSON.parse(raw) as OpenAiResponseBody;
      } catch {
        throw new Error(`LLM returned non-JSON response: ${raw.slice(0, 200)}`);
      }
      return fromOpenAiResponse(parsed);
    } finally {
      clearTimeout(timer);
    }
  };
}
