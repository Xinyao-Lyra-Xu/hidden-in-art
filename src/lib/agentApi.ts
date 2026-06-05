// Client-side helper for talking to the /api/agent route.
//
// Converts the renderer's ArtworkMetadata into the trimmed AgentArtwork the
// agent matches on, and wraps the POST with typed success/error handling so the
// chat component stays declarative.

import type { AgentArtwork, AgentSettings } from "@/domain/agent/types";
import type { ToolCallRecord } from "@/domain/agent/runner";
import type { ArtworkMetadata } from "@/domain/artwork/types";

export function toAgentLibrary(artworks: ArtworkMetadata[]): AgentArtwork[] {
  return artworks.map((a) => ({
    id: a.id,
    title: a.title,
    artist: a.artist,
    category: a.category ?? "",
    tags: a.tags ?? [],
    mood: a.mood ?? [],
  }));
}

export type AgentTurnResponse = {
  reply: string;
  settings: AgentSettings;
  toolCalls: ToolCallRecord[];
};

// Prior turns sent back so the agent has conversational memory. Text-only.
export type ChatHistoryEntry = { role: "user" | "assistant"; text: string };

export async function sendAgentTurn(args: {
  message: string;
  settings: AgentSettings;
  library: AgentArtwork[];
  history?: ChatHistoryEntry[];
  signal?: AbortSignal;
}): Promise<AgentTurnResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: args.message,
      settings: args.settings,
      library: args.library,
      history: args.history ?? [],
    }),
    signal: args.signal,
  });

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "The studio assistant is unavailable right now.";
    throw new Error(message);
  }

  return data as AgentTurnResponse;
}

// What a streamed turn yields once complete: the authoritative settings to apply
// and the tool list (the reply text is delivered incrementally via onDelta).
export type AgentTurnStreamResult = {
  settings: AgentSettings;
  toolCalls: ToolCallRecord[];
};

function errorMessageOf(data: unknown): string {
  return data && typeof data === "object" && "error" in data
    ? String((data as { error: unknown }).error)
    : "The studio assistant is unavailable right now.";
}

// Streaming sibling of sendAgentTurn. Requests SSE; reply text arrives via
// onDelta and tool results via onTool as they happen, then the final settings
// are returned. A pre-stream failure (bad request, rate limit, not configured)
// comes back as a JSON error and is thrown, matching sendAgentTurn's contract.
export async function streamAgentTurn(args: {
  message: string;
  settings: AgentSettings;
  library: AgentArtwork[];
  history?: ChatHistoryEntry[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onTool: (tool: { name: string; ok: boolean }) => void;
}): Promise<AgentTurnStreamResult> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message: args.message,
      settings: args.settings,
      library: args.library,
      history: args.history ?? [],
    }),
    signal: args.signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data: unknown = await res.json().catch(() => null);
    throw new Error(errorMessageOf(data));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AgentTurnStreamResult | null = null;
  let streamError: string | null = null;

  // Parse one SSE frame ("event: <name>\ndata: <json>") and dispatch it.
  const handleFrame = (raw: string): void => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }
    if (dataLines.length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "delta") {
      args.onDelta(String((data as { text?: unknown }).text ?? ""));
    } else if (event === "tool") {
      const t = data as { name?: unknown; ok?: unknown };
      args.onTool({ name: String(t.name ?? ""), ok: Boolean(t.ok) });
    } else if (event === "done") {
      result = data as AgentTurnStreamResult;
    } else if (event === "error") {
      streamError = errorMessageOf(data);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer); // flush any trailing frame

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("The studio assistant ended unexpectedly.");
  return result;
}
