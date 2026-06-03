// Translation between the agent's Anthropic-style message shapes and the
// OpenAI chat-completions wire format.
//
// The agent runner speaks Anthropic blocks (text / tool_use / tool_result);
// most free providers (Gemini, Groq, OpenAI itself, OpenRouter…) speak the
// OpenAI dialect. Keeping the conversion here as pure functions means a single
// fetch caller works against any of them, and the mapping is unit-tested without
// a network call or an API key.

import type {
  ContentBlock,
  LlmResponse,
  Message,
  TextBlock,
  TokenUsage,
  ToolUseBlock,
} from "@/domain/agent/runner";
import type { ToolDefinition } from "@/domain/agent/tools";

export type OpenAiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAiRequestBody = {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  tool_choice?: "auto";
  max_tokens?: number;
  temperature?: number;
};

export type OpenAiResponseBody = {
  choices?: {
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function toTokenUsage(usage: OpenAiResponseBody["usage"]): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export function toOpenAiTools(tools: ToolDefinition[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function blocksOf(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

export function toOpenAiMessages(system: string, messages: Message[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    const blocks = blocksOf(message.content);

    if (message.role === "assistant") {
      const text = blocks
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls: OpenAiToolCall[] = blocks
        .filter((b): b is ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: "assistant",
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // role === "user": either a plain prompt or a batch of tool results. OpenAI
    // wants one `tool` message per tool_call_id, so fan them out.
    let pushedToolResult = false;
    for (const block of blocks) {
      if (block.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.content });
        pushedToolResult = true;
      }
    }
    if (!pushedToolResult) {
      const text = blocks
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      out.push({ role: "user", content: text });
    }
  }

  return out;
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function fromOpenAiResponse(body: OpenAiResponseBody): LlmResponse {
  const message = body.choices?.[0]?.message;
  const toolCalls = message?.tool_calls ?? [];
  const usage = toTokenUsage(body.usage);

  if (toolCalls.length > 0) {
    const content: ContentBlock[] = [];
    if (message?.content) content.push({ type: "text", text: message.content });
    for (const call of toolCalls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      });
    }
    return { stop_reason: "tool_use", content, usage };
  }

  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: message?.content ?? "" }],
    usage,
  };
}
