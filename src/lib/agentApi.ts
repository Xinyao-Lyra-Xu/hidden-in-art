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
