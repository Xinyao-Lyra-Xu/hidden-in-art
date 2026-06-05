// Postgres/pgvector implementation of the domain Retriever port.
//
// Same contract as the in-memory createRetriever (domain/agent/retriever): embed
// the query, return the top-k paintings by cosine similarity with their
// curatorial text. The difference is *where* the search runs — here the ranking
// is pushed into Postgres via the pgvector `<=>` operator and an HNSW index,
// instead of scoring every vector in Node. The embedder is still injected, so
// the only network cost per turn is embedding the user's query.

import { sql, desc, cosineDistance } from "drizzle-orm";
import type { Embedder } from "@/domain/agent/embedder";
import {
  DEFAULT_TOP_K,
  type Retriever,
  type RetrievedDoc,
} from "@/domain/agent/retriever";
import type { Db } from "./client";
import { paintings } from "./schema";

// pgvector's `<=>` is cosine *distance* in [0, 2] (0 = identical). The rest of
// the agent — including the optional minScore floor — speaks cosine
// *similarity* in [-1, 1] (higher = closer), matching the in-memory path. Map
// one to the other so the two backends are interchangeable: similarity = 1 -
// distance. Pulled out (and exported) so it's unit-testable without a database.
export function similarityFromDistance(distance: number): number {
  return 1 - distance;
}

export function createDbRetriever(args: { db: Db; embed: Embedder }): Retriever {
  return async (query: string, topK: number = DEFAULT_TOP_K): Promise<RetrievedDoc[]> => {
    const q = query.trim();
    if (!q) return [];

    const [queryVector] = await args.embed([q]);
    if (!queryVector || queryVector.length === 0) return [];

    // Compute similarity in SQL so the same expression drives both the SELECT
    // and the ORDER BY (Postgres reuses it; the HNSW index serves the ordering).
    const similarity = sql<number>`1 - (${cosineDistance(paintings.embedding, queryVector)})`;

    const rows = await args.db
      .select({
        id: paintings.id,
        title: paintings.title,
        artist: paintings.artist,
        text: paintings.text,
        score: similarity,
      })
      .from(paintings)
      .orderBy(desc(similarity))
      .limit(Math.max(0, topK));

    // node-postgres returns numeric/float expressions as strings; coerce so the
    // RetrievedDoc.score contract (a number) holds for the minScore floor etc.
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      text: r.text,
      score: Number(r.score),
    }));
  };
}
