import { NextRequest } from "next/server";
import { resolveLlmConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatCaller } from "@/infrastructure/llm/openaiCompatCaller";
import { withRetry } from "@/infrastructure/llm/retry";
import { createLogger, newRequestId } from "@/infrastructure/observability/logger";
import {
  rateLimiter,
  concurrencyLimiter,
  turnTokenBudget,
  clientKey,
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
  const key = clientKey(request.headers);
  const rl = rateLimiter.take(key);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    log.warn("rate limited", { key, retryAfterMs: rl.retryAfterMs });
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

  try {
    const result = await runChatTurn({
      message: body.message,
      settings: body.settings,
      library: body.library,
      history: body.history,
      callLlm,
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
