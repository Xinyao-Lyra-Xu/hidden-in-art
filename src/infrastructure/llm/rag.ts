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

export type CreateRetrieverOptions = {
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

// Returns a provider-backed retriever, or null when no embedding key is set
// (RAG is an optional enhancement, never a hard dependency for a turn).
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

  const embed = withRetryFn(
    createOpenAiCompatEmbedder({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      dimensions: config.dimensions,
    }),
    { maxAttempts: 3, onRetry: options.onRetry },
  );

  return createRetriever({ embed, corpus: CORPUS, vectors: VECTORS });
}
