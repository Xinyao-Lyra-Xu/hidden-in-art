// A streaming LlmCaller backed by any OpenAI-compatible chat-completions endpoint
// that supports `stream: true` (Gemini's OpenAI surface, Groq, OpenAI, …).
//
// It is the streaming sibling of createOpenAiCompatCaller: same injected config,
// but it reads the provider's Server-Sent Events, forwards each text fragment via
// `args.onText` as it arrives, reassembles streamed tool-call fragments, and then
// returns the SAME LlmResponse shape the non-streaming caller produces (via the
// shared `assembleLlmResponse`). The runner is therefore identical either way —
// streaming is purely additive.

import type { LlmCaller } from "@/domain/agent/runner";
import type { OpenAiCompatConfig } from "./openaiCompatCaller";
import { LlmHttpError, LlmTimeoutError, parseRetryAfterMs } from "./errors";
import {
  assembleLlmResponse,
  toOpenAiMessages,
  toOpenAiTools,
  toTokenUsage,
  type OpenAiRequestBody,
  type OpenAiResponseBody,
  type OpenAiToolCall,
} from "./translate";

export type StreamFetchLike = (
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
  // The SSE byte stream. Null only on malformed responses; we guard for it.
  body: ReadableStream<Uint8Array> | null;
  // Read the (non-streamed) body on a non-2xx error, for the thrown error.
  text: () => Promise<string>;
  headers?: { get: (name: string) => string | null };
}>;

export type OpenAiCompatStreamingConfig = Omit<OpenAiCompatConfig, "fetchImpl"> & {
  fetchImpl?: StreamFetchLike;
  /** Aborts the upstream request (e.g. the client disconnected). */
  signal?: AbortSignal;
};

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

// One streamed `choices[0].delta` chunk. Only the fields we consume are typed;
// the wire payload carries more.
type StreamChunk = {
  choices?: {
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: OpenAiResponseBody["usage"];
};

export function createOpenAiCompatStreamingCaller(
  config: OpenAiCompatStreamingConfig,
): LlmCaller {
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as StreamFetchLike);
  const timeoutMs = config.timeoutMs ?? 60_000;

  return async ({ system, messages, tools, onText }) => {
    const body: OpenAiRequestBody = {
      model: config.model,
      messages: toOpenAiMessages(system, messages),
      tools: toOpenAiTools(tools),
      tool_choice: "auto",
      stream: true,
      stream_options: { include_usage: true },
      ...(config.maxOutputTokens !== undefined ? { max_tokens: config.maxOutputTokens } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

    // One controller drives both the inactivity timeout and external cancellation
    // (client disconnect). Either source aborts the in-flight fetch/read.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (config.signal) {
      if (config.signal.aborted) controller.abort();
      else config.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    // Once we've forwarded any text downstream, a retry would replay it and the
    // client would see the reply twice. Track that so post-emit failures are
    // surfaced as non-retryable. Pre-stream failures (429/5xx HTTP status) trip
    // before this flips, so the common transient case still retries cleanly.
    let emittedText = false;
    const forward = onText
      ? (delta: string) => {
          emittedText = true;
          onText(delta);
        }
      : undefined;

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

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const retryAfterMs = parseRetryAfterMs(res.headers?.get("retry-after"));
        throw new LlmHttpError(res.status, raw, retryAfterMs);
      }
      if (!res.body) {
        throw new Error("LLM streaming response had no body");
      }

      return await consumeStream(res.body, forward);
    } catch (err) {
      if (emittedText) {
        // Partial text already reached the client — make this non-retryable so
        // withRetry won't replay and duplicate it.
        const detail = timedOut
          ? `timed out after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);
        throw new Error(`LLM stream failed mid-response (${detail})`);
      }
      // An abort we triggered via the timeout is a timeout; re-wrap so the retry
      // layer sees it. An external abort surfaces as-is (the route is tearing down).
      if (timedOut) throw new LlmTimeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      config.signal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

// Read the SSE byte stream to completion, forwarding text fragments live and
// accumulating tool-call fragments, then assemble the final LlmResponse.
async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  onText?: (delta: string) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: ReturnType<typeof toTokenUsage>;
  // Tool calls keyed by slot. The OpenAI streaming spec keys fragments by
  // `index` (id/name first, then `arguments` in pieces). Gemini's surface omits
  // `index` and instead delivers each call complete in one array element — so
  // when `index` is absent we assign the next sequential slot, otherwise two
  // calls in one chunk would collapse into one with concatenated (invalid) args.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let nextSeq = 0;

  const handleChunk = (chunk: StreamChunk): void => {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : nextSeq++;
        let acc = toolAcc.get(idx);
        if (!acc) {
          acc = { id: "", name: "", args: "" };
          toolAcc.set(idx, acc);
        }
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
    }
    // Usage is sent in a trailing chunk (we requested include_usage).
    if (chunk.usage) usage = toTokenUsage(chunk.usage);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue; // skip blank lines / comments
      const payload = line.slice("data:".length).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        handleChunk(JSON.parse(payload) as StreamChunk);
      } catch {
        // A partial/garbled JSON line — skip it rather than failing the turn.
      }
    }
  }

  const toolCalls: OpenAiToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, acc]) => ({
      id: acc.id || `call_${idx}`,
      type: "function",
      function: { name: acc.name, arguments: acc.args },
    }));

  return assembleLlmResponse({ text, toolCalls, usage });
}
