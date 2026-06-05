// Resolves LLM connection settings from environment variables.
//
// Defaults to Google Gemini's free OpenAI-compatible endpoint. Point it at
// OpenAI, Groq, OpenRouter, etc. by changing env — no code change. An explicit
// LLM_BASE_URL / LLM_MODEL always overrides the chosen preset.

export type LlmProvider = "gemini" | "openai" | "groq" | "openrouter";

type Preset = { baseUrl: string; model: string };

export const LLM_PRESETS: Record<LlmProvider, Preset> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
  },
};

export type ResolvedLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Output token cap per call (cost guardrail). undefined = provider default. */
  maxOutputTokens?: number;
  /** Sampling temperature. undefined = provider default. */
  temperature?: number;
};

export class MissingLlmKeyError extends Error {
  constructor(provider: LlmProvider) {
    super(
      `No LLM_API_KEY set. Get a free ${provider} key and add LLM_API_KEY to .env.local ` +
        `(see .env.example).`,
    );
    this.name = "MissingLlmKeyError";
  }
}

function isProvider(v: string | undefined): v is LlmProvider {
  return v === "gemini" || v === "openai" || v === "groq" || v === "openrouter";
}

export function resolveLlmConfig(
  env: Record<string, string | undefined> = process.env,
): ResolvedLlmConfig {
  const provider: LlmProvider = isProvider(env.LLM_PROVIDER) ? env.LLM_PROVIDER : "gemini";
  const preset = LLM_PRESETS[provider];
  const apiKey = env.LLM_API_KEY ?? "";
  if (!apiKey) throw new MissingLlmKeyError(provider);

  return {
    provider,
    baseUrl: env.LLM_BASE_URL || preset.baseUrl,
    model: env.LLM_MODEL || preset.model,
    apiKey,
    maxOutputTokens: parsePositiveInt(env.LLM_MAX_OUTPUT_TOKENS),
    temperature: parseTemperature(env.LLM_TEMPERATURE),
  };
}

// ── Embeddings ───────────────────────────────────────────────────────────────
// The RAG embedder is resolved independently of the chat model: not every chat
// provider serves an /embeddings endpoint (Groq and OpenRouter don't), so the
// embedding provider/model/key can be set on their own LLM_EMBED_* env vars and
// default to Gemini's free embedding model regardless of the chat provider. Each
// LLM_EMBED_* var falls back to its LLM_* counterpart when unset.

const GEMINI_EMBED: EmbedPreset = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-embedding-001",
  // gemini-embedding-001 returns 3072 dims by default; truncate via Matryoshka
  // to keep the committed corpus small. Cosine similarity is unaffected.
  dimensions: 768,
};

type EmbedPreset = Preset & { dimensions?: number };

const EMBED_PRESETS: Record<LlmProvider, EmbedPreset> = {
  gemini: GEMINI_EMBED,
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
  // Groq/OpenRouter have no embeddings API; default these to Gemini's so the
  // corpus can still be embedded for free. Override with LLM_EMBED_* to change.
  groq: GEMINI_EMBED,
  openrouter: GEMINI_EMBED,
};

export type ResolvedEmbeddingConfig = {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Output vector size. undefined = provider default. */
  dimensions?: number;
};

export function resolveEmbeddingConfig(
  env: Record<string, string | undefined> = process.env,
): ResolvedEmbeddingConfig {
  const provider: LlmProvider = isProvider(env.LLM_EMBED_PROVIDER)
    ? env.LLM_EMBED_PROVIDER
    : isProvider(env.LLM_PROVIDER)
      ? env.LLM_PROVIDER
      : "gemini";
  const preset = EMBED_PRESETS[provider];
  const apiKey = env.LLM_EMBED_API_KEY || env.LLM_API_KEY || "";
  if (!apiKey) throw new MissingLlmKeyError(provider);

  return {
    provider,
    baseUrl: env.LLM_EMBED_BASE_URL || preset.baseUrl,
    model: env.LLM_EMBED_MODEL || preset.model,
    apiKey,
    dimensions: parsePositiveInt(env.LLM_EMBED_DIMENSIONS) ?? preset.dimensions,
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function parseTemperature(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : undefined;
}
