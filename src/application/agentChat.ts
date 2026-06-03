// Application service for one chat turn against the art agent.
//
// Sits between the HTTP route and the domain runner: it validates and
// normalizes untrusted request input, applies defaults, then delegates to
// runAgentTurn with an injected LlmCaller. Keeping the LLM call injected means
// this is unit-testable offline with a scripted caller — the route supplies the
// real provider-backed caller.

import {
  runAgentTurn,
  type AgentEvent,
  type AgentTurnResult,
  type LlmCaller,
  type Message,
} from "@/domain/agent/runner";
import { DEFAULT_SETTINGS, type AgentArtwork, type AgentSettings } from "@/domain/agent/types";

export const MAX_MESSAGE_LENGTH = 2000;
// Conversation memory is client-supplied and therefore untrusted: keep only the
// most recent turns and a bounded character budget so a malicious or runaway
// client can't blow up the prompt (and the token bill).
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_CHARS = 8000;

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
  onEvent?: (event: AgentEvent) => void;
  // Prior conversation turns from the client. Untrusted: sanitized below.
  history?: unknown;
};

// Sanitize client-supplied conversation history into the text-only Message[] the
// runner prepends. We drop anything that isn't a {role, text} pair, keep only
// the most recent MAX_HISTORY_MESSAGES, and trim oldest-first until under the
// character budget. Tool scaffolding is intentionally NOT replayed.
export function sanitizeHistory(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];

  const clean: Message[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const role = e.role;
    const text = e.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    clean.push({ role, content: trimmed });
  }

  // Keep the most recent messages.
  let windowed = clean.slice(-MAX_HISTORY_MESSAGES);

  // Trim oldest-first until within the character budget.
  const charsOf = (m: Message) => (typeof m.content === "string" ? m.content.length : 0);
  let total = windowed.reduce((sum, m) => sum + charsOf(m), 0);
  while (total > MAX_HISTORY_CHARS && windowed.length > 0) {
    total -= charsOf(windowed[0]);
    windowed = windowed.slice(1);
  }

  return windowed;
}

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
    onEvent: input.onEvent,
    history: sanitizeHistory(input.history),
  });
}
