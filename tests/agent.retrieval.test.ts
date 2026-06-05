import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  dotProduct,
  fuseRankings,
  magnitude,
  rankBySimilarity,
  type VectorDoc,
} from "@/domain/agent/retrieval";
import { buildCorpus, buildCorpusDoc, diffCorpus } from "@/domain/agent/corpus";
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

// ── reciprocal rank fusion ───────────────────────────────────────────────────

test("fuseRankings ranks an id well-placed in both lists at the top", () => {
  const semantic = ["a", "b", "c"];
  const keyword = ["b", "a"];
  const fused = fuseRankings([semantic, keyword]);
  // "a" (ranks 0,1) and "b" (ranks 1,0) both appear in both; "a" edges ahead by
  // being rank 0 in the first list and rank 1 in the second vs b's 1 then 0 —
  // actually symmetric, so assert both lead "c" which only appears once.
  assert.equal(fused[fused.length - 1].id, "c");
  assert.deepEqual(new Set([fused[0].id, fused[1].id]), new Set(["a", "b"]));
});

test("fuseRankings rescues an exact match ranked low by the other ranker", () => {
  // Semantic ranks the target ("rem") only 2nd; keyword nails it 1st. Fusion
  // must surface "rem" above the semantic #1 ("mon").
  const semantic = ["mon", "rem"];
  const keyword = ["rem"];
  const fused = fuseRankings([semantic, keyword]);
  assert.equal(fused[0].id, "rem");
});

test("fuseRankings still scores ids that appear in only one list", () => {
  const fused = fuseRankings([["x"], ["y"]]);
  assert.deepEqual(new Set(fused.map((f) => f.id)), new Set(["x", "y"]));
  // Both at rank 0 in their sole list → equal scores.
  assert.equal(fused[0].score, fused[1].score);
});

test("fuseRankings handles empty inputs", () => {
  assert.deepEqual(fuseRankings([]), []);
  assert.deepEqual(fuseRankings([[], []]), []);
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

// ── staleness detection (diffCorpus) ─────────────────────────────────────────

test("diffCorpus reports ok when source matches the embedded text", () => {
  const corpus = buildCorpus(FIXTURE_LIBRARY);
  const stored = corpus.map((d) => ({ id: d.id, text: d.text }));
  assert.deepEqual(diffCorpus(corpus, stored), { ok: true });
});

test("diffCorpus flags a changed painting count", () => {
  const corpus = buildCorpus(FIXTURE_LIBRARY);
  const stored = corpus.slice(0, -1).map((d) => ({ id: d.id, text: d.text }));
  const diff = diffCorpus(corpus, stored);
  assert.equal(diff.ok, false);
  assert.match((diff as { reason: string }).reason, /count changed/);
});

test("diffCorpus flags a reordered / changed id", () => {
  const corpus = buildCorpus(FIXTURE_LIBRARY);
  const stored = corpus.map((d) => ({ id: d.id, text: d.text }));
  stored[1] = { id: "different-id", text: stored[1].text };
  const diff = diffCorpus(corpus, stored);
  assert.equal(diff.ok, false);
  assert.match((diff as { reason: string }).reason, /id changed/);
});

test("diffCorpus flags drifted curatorial text (edited notes, not re-embedded)", () => {
  const corpus = buildCorpus(FIXTURE_LIBRARY);
  const stored = corpus.map((d) => ({ id: d.id, text: d.text }));
  stored[0] = { id: stored[0].id, text: stored[0].text + " (an edit nobody re-embedded)" };
  const diff = diffCorpus(corpus, stored);
  assert.equal(diff.ok, false);
  assert.match((diff as { reason: string }).reason, /text changed/);
  assert.match((diff as { reason: string }).reason, new RegExp(corpus[0].id));
});
