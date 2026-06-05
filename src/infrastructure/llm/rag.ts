// Assembles the production semantic retriever from the committed corpus
// embeddings and a provider-backed embedder.
//
// The vectors and their curatorial text are loaded once from embeddings.json
// (built offline by `npm run embed`), so the knowledge base is server-
// authoritative and the only per-turn network cost is embedding the user's
// query. RAG is optional: if no embedding key is configured the factory returns
// null and the agent falls back to the deterministic keyword matcher.

import embeddingsData from "./embeddings.json";
import { resolveEmbeddingConfig, MissingLlmKeyError } from "./config";
import { createOpenAiCompatEmbedder } from "./embedder";
import { withRetryFn } from "./retry";
import { createRetriever, type Retriever } from "@/domain/agent/retriever";
import type { CorpusDoc } from "@/domain/agent/corpus";
import type { VectorDoc } from "@/domain/agent/retrieval";
import type { Embedder } from "@/domain/agent/embedder";
import { getDb } from "@/infrastructure/db/client";
import { createDbRetriever } from "@/infrastructure/db/retriever";

type EmbeddingsFile = {
  model: string;
  dim: number;
  generatedAt: string;
  docs: { id: string; title: string; artist: string; text: string; vector: number[] }[];
};

const data = embeddingsData as EmbeddingsFile;

// Split the committed file into the two shapes the domain retriever wants, once
// at module load. Frozen so the shared arrays can't be mutated mid-request.
const CORPUS: CorpusDoc[] = data.docs.map((d) => ({
  id: d.id,
  title: d.title,
  artist: d.artist,
  text: d.text,
}));
const VECTORS: VectorDoc[] = data.docs.map((d) => ({ id: d.id, vector: d.vector }));

export const ragModel = data.model;
export const ragDocCount = data.docs.length;

// Optional cosine floor for search_paintings, read from LLM_RAG_MIN_SCORE.
// Off by default: the on-vs-off-topic score gap is narrow and model-specific,
// so a baked-in default would be brittle. Operators who've measured their
// model's distribution can opt in (≈0.5 suits gemini-embedding-001). Returns
// undefined for unset/blank/non-finite values.
export function ragMinScore(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env.LLM_RAG_MIN_SCORE;
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// The committed vectors are only comparable to a query embedded by the SAME
// model and dimensionality. A different model (or truncation) with the same dim
// produces plausible-but-wrong cosine scores — a silent quality failure — so we
// refuse to retrieve rather than mislead. Pure, so it's unit-tested directly.
export function embeddingsCompatible(
  file: { model: string; dim: number },
  config: { model: string; dimensions?: number },
): boolean {
  if (file.model !== config.model) return false;
  if (config.dimensions !== undefined && config.dimensions !== file.dim) return false;
  return true;
}

export const ragMismatchReason = (config: { model: string; dimensions?: number }): string =>
  `embeddings.json was built with ${data.model}/${data.dim} but the configured ` +
  `embedder is ${config.model}/${config.dimensions ?? "default"}. ` +
  "Re-run `npm run embed` or align LLM_EMBED_* — falling back to keyword matching.";

export type CreateRetrieverOptions = {
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  // Fired when RAG is disabled despite a key being present (model/dim mismatch),
  // so the route can log why selection fell back to keyword matching. Also fired
  // when a configured Postgres backend errors and we degrade to in-memory search.
  onWarn?: (message: string) => void;
};

// Wraps a Postgres-backed retriever so a transient DB failure degrades to the
// committed in-memory vectors instead of dropping retrieval for the turn. The
// vectors are identical (the DB is seeded from embeddings.json), so the only
// observable difference on fallback is the ranking runs in Node — quality is
// unchanged. Mirrors the "RAG is an enhancement, never a hard dependency" stance.
function withInMemoryFallback(
  primary: Retriever,
  fallback: Retriever,
  onWarn?: (message: string) => void,
): Retriever {
  return async (query, topK) => {
    try {
      return await primary(query, topK);
    } catch (err) {
      onWarn?.(
        `Postgres retrieval failed (${err instanceof Error ? err.message : String(err)}) — ` +
          "falling back to in-memory vectors for this query.",
      );
      return fallback(query, topK);
    }
  };
}

// Returns a provider-backed retriever, or null when RAG can't run safely — no
// embedding key, or a model/dimension mismatch with the committed vectors. RAG
// is an optional enhancement, never a hard dependency for a turn.
//
// When DATABASE_URL is set, the ranking is pushed into Postgres/pgvector (HNSW
// index) with the in-memory vectors as a graceful fallback; otherwise the
// committed vectors are scored in-process. Either way the corpus is the same
// server-authoritative embeddings.json.
export function createConfiguredRetriever(
  options: CreateRetrieverOptions = {},
): Retriever | null {
  let config;
  try {
    config = resolveEmbeddingConfig();
  } catch (err) {
    if (err instanceof MissingLlmKeyError) return null;
    throw err;
  }

  if (!embeddingsCompatible({ model: data.model, dim: data.dim }, config)) {
    options.onWarn?.(ragMismatchReason(config));
    return null;
  }

  const embed: Embedder = withRetryFn(
    createOpenAiCompatEmbedder({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      dimensions: config.dimensions,
    }),
    { maxAttempts: 3, onRetry: options.onRetry },
  );

  const inMemory = createRetriever({ embed, corpus: CORPUS, vectors: VECTORS });

  // Prefer Postgres when configured; fall back to the in-memory vectors on any
  // query-time DB error so a turn never fails for the database.
  const db = getDb();
  if (db) {
    return withInMemoryFallback(createDbRetriever({ db, embed }), inMemory, options.onWarn);
  }

  return inMemory;
}
