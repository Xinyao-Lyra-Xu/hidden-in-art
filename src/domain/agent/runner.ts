// The agent turn loop.
//
// runAgentTurn drives one user message to completion: call the model, run any
// tools it requests against the live settings, feed the results back, and repeat
// until the model answers in plain text (or we hit maxSteps). The model call
// itself is injected as `callLlm`, so this stays free of any SDK or network and
// is exercised in tests with a scripted caller. Message and content shapes match
// the Anthropic Messages API.

import { ART_AGENT_TOOLS, executeTool, type ToolDefinition } from "./tools";
import type { AgentArtwork, AgentSettings } from "./types";
import type { Retriever } from "./retriever";
import { PAINTING_DESCRIPTIONS, STROKE_DESCRIPTIONS } from "@/domain/artwork/paintingInfo";

// Tools whose `query` input is semantically searched against the corpus before
// the tool runs. The runner embeds the query (async) and hands the hits to the
// otherwise-synchronous executeTool via ToolContext.retrieval.
const RETRIEVAL_TOOLS = new Set(["search_paintings", "set_target_painting"]);

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmResponse = {
  stop_reason: "tool_use" | "end_turn";
  content: ContentBlock[];
  usage?: TokenUsage;
};

export type LlmCaller = (args: {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  // Optional streaming hook: a caller that streams its response invokes this with
  // each text fragment as it arrives. Non-streaming callers (tests, eval, VCR)
  // simply never call it, so behaviour is unchanged for them.
  onText?: (delta: string) => void;
}) => Promise<LlmResponse>;

export type ToolCallRecord = {
  name: string;
  ok: boolean;
  summary: string;
  input: Record<string, unknown>;
};

export type AgentTurnResult = {
  reply: string;
  settings: AgentSettings;
  toolCalls: ToolCallRecord[];
  messages: Message[];
};

// Observability events emitted during a turn. The runner stays free of any
// logger or I/O — it just calls an injected sink if one is provided, so the
// route can wire these to structured logs while tests stay silent.
export type AgentEvent =
  | { type: "llm_call_start"; step: number }
  | { type: "llm_call_end"; step: number; stopReason: string; ms: number; usage?: TokenUsage }
  | { type: "text_delta"; step: number; delta: string }
  | { type: "tool_call"; step: number; name: string; ok: boolean; ms: number }
  | { type: "turn_end"; steps: number; toolCalls: number; replyChars: number; totalTokens: number }
  | { type: "max_steps"; steps: number }
  | { type: "budget_exceeded"; totalTokens: number; budget: number };

const DEFAULT_MAX_STEPS = 8;

// Monotonic clock with a wall-clock fallback for environments without it.
const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// When a painting is the active style, fold its curatorial notes into the prompt
// so the agent can speak to the *current* painting's story and brushwork without
// a search round-trip. Pure id→text lookup, no embedding cost. Empty when no
// target is set or the notes are missing.
function buildTargetGrounding(settings: AgentSettings, library: AgentArtwork[]): string {
  const id = settings.targetArtworkId;
  if (!id) return "";
  const art = library.find((a) => a.id === id);
  if (!art) return "";
  const description = PAINTING_DESCRIPTIONS[id];
  const strokes = STROKE_DESCRIPTIONS[id];
  if (!description && !strokes) return "";

  const lines = [`Current painting — "${art.title}" by ${art.artist}:`];
  if (description) lines.push(`  ${description}`);
  if (strokes) lines.push(`  Brushwork: ${strokes}`);
  return lines.join("\n");
}

