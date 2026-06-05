import { test } from "node:test";
import assert from "node:assert/strict";
import { similarityFromDistance } from "@/infrastructure/db/retriever";
import { cosineSimilarity } from "@/domain/agent/retrieval";

// The DB backend ranks with pgvector cosine *distance* (`<=>`), while the rest of
// the agent — and the minScore floor — speaks cosine *similarity*. These tests
// pin the mapping that makes the two backends interchangeable, so a hit's score
// means the same thing whether it came from Postgres or the in-memory path.

test("similarityFromDistance inverts pgvector cosine distance", () => {
  // Identical vectors: distance 0 -> similarity 1.
  assert.equal(similarityFromDistance(0), 1);
  // Orthogonal: distance 1 -> similarity 0.
  assert.equal(similarityFromDistance(1), 0);
  // Opposite: distance 2 -> similarity -1.
  assert.equal(similarityFromDistance(2), -1);
});

test("similarityFromDistance matches in-memory cosineSimilarity", () => {
  // For any pair of vectors, pgvector distance = 1 - cosineSimilarity, so mapping
  // it back must reproduce the in-memory score the other backend would compute.
  const a = [0.2, 0.5, -0.3, 0.9];
  const b = [0.1, -0.4, 0.7, 0.2];
  const sim = cosineSimilarity(a, b);
  const pgDistance = 1 - sim; // what `embedding <=> query` returns
  assert.ok(Math.abs(similarityFromDistance(pgDistance) - sim) < 1e-12);
});
