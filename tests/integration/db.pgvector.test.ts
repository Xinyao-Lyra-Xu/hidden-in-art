// Integration test for the Postgres + pgvector retrieval path.
//
// Unlike the unit tests, this one needs a real database: it runs only when
// DATABASE_URL is set (CI provides a pgvector service container; locally it
// self-skips). It assumes the table is migrated and seeded from embeddings.json
// — `npm run db:migrate && npm run db:seed` — exactly as the CI `db` job does.
//
// What it proves: the pgvector backend returns the SAME ranking as the in-memory
// cosine search for the same query vector. We embed with a scripted embedder
// (no API key) that echoes a known corpus vector, so the expected top-1 is that
// painting (self-similarity ≈ 1) and the full top-k must match what
// rankBySimilarity computes over the identical committed vectors.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "@/infrastructure/db/client";
import { createDbRetriever } from "@/infrastructure/db/retriever";
import { rankBySimilarity, type VectorDoc } from "@/domain/agent/retrieval";
import type { Embedder } from "@/domain/agent/embedder";

const HAS_DB = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

type EmbeddingsFile = {
  model: string;
  dim: number;
  docs: { id: string; title: string; artist: string; text: string; vector: number[] }[];
};

function loadEmbeddings(): EmbeddingsFile {
  const path = resolve("src/infrastructure/llm/embeddings.json");
  return JSON.parse(readFileSync(path, "utf8")) as EmbeddingsFile;
}

// A scripted embedder that ignores the text and returns a fixed query vector, so
// the test is deterministic and key-free — same trick the retriever unit tests
// use, but here the vectors live in Postgres.
const fixedEmbedder = (vector: number[]): Embedder => {
  return async () => [vector];
};

after(async () => {
  await closeDb();
});

test("pgvector retrieval matches in-memory ranking for the same query vector", { skip: !HAS_DB }, async () => {
  const db = getDb();
  assert.ok(db, "getDb() should return a client when DATABASE_URL is set");

  const data = loadEmbeddings();
  assert.ok(data.docs.length > 0, "embeddings.json should be seeded");

  // Use a real corpus vector as the query: its own painting must rank first.
  const anchor = data.docs[0];
  const topK = 5;

  const retriever = createDbRetriever({ db, embed: fixedEmbedder(anchor.vector) });
  const dbHits = await retriever("anything — the embedder is scripted", topK);

  // Expected ranking from the pure in-memory path over the identical vectors.
  const vectors: VectorDoc[] = data.docs.map((d) => ({ id: d.id, vector: d.vector }));
  const expected = rankBySimilarity(anchor.vector, vectors, topK);

  // Self-similarity: the anchor painting is the top hit, score ≈ 1.
  assert.equal(dbHits[0].id, anchor.id, "anchor painting should rank first");
  assert.ok(Math.abs(dbHits[0].score - 1) < 1e-4, "top score should be ≈ 1 (cosine self-similarity)");

  // Same length and same id order as the in-memory ranker (40 rows → HNSW is
  // exact here), and scores agree to within float tolerance.
  assert.equal(dbHits.length, expected.length);
  assert.deepEqual(
    dbHits.map((h) => h.id),
    expected.map((e) => e.id),
    "pgvector and in-memory rankings should match",
  );
  for (let i = 0; i < dbHits.length; i++) {
    assert.ok(
      Math.abs(dbHits[i].score - expected[i].score) < 1e-4,
      `score parity at rank ${i} (db=${dbHits[i].score} vs mem=${expected[i].score})`,
    );
  }

  // Scores are monotonically non-increasing (ranked best-first).
  for (let i = 1; i < dbHits.length; i++) {
    assert.ok(dbHits[i - 1].score >= dbHits[i].score, "scores must be descending");
  }
});