export function buildSystemPrompt(settings: AgentSettings, library: AgentArtwork[]): string {
  const target = settings.targetArtworkId ?? "none";
  const catalog = library
    .map((a) => `- ${a.title} by ${a.artist} [${a.tags.join(", ")}]`)
    .join("\n");
  const grounding = buildTargetGrounding(settings, library);

  return [
    "You are the Hidden in Art studio assistant. You help the user reconstruct",
    "their photo in the brushwork of a famous painting by adjusting render",
    "settings through tools. Make the smallest change that satisfies the request,",
    "then briefly confirm what you did in plain language.",
    "",
    "Current settings:",
    `  target=${target}`,
    `  patches=${settings.patchCount}`,
    `  colorMatch=${settings.colorMatch}`,
    `  abstraction=${settings.abstraction}`,
    `  focalRegion=${settings.focalRegion}`,
    // Only present once a painting is chosen; lets the agent discuss it directly.
    ...(grounding ? ["", grounding] : []),
    "",
    "Painting library:",
    catalog,
  ].join("\n");
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function runAgentTurn(args: {
  userMessage: string;
  callLlm: LlmCaller;
  settings: AgentSettings;
  library: AgentArtwork[];
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
  // Prior conversation turns (text-only, no tool scaffolding) to give the model
  // memory across messages. Validated/capped upstream in the application layer.
  history?: Message[];
  // Stop the tool loop once cumulative token usage reaches this budget, so a
  // misbehaving model can't run up an unbounded bill. undefined = no budget.
  maxTokens?: number;
  // Semantic retrieval over the painting corpus (RAG). Injected like callLlm so
  // the domain stays network-free; absent = the keyword matcher handles
  // selection and search_paintings reports nothing found.
  retrieve?: Retriever;
}): Promise<AgentTurnResult> {
  const { userMessage, callLlm, library, retrieve } = args;
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxTokens = args.maxTokens;
  const emit = args.onEvent ?? (() => {});

  let settings: AgentSettings = { ...args.settings };
  const messages: Message[] = [
    ...(args.history ?? []),
    { role: "user", content: userMessage },
  ];
  const toolCalls: ToolCallRecord[] = [];
  let totalTokens = 0;

  for (let step = 0; step < maxSteps; step++) {
    emit({ type: "llm_call_start", step });
    const startedAt = nowMs();
    const response = await callLlm({
      system: buildSystemPrompt(settings, library),
      messages,
      tools: ART_AGENT_TOOLS,
      // Forward streamed text fragments as events. A streaming caller drives this
      // live; a non-streaming caller leaves it untouched (no text_delta emitted).
      onText: (delta) => {
        if (delta) emit({ type: "text_delta", step, delta });
      },
    });
    totalTokens += response.usage?.totalTokens ?? 0;
    emit({
      type: "llm_call_end",
      step,
      stopReason: response.stop_reason,
      ms: Math.round(nowMs() - startedAt),
      usage: response.usage,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const reply = textOf(response.content);
      emit({
        type: "turn_end",
        steps: step + 1,
        toolCalls: toolCalls.length,
        replyChars: reply.length,
        totalTokens,
      });
      return { reply, settings, toolCalls, messages };
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    const results: ToolResultBlock[] = [];

    for (const use of toolUses) {
      const toolStartedAt = nowMs();
      // For retrieval-aware tools, embed the query and resolve corpus hits first,
      // then run the (synchronous) tool with those hits in context. A failed or
      // absent retriever degrades to no hits rather than aborting the turn.
      let retrieval;
      if (retrieve && RETRIEVAL_TOOLS.has(use.name)) {
        const query = typeof use.input.query === "string" ? use.input.query : "";
        if (query) {
          try {
            retrieval = await retrieve(query);
          } catch {
            retrieval = undefined;
          }
        }
      }
      const result = executeTool(use.name, use.input, { settings, library, retrieval });
      if (result.ok) settings = { ...settings, ...result.patch };
      emit({
        type: "tool_call",
        step,
        name: use.name,
        ok: result.ok,
        ms: Math.round(nowMs() - toolStartedAt),
      });
      toolCalls.push({
        name: use.name,
        ok: result.ok,
        summary: result.summary,
        input: use.input,
      });
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: result.summary,
        is_error: !result.ok,
      });
    }

    messages.push({ role: "user", content: results });

    // Stop early if we've spent the token budget rather than starting another
    // (paid) round-trip. The applied settings still come back to the user.
    if (maxTokens !== undefined && totalTokens >= maxTokens) {
      emit({ type: "budget_exceeded", totalTokens, budget: maxTokens });
      const reply = "I've applied what I could within this turn's limit — tell me what to refine.";
      // The model never produced this text, so stream it as one delta to keep the
      // SSE client's "reply = concatenated text_deltas" contract uniform.
      emit({ type: "text_delta", step, delta: reply });
      emit({
        type: "turn_end",
        steps: step + 1,
        toolCalls: toolCalls.length,
        replyChars: reply.length,
        totalTokens,
      });
      return { reply, settings, toolCalls, messages };
    }
  }

  // Ran out of steps without a plain-text answer — return a graceful fallback so
  // the caller always gets a non-empty reply instead of an endless loop.
  emit({ type: "max_steps", steps: maxSteps });
  const reply =
    "I've made several adjustments — take a look and tell me what to tweak next.";
  // Stream the synthesized reply as one delta (see budget path above).
  emit({ type: "text_delta", step: maxSteps, delta: reply });
  emit({
    type: "turn_end",
    steps: maxSteps,
    toolCalls: toolCalls.length,
    replyChars: reply.length,
    totalTokens,
  });
  return {
    reply,
    settings,
    toolCalls,
    messages,
  };
}
