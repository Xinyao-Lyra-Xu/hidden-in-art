// Pure semantic-retrieval primitives for the art agent's RAG.
//
// Given a query vector and a set of pre-embedded documents, rank the documents
// by cosine similarity and return the top matches. There is no I/O here — the
// embeddings are supplied by the caller (precomputed for the corpus, freshly
// embedded for the query), so this stays deterministic and fully unit-testable
// offline, in the same spirit as matchArtwork.

export type VectorDoc = { id: string; vector: number[] };
export type ScoredDoc = { id: string; score: number };

// Dot product of two equal-length vectors. Returns 0 on a length mismatch
// rather than throwing, so a stale/short embedding can't crash a turn.
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

// Cosine similarity in [-1, 1]. A zero-magnitude vector (no signal) yields 0
// rather than NaN, so empty or degenerate embeddings rank last instead of
// poisoning the sort.
export function cosineSimilarity(a: number[], b: number[]): number {
  const denom = magnitude(a) * magnitude(b);
  if (denom === 0) return 0;
  return dotProduct(a, b) / denom;
}

// Rank docs by cosine similarity to the query, highest first. topK (when given)
// caps the result length; omit it to return every doc scored and sorted. Ties
// keep their original order (stable sort), so results are reproducible.
export function rankBySimilarity(
  query: number[],
  docs: VectorDoc[],
  topK?: number,
): ScoredDoc[] {
  const scored = docs.map((doc) => ({
    id: doc.id,
    score: cosineSimilarity(query, doc.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return topK === undefined ? scored : scored.slice(0, Math.max(0, topK));
}
