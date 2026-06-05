// Drizzle schema for the RAG corpus in Postgres (pgvector).
//
// One row per painting, mirroring the committed embeddings.json: the curatorial
// text the model is grounded on, plus its embedding vector. The table is seeded
// from that file (scripts/dbSeed.ts) so Postgres becomes a *query backend* for
// the same vectors — the offline `embed` pipeline stays the source of truth and
// the DB never drifts from it.
//
// `model`/`dim` are stored per-row so a future re-embed with a different model
// is detectable, exactly like the guard on the JSON file.

import { pgTable, text, integer, vector, index } from "drizzle-orm/pg-core";

// Must match the committed corpus (gemini-embedding-001 truncated to 768 via
// Matryoshka). Changing this requires a re-embed + reseed; the rag.ts
// compatibility guard refuses to retrieve on a mismatch rather than mislead.
export const EMBEDDING_DIM = 768;

export const paintings = pgTable(
  "paintings",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    // The flattened curatorial text that was embedded and is handed back to the
    // model as grounding context for a hit.
    text: text("text").notNull(),
    // The embedding model + dimensionality these vectors were produced with.
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
  },
  (t) => [
    // HNSW index for cosine distance (`<=>`). Approximate but fast and the
    // standard pgvector choice for top-k semantic search. vector_cosine_ops
    // matches the `1 - cosineDistance` similarity the retriever computes.
    index("paintings_embedding_cosine_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type PaintingRow = typeof paintings.$inferSelect;
export type NewPaintingRow = typeof paintings.$inferInsert;
