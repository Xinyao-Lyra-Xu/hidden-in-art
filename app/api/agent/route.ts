import { NextRequest } from "next/server";
import { resolveLlmConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatCaller } from "@/infrastructure/llm/openaiCompatCaller";
import { createOpenAiCompatStreamingCaller } from "@/infrastructure/llm/openaiCompatStreamingCaller";
import { withRetry } from "@/infrastructure/llm/retry";
import { createConfiguredRetriever, ragMinScore } from "@/infrastructure/llm/rag";
import { createLogger, newRequestId } from "@/infrastructure/observability/logger";
import {
  rateLimiter,
  concurrencyLimiter,
  turnTokenBudget,
  clientKey,
  usingGlobalRateLimit,
} from "@/infrastructure/ratelimit/guards";
import { runChatTurn, AgentInputError } from "@/application/agentChat";

// Conversational art-agent endpoint. The LLM API key lives only here on the
// server (via env) and is never exposed to the browser. The client sends the
// user's message, the current render settings, and the painting library; the
// agent runs its tool loop and returns the updated settings to apply.

// POST is never cached by Route Handlers, but be explicit: every turn is live.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const log = createLogger({ base: { requestId, route: "/api/agent" } });
  const startedAt = Date.now();

  // Guardrail 1: per-client rate limit. Reject bursts before any work.
  // Global (Redis) when configured, else in-process — both awaited here.
  const key = clientKey(request.headers);
  const rl = await rateLimiter.take(key);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    log.warn("rate limited", { key, retryAfterMs: rl.retryAfterMs, scope: usingGlobalRateLimit ? "global" : "local" });
    return Response.json(
      { error: "Too many requests — please slow down a moment." },
      {
        status: 429,
        headers: { "x-request-id": requestId, "retry-after": String(retryAfterSec) },
      },
    );
  }

  // Guardrail 2: cap simultaneous in-flight turns (protects provider quota).
  const release = concurrencyLimiter.acquire();
  if (!release) {
    log.warn("at concurrency cap", { inFlight: concurrencyLimiter.inFlight() });
    return Response.json(
      { error: "The studio assistant is busy — please try again shortly." },
      { status: 503, headers: { "x-request-id": requestId, "retry-after": "2" } },
    );
  }

  // Stream the turn over SSE when the client asks for it; otherwise return the
  // one-shot JSON response. Both paths share the guardrails above.
  const wantsStream = (request.headers.get("accept") ?? "").includes("text/event-stream");
  if (wantsStream) {
    // handleTurnStream owns `release` — it's called when the stream ends, errors,
    // or the client disconnects (cancel). release() is idempotent.
    return handleTurnStream(request, requestId, log, startedAt, release);
  }

  try {
    return await handleTurn(request, requestId, log, startedAt);
  } finally {
    release();
  }
}

