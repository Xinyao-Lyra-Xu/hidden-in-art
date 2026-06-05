import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  dotProduct,
  magnitude,
  rankBySimilarity,
  type VectorDoc,
} from "@/domain/agent/retrieval";
import { buildCorpus, buildCorpusDoc } from "@/domain/agent/corpus";
import { FIXTURE_LIBRARY } from "./fixtures";

// ── cosine math ──────────────────────────────────────────────────────────────

test("dotProduct multiplies elementwise and sums", () => {
  assert.equal(dotProduct([1, 2, 3], [4, 5, 6]), 32);
});

test("dotProduct returns 0 on a length mismatch instead of throwing", () => {
  assert.equal(dotProduct([1, 2, 3], [1, 2]), 0);
});

test("magnitude is the Euclidean norm", () => {
  assert.equal(magnitude([3, 4]), 5);
});

test("cosineSimilarity is 1 for parallel, 0 for orthogonal, -1 for opposite", () => {
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test("cosineSimilarity returns 0 (not NaN) for a zero vector", () => {
  const sim = cosineSimilarity([0, 0], [1, 1]);
  assert.equal(Number.isNaN(sim), false);
  assert.equal(sim, 0);
});

// ── ranking ──────────────────────────────────────────────────────────────────

const DOCS: VectorDoc[] = [
  { id: "a", vector: [1, 0, 0] },
  { id: "b", vector: [0, 1, 0] },
  { id: "c", vector: [0.9, 0.1, 0] },
];

test("rankBySimilarity orders by closeness to the query, highest first", () => {
  const ranked = rankBySimilarity([1, 0, 0], DOCS);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "c", "b"]);
  assert.equal(ranked[0].score, 1);
});

test("rankBySimilarity caps results at topK", () => {
  const ranked = rankBySimilarity([1, 0, 0], DOCS, 2);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "c"]);
});

test("rankBySimilarity returns every doc when topK is omitted", () => {
  assert.equal(rankBySimilarity([1, 0, 0], DOCS).length, DOCS.length);
});

test("rankBySimilarity is stable for tied scores", () => {
  // Both docs are orthogonal to the query → score 0 → original order preserved.
  const tied: VectorDoc[] = [
    { id: "first", vector: [0, 1] },
    { id: "second", vector: [0, 1] },
  ];
  const ranked = rankBySimilarity([1, 0], tied);
  assert.deepEqual(ranked.map((r) => r.id), ["first", "second"]);
});

// ── corpus assembly ──────────────────────────────────────────────────────────

test("buildCorpusDoc folds curatorial notes into the embedded text", () => {
  const monet = FIXTURE_LIBRARY[0]; // met-436529, La Grenouillère
  const doc = buildCorpusDoc(monet);

  assert.equal(doc.id, monet.id);
  assert.match(doc.text, /La Grenouillère by Claude Monet/);
  // tags and mood are present
  assert.match(doc.text, /impressionist/);
  assert.match(doc.text, /serene/);
  // curated description + stroke notes from paintingInfo are folded in
  assert.match(doc.text, /Impressionism/);
  assert.match(doc.text, /comma-strokes/);
});

test("buildCorpusDoc tolerates a painting with no curated notes", () => {
  const doc = buildCorpusDoc({
    id: "unknown-id",
    title: "Untitled",
    artist: "Anon",
    category: "landscape",
    tags: ["test"],
    mood: ["calm"],
  });
  assert.match(doc.text, /Untitled by Anon/);
  assert.match(doc.text, /test/);
});

test("buildCorpus produces one doc per library entry", () => {
  const corpus = buildCorpus(FIXTURE_LIBRARY);
  assert.equal(corpus.length, FIXTURE_LIBRARY.length);
  assert.deepEqual(
    corpus.map((d) => d.id),
    FIXTURE_LIBRARY.map((a) => a.id),
  );
});
