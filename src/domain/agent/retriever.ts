// Ties the embedding port and the pure cosine search into one capability the
// agent can use: "given a query, return the most relevant paintings with their
// curatorial notes." The embedder is injected, the corpus vectors are
// precomputed (loaded from embeddings.json upstream), so this is exercised in
// tests with a scripted embedder and a handful of fake vectors — no network.

import type { Embedder } from "./embedder";
import type { CorpusDoc } from "./corpus";
import { rankBySimilarity, type VectorDoc } from "./retrieval";

export type RetrievedDoc = {
  id: string;
  title: string;
  artist: string;
  // The curated text (description + brushwork notes) used to ground the model.
  text: string;
  score: number;
};

export type Retriever = (query: string, topK?: number) => Promise<RetrievedDoc[]>;

export const DEFAULT_TOP_K = 5;

export function createRetriever(args: {
  embed: Embedder;
  corpus: CorpusDoc[];
  vectors: VectorDoc[];
}): Retriever {
  const byId = new Map(args.corpus.map((d) => [d.id, d]));

  return async (query: string, topK: number = DEFAULT_TOP_K): Promise<RetrievedDoc[]> => {
    const q = query.trim();
    if (!q) return [];

    const [queryVector] = await args.embed([q]);
    if (!queryVector || queryVector.length === 0) return [];

    return rankBySimilarity(queryVector, args.vectors, topK)
      .map((hit) => {
        const doc = byId.get(hit.id);
        if (!doc) return null;
        return {
          id: doc.id,
          title: doc.title,
          artist: doc.artist,
          text: doc.text,
          score: hit.score,
        };
      })
      .filter((d): d is RetrievedDoc => d !== null);
  };
}
