import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetriever } from "@/domain/agent/retriever";
import type { Embedder } from "@/domain/agent/embedder";
import type { CorpusDoc } from "@/domain/agent/corpus";
import type { VectorDoc } from "@/domain/agent/retrieval";

// A tiny 2-D "embedding space": queries and docs are placed by hand so the
// nearest-neighbour outcome is obvious and deterministic — no model involved.
const CORPUS: CorpusDoc[] = [
  { id: "vg", title: "Wheat Field", artist: "Van Gogh", text: "swirling expressive sky" },
  { id: "mo", title: "Water Lilies", artist: "Monet", text: "calm water reflections" },
];
const VECTORS: VectorDoc[] = [
  { id: "vg", vector: [1, 0] },
  { id: "mo", vector: [0, 1] },
];

// Maps a known query string to a point in the same 2-D space.
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return async (texts) => texts.map((t) => map[t] ?? [0, 0]);
}

test("retriever returns corpus docs ranked by similarity to the query", async () => {
  const retrieve = createRetriever({
    embed: fakeEmbedder({ "swirling sky": [1, 0.1] }),
    corpus: CORPUS,
    vectors: VECTORS,
  });

  const hits = await retrieve("swirling sky");
  assert.equal(hits[0].id, "vg");
  assert.equal(hits[0].title, "Wheat Field");
  assert.equal(hits[0].text, "swirling expressive sky");
  assert.ok(hits[0].score > hits[1].score);
});

test("retriever honors topK", async () => {
  const retrieve = createRetriever({
    embed: fakeEmbedder({ q: [0, 1] }),
    corpus: CORPUS,
    vectors: VECTORS,
  });
  const hits = await retrieve("q", 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "mo");
});

test("retriever returns nothing for a blank query without embedding", async () => {
  let called = false;
  const embed: Embedder = async (t) => {
    called = true;
    return t.map(() => [1, 0]);
  };
  const retrieve = createRetriever({ embed, corpus: CORPUS, vectors: VECTORS });
  assert.deepEqual(await retrieve("   "), []);
  assert.equal(called, false);
});

test("retriever drops hits whose id is missing from the corpus", async () => {
  const retrieve = createRetriever({
    embed: fakeEmbedder({ q: [1, 0] }),
    corpus: [CORPUS[0]], // only "vg" has a doc
    vectors: VECTORS, // but both have vectors
  });
  const hits = await retrieve("q");
  assert.deepEqual(hits.map((h) => h.id), ["vg"]);
});

test("retriever returns nothing when the embedder yields an empty vector", async () => {
  const retrieve = createRetriever({
    embed: async (t) => t.map(() => []),
    corpus: CORPUS,
    vectors: VECTORS,
  });
  assert.deepEqual(await retrieve("anything"), []);
});
