# Hidden in Art

Reconstruct your photo in the brushwork of a famous painting — then talk to a
studio assistant that tunes the render for you in plain language.

The app pairs an image-reconstruction renderer with a **conversational art
agent**: you describe what you want ("make it look like a swirling Van Gogh",
"add more detail", "looser color blending") and the agent calls tools to adjust
the render settings, explaining what it changed.

Built on Next.js (App Router) with a layered, dependency-injected architecture
and a provider-agnostic LLM backend.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # then add a free LLM key (see below)
npm run dev
```

Open <http://localhost:3000>. Load the painting library, then use the **Studio
Assistant** chat box.

### Getting an LLM key (free)

The agent backend is OpenAI-compatible and works across providers. The default
is Google Gemini's free tier:

1. Get a key at <https://aistudio.google.com/apikey>.
2. Put it in `.env.local`:
   ```ini
   LLM_PROVIDER=gemini
   LLM_API_KEY=your-key-here
   LLM_MODEL=gemini-2.5-flash-lite   # generous free daily quota
   ```

Switch providers (OpenAI, Groq, OpenRouter) by changing `LLM_PROVIDER` and the
key — no code changes. See `.env.example` for every option.

---

## How the agent works

Each chat turn runs a tool loop (Anthropic-style messages internally, translated
to the OpenAI dialect for the provider):

1. The client sends the message, current settings, painting library, and recent
   conversation history to `POST /api/agent`.
2. The agent calls the model, which may invoke tools; tools run against the live
   settings and the result is fed back until the model answers in plain text.
3. The updated settings come back and the UI applies them.

**Tools the agent can call:**

| Tool | Effect |
|------|--------|
| `set_target_painting` | Pick a painting by natural-language description |
| `set_patch_density` | More/less detail (patch count) |
| `set_color_matching` | `nearest` / `dither` / `jitter` blending |
| `adjust_abstraction` | More/less abstract |
| `set_focal_region` | Where detail concentrates |
| `search_paintings` | Semantic lookup over the library (story, mood, brushwork) |

The API key lives only on the server; it is never exposed to the browser.

### Semantic retrieval (RAG)

`set_target_painting` and `search_paintings` are backed by embeddings, so the
agent resolves requests by **meaning** — "a swirling emotional sky" finds Van
Gogh, "something calm and domestic" finds Vermeer — and can ground art-history
answers in curated notes the keyword matcher never sees. The corpus vectors are
precomputed offline with `npm run embed` and committed, so at runtime only the
user's query is embedded; unit tests and the offline eval stay deterministic and
key-free. RAG is optional: with no embedding key set, selection falls back to the
deterministic keyword matcher. The embedder is resolved independently of the chat
model (`LLM_EMBED_*`) and defaults to Gemini's free embedding model.

---

## Architecture

Strict layering — dependencies point inward, so the domain stays framework- and
network-free and is fully unit-testable offline.

```
src/
├── domain/              # pure logic, no I/O
│   ├── agent/           # tool defs, settings math, matching, the turn runner
│   ├── artwork/ image/ matching/
├── application/         # use-cases; validates untrusted input, applies defaults
│   └── agentChat.ts
├── infrastructure/      # the outside world (injected into the domain)
│   ├── llm/             # OpenAI-compat caller, translation, retry, config, errors
│   ├── observability/   # structured JSON logger
│   └── ratelimit/       # in-process + Upstash Redis limiters
├── components/          # React UI (AgentChat)
└── lib/                 # client-side API helper
app/api/agent/route.ts   # the HTTP boundary; wires everything together
```

The LLM call is **injected** (`LlmCaller`) everywhere, so the runner and
application layer are tested with scripted responses — no key, no network.

---

## Engineering features

- **Provider-agnostic LLM** — one OpenAI-compatible caller works across Gemini,
  OpenAI, Groq, OpenRouter; env-swappable.
- **Resilience** — typed errors, exponential-backoff retry with jitter on
  429/5xx/timeout (honors `Retry-After`); request timeout via `AbortController`.
- **Multi-turn memory** — the agent remembers prior turns; history is
  client-supplied, sanitized, and windowed server-side.
- **Cost & rate guardrails** — per-turn token budget, `max_tokens`/`temperature`
  caps, a per-client rate limit (429 + `Retry-After`) and an in-flight
  concurrency cap (503).
- **Global rate limiting** — set `UPSTASH_REDIS_REST_URL`/`TOKEN` to share the
  limit across instances (atomic Lua token bucket); falls back to in-process and
  fails open if Redis is unreachable.
- **Observability** — structured JSON logs with a per-request correlation id
  (`x-request-id`), LLM latency, token usage, and tool-call events.
- **Behavioral evals** — offline replay (VCR cassettes; deterministic, no key)
  runs in CI; online recording refreshes the cassettes against the real model.

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Node test runner, offline, no key) |
| `npm run eval` | Behavioral eval — **offline replay** of recorded cassettes |
| `npm run eval:record` | Re-record cassettes against the real model (needs a key) |
| `npm run embed` | Precompute the RAG corpus embeddings (needs a key) |
| `npm run embed:check` | Verify the committed embeddings are in sync (needs a key) |

`npm run eval -- --runs 3` replays multiple times; `npm run eval -- --record --force`
re-records every case.

---

## Environment variables

All optional except `LLM_API_KEY`. See `.env.example` for the full list.

| Var | Default | Purpose |
|-----|---------|---------|
| `LLM_PROVIDER` | `gemini` | `gemini` / `openai` / `groq` / `openrouter` |
| `LLM_API_KEY` | — | **Required.** Provider key (server-side only) |
| `LLM_MODEL` | preset | Override the model |
| `LLM_BASE_URL` | preset | Override the endpoint |
| `LLM_MAX_OUTPUT_TOKENS` | provider | Output-token cap per call |
| `LLM_TEMPERATURE` | provider | Sampling temperature |
| `LLM_TURN_TOKEN_BUDGET` | off | Stop a turn's tool loop at N tokens |
| `RATE_LIMIT_CAPACITY` | `12` | Burst per client |
| `RATE_LIMIT_REFILL_PER_SEC` | `0.5` | Sustained refill rate |
| `MAX_CONCURRENT_TURNS` | `4` | Max in-flight turns |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Enable global (Redis) rate limiting |

---

## Testing & CI

- **Unit tests** are pure and offline (no key, no network) via a Node resolve
  hook that handles the `@/*` alias and TypeScript extensions.
- **CI** (`.github/workflows/ci.yml`) runs lint → typecheck → test → **offline
  eval** → build on every push and PR.

```bash
npm test && npm run typecheck && npm run lint && npm run eval
```

---

## Deploy

Deploys cleanly to [Vercel](https://vercel.com/new). Set the same environment
variables in the project settings. The `/api/agent` route is dynamic
(`force-dynamic`); for a global rate limit across serverless instances, add the
Upstash Redis variables.
