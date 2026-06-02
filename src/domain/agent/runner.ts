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

export type LlmResponse = {
  stop_reason: "tool_use" | "end_turn";
  content: ContentBlock[];
};

export type LlmCaller = (args: {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
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

const DEFAULT_MAX_STEPS = 8;

export function buildSystemPrompt(settings: AgentSettings, library: AgentArtwork[]): string {
  const target = settings.targetArtworkId ?? "none";
  const catalog = library
    .map((a) => `- ${a.title} by ${a.artist} [${a.tags.join(", ")}]`)
    .join("\n");

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
}): Promise<AgentTurnResult> {
  const { userMessage, callLlm, library } = args;
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;

  let settings: AgentSettings = { ...args.settings };
  const messages: Message[] = [{ role: "user", content: userMessage }];
  const toolCalls: ToolCallRecord[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const response = await callLlm({
      system: buildSystemPrompt(settings, library),
      messages,
      tools: ART_AGENT_TOOLS,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { reply: textOf(response.content), settings, toolCalls, messages };
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    const results: ToolResultBlock[] = [];

    for (const use of toolUses) {
      const result = executeTool(use.name, use.input, { settings, library });
      if (result.ok) settings = { ...settings, ...result.patch };
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
  }

  // Ran out of steps without a plain-text answer — return a graceful fallback so
  // the caller always gets a non-empty reply instead of an endless loop.
  return {
    reply: "I've made several adjustments — take a look and tell me what to tweak next.",
    settings,
    toolCalls,
    messages,
  };
}
