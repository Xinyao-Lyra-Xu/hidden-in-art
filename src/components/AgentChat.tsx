"use client";

import { useEffect, useRef, useState } from "react";
import { streamAgentTurn } from "@/lib/agentApi";
import type { AgentArtwork, AgentSettings } from "@/domain/agent/types";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; ok: boolean }[];
};

type Props = {
  settings: AgentSettings;
  library: AgentArtwork[];
  onApply: (settings: AgentSettings) => void;
  disabled?: boolean;
};

const SUGGESTIONS = [
  "Use a swirling Van Gogh look",
  "Make it more abstract",
  "Add more detail",
  "Try a dramatic portrait",
];

export default function AgentChat({ settings, library, onApply, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Update the trailing assistant bubble (the one we stream into).
  function updateAssistant(fn: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === "assistant") next[next.length - 1] = fn(last);
      return next;
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || disabled) return;

    // Snapshot prior turns as conversational memory before appending this one.
    const history = messages.map((m) => ({ role: m.role, text: m.text }));

    setInput("");
    setError(null);
    // Append the user turn plus an empty assistant bubble to stream into.
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message },
      { role: "assistant", text: "", tools: [] },
    ]);
    setBusy(true);

    try {
      const res = await streamAgentTurn({
        message,
        settings,
        library,
        history,
        onDelta: (chunk) => updateAssistant((m) => ({ ...m, text: m.text + chunk })),
        onTool: (tool) =>
          updateAssistant((m) => ({ ...m, tools: [...(m.tools ?? []), tool] })),
      });
      onApply(res.settings);
      // Reconcile the chips with the authoritative final tool list and guarantee
      // a non-empty reply.
      updateAssistant((m) => ({
        ...m,
        text: m.text || "Done.",
        tools: res.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // Drop the placeholder bubble if nothing streamed into it.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.text === "") return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded border border-neutral-200 bg-white/60 p-3 shadow-sm backdrop-blur sm:p-5">
      <p className="museum-label mb-3 text-neutral-500">Studio Assistant</p>

      {messages.length === 0 ? (
        <p className="mb-3 text-sm leading-6 text-neutral-500">
          Tell me how you want your photo reimagined — pick a painting, dial the detail up or down,
          or make it looser. I&apos;ll adjust the controls for you.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="mb-3 max-h-64 space-y-2 overflow-y-auto pr-1"
          aria-live="polite"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded px-3 py-2 text-sm leading-snug ${
                  m.role === "user"
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-800 ring-1 ring-neutral-200"
                }`}
              >
                {m.role === "assistant" && m.text === "" ? (
                  <span className="inline-flex gap-1" aria-label="Adjusting">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
                  </span>
                ) : (
                  <p>{m.text}</p>
                )}
                {m.tools && m.tools.length > 0 && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-neutral-400">
                    {m.tools.map((t) => `${t.ok ? "✓" : "✕"} ${t.name}`).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled || busy}
              onClick={() => send(s)}
              className="rounded-full border border-neutral-200 bg-white/70 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-neutral-400 hover:bg-white disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          disabled={disabled || busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? "Load the painting library first…" : "Ask the assistant…"}
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:bg-neutral-100"
        />
        <button
          type="submit"
          disabled={disabled || busy || input.trim().length === 0}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition active:scale-[0.97] disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
