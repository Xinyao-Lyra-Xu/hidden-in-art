// Application service for one chat turn against the art agent.
//
// Sits between the HTTP route and the domain runner: it validates and
// normalizes untrusted request input, applies defaults, then delegates to
// runAgentTurn with an injected LlmCaller. Keeping the LLM call injected means
// this is unit-testable offline with a scripted caller — the route supplies the
// real provider-backed caller.

import { runAgentTurn, type AgentTurnResult, type LlmCaller } from "@/domain/agent/runner";
import { DEFAULT_SETTINGS, type AgentArtwork, type AgentSettings } from "@/domain/agent/types";

export const MAX_MESSAGE_LENGTH = 2000;

// Thrown for bad client input — the route maps this to HTTP 400.
export class AgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInputError";
  }
}

function isArtwork(value: unknown): value is AgentArtwork {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.title === "string" &&
    typeof a.artist === "string" &&
    typeof a.category === "string" &&
    Array.isArray(a.tags) &&
    Array.isArray(a.mood)
  );
}

export type ChatTurnInput = {
  message: unknown;
  settings?: unknown;
  library: unknown;
  callLlm: LlmCaller;
  maxSteps?: number;
};

export async function runChatTurn(input: ChatTurnInput): Promise<AgentTurnResult> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new AgentInputError("A message is required.");
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new AgentInputError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
  }

  if (!Array.isArray(input.library) || input.library.length === 0) {
    throw new AgentInputError("A non-empty painting library is required.");
  }
  const library = input.library.filter(isArtwork);
  if (library.length === 0) {
    throw new AgentInputError("The painting library is malformed.");
  }

  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS,
    ...(input.settings && typeof input.settings === "object" ? input.settings : {}),
  };

  return runAgentTurn({
    userMessage: message,
    settings,
    library,
    callLlm: input.callLlm,
    maxSteps: input.maxSteps,
  });
}
