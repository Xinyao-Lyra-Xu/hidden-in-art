import { NextRequest } from "next/server";
import { resolveLlmConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatCaller } from "@/infrastructure/llm/openaiCompatCaller";
import { runChatTurn, AgentInputError } from "@/application/agentChat";

// Conversational art-agent endpoint. The LLM API key lives only here on the
// server (via env) and is never exposed to the browser. The client sends the
// user's message, the current render settings, and the painting library; the
// agent runs its tool loop and returns the updated settings to apply.

// POST is never cached by Route Handlers, but be explicit: every turn is live.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { message?: unknown; settings?: unknown; library?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Build the provider-backed caller from server-side env. A missing key is an
  // operator configuration problem, not a client error.
  let callLlm;
  try {
    callLlm = createOpenAiCompatCaller(resolveLlmConfig());
  } catch (err) {
    if (err instanceof MissingLlmKeyError) {
      return Response.json(
        { error: "The studio assistant isn't configured on the server yet." },
        { status: 500 },
      );
    }
    throw err;
  }

  try {
    const result = await runChatTurn({
      message: body.message,
      settings: body.settings,
      library: body.library,
      callLlm,
    });
    return Response.json({
      reply: result.reply,
      settings: result.settings,
      toolCalls: result.toolCalls,
    });
  } catch (err) {
    if (err instanceof AgentInputError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    // Upstream LLM failure / timeout — keep details out of the client response.
    console.error("[api/agent] turn failed:", err);
    return Response.json(
      { error: "The studio assistant is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