async function handleTurn(
  request: NextRequest,
  requestId: string,
  log: ReturnType<typeof createLogger>,
  startedAt: number,
): Promise<Response> {
  let body: {
    message?: unknown;
    settings?: unknown;
    library?: unknown;
    history?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    log.warn("bad json body");
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  // Build the provider-backed caller from server-side env, wrapped with retry so
  // transient 429/5xx/timeouts don't surface to the user. A missing key is an
  // operator configuration problem, not a client error.
  let callLlm;
  try {
    const config = resolveLlmConfig();
    log.info("turn start", { provider: config.provider, model: config.model });
    callLlm = withRetry(createOpenAiCompatCaller(config), {
      maxAttempts: 3,
      onRetry: ({ attempt, delayMs, error }) =>
        log.warn("retrying llm call", {
          attempt,
          delayMs,
          reason: error instanceof Error ? error.message.slice(0, 200) : String(error),
        }),
    });
  } catch (err) {
    if (err instanceof MissingLlmKeyError) {
      log.error("llm not configured", { error: err.message });
      return Response.json(
        { error: "The studio assistant isn't configured on the server yet." },
        { status: 500, headers: { "x-request-id": requestId } },
      );
    }
    throw err;
  }

  // Optional semantic retriever (RAG). Null when no embedding key is set — the
  // agent then falls back to the keyword matcher, so a turn never fails for it.
  const retrieve =
    createConfiguredRetriever({
      onRetry: ({ attempt, delayMs }) => log.warn("retrying embed call", { attempt, delayMs }),
      onWarn: (message) => log.warn("rag disabled", { reason: message }),
    }) ?? undefined;

  try {
    const result = await runChatTurn({
      message: body.message,
      settings: body.settings,
      library: body.library,
      history: body.history,
      callLlm,
      retrieve,
      minScore: ragMinScore(),
      maxTokens: turnTokenBudget(),
      onEvent: (event) => log.debug("agent event", { ...event }),
    });
    log.info("turn ok", {
      ms: Date.now() - startedAt,
      toolCalls: result.toolCalls.length,
      replyChars: result.reply.length,
    });
    return Response.json(
      {
        reply: result.reply,
        settings: result.settings,
        toolCalls: result.toolCalls,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (err) {
    if (err instanceof AgentInputError) {
      log.warn("invalid input", { error: err.message });
      return Response.json(
        { error: err.message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }
    // Upstream LLM failure / timeout — keep details out of the client response.
    log.error("turn failed", {
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: "The studio assistant is unavailable right now. Please try again." },
      { status: 502, headers: { "x-request-id": requestId } },
    );
  }
}

type TurnBody = {
  message?: unknown;
  settings?: unknown;
  library?: unknown;
  history?: unknown;
};

// One Server-Sent Events frame: a named event with a JSON data payload.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// SSE variant of handleTurn. Body-parse and configuration errors happen before
// the stream opens and are returned as plain JSON (the client treats any non
// event-stream response as a failure). Once the stream is open, every outcome —
// tool calls, reply deltas, completion, and errors — is delivered as SSE frames.
async function handleTurnStream(
  request: NextRequest,
  requestId: string,
  log: ReturnType<typeof createLogger>,
  startedAt: number,
  release: () => void,
): Promise<Response> {
  let body: TurnBody;
  try {
    body = (await request.json()) as TurnBody;
  } catch {
    release();
    log.warn("bad json body");
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  let callLlm;
  try {
    const config = resolveLlmConfig();
    log.info("turn start", { provider: config.provider, model: config.model, stream: true });
    // request.signal aborts on client disconnect, tearing down the upstream fetch.
    callLlm = withRetry(
      createOpenAiCompatStreamingCaller({ ...config, signal: request.signal }),
      {
        maxAttempts: 3,
        onRetry: ({ attempt, delayMs, error }) =>
          log.warn("retrying llm call", {
            attempt,
            delayMs,
            reason: error instanceof Error ? error.message.slice(0, 200) : String(error),
          }),
      },
    );
  } catch (err) {
    release();
    if (err instanceof MissingLlmKeyError) {
      log.error("llm not configured", { error: err.message });
      return Response.json(
        { error: "The studio assistant isn't configured on the server yet." },
        { status: 500, headers: { "x-request-id": requestId } },
      );
    }
    throw err;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // Stream already torn down (client gone) — stop emitting.
          closed = true;
        }
      };

      const retrieve =
        createConfiguredRetriever({
          onRetry: ({ attempt, delayMs }) => log.warn("retrying embed call", { attempt, delayMs }),
        }) ?? undefined;

      try {
        const result = await runChatTurn({
          message: body.message,
          settings: body.settings,
          library: body.library,
          history: body.history,
          callLlm,
          retrieve,
          minScore: ragMinScore(),
          maxTokens: turnTokenBudget(),
          onEvent: (event) => {
            if (event.type === "text_delta") send("delta", { text: event.delta });
            else if (event.type === "tool_call") send("tool", { name: event.name, ok: event.ok });
            else log.debug("agent event", { ...event });
          },
        });
        log.info("turn ok", {
          ms: Date.now() - startedAt,
          toolCalls: result.toolCalls.length,
          replyChars: result.reply.length,
          stream: true,
        });
        // The reply text already arrived via `delta` frames; `done` carries the
        // authoritative settings to apply plus the tool list for the chips.
        send("done", { settings: result.settings, toolCalls: result.toolCalls });
      } catch (err) {
        if (err instanceof AgentInputError) {
          log.warn("invalid input", { error: err.message });
          send("error", { error: err.message });
        } else {
          log.error("turn failed", {
            ms: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
          send("error", {
            error: "The studio assistant is unavailable right now. Please try again.",
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed/cancelled.
        }
        release();
      }
    },
    cancel() {
      // Client disconnected before the turn finished.
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-request-id": requestId,
    },
  });
}
