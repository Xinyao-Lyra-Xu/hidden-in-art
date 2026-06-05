import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBySimilarity, type VectorDoc } from "@/domain/agent/retrieval";
import corpus from "@/infrastructure/llm/embeddings.json" with { type: "json" };
import fixture from "./retrievalVectors.json" with { type: "json" };

// Retrieval-quality eval, run offline in the unit suite.
//
// The corpus vectors (embeddings.json) and the labeled query vectors
// (retrievalVectors.json, produced by `npm run embed:eval`) are both committed,
// so this scores real semantic retrieval deterministically with no key and no
// network. It asserts the curated expected painting is found, and gates the
// overall top-1 hit rate — catching a regression in the corpus text, the
// embedding model, or the ranking math. Re-run `npm run embed`/`embed:eval`
// (same model) if either set is refreshed.

const TOP_K = 3;
const MIN_TOP1_HIT_RATE = 0.75;

const corpusDocs: VectorDoc[] = corpus.docs.map((d) => ({ id: d.id, vector: d.vector }));
const corpusIds = new Set(corpusDocs.map((d) => d.id));

test("eval query vectors come from the same model as the corpus", () => {
  // Cosine across vectors from different models is meaningless — guard loudly.
  assert.equal(
    fixture.model,
    corpus.model,
    "retrievalVectors.json model differs from embeddings.json — re-run `npm run embed:eval`",
  );
  assert.equal(fixture.dim, corpus.dim);
});

test("every labeled query's expected painting exists in the corpus", () => {
  for (const item of fixture.items) {
    assert.ok(corpusIds.has(item.expectedId), `unknown expectedId ${item.expectedId} for "${item.query}"`);
  }
});

test(`each labeled query surfaces its painting within top-${TOP_K}`, () => {
  for (const item of fixture.items) {
    const ranked = rankBySimilarity(item.vector, corpusDocs, TOP_K);
    const found = ranked.some((r) => r.id === item.expectedId);
    assert.ok(
      found,
      `"${item.query}" → expected ${item.expectedId} not in top ${TOP_K}: ${ranked.map((r) => r.id).join(", ")}`,
    );
  }
});

test(`top-1 hit rate is at least ${MIN_TOP1_HIT_RATE}`, () => {
  let hits = 0;
  for (const item of fixture.items) {
    const [best] = rankBySimilarity(item.vector, corpusDocs, 1);
    if (best?.id === item.expectedId) hits++;
  }
  const rate = hits / fixture.items.length;
  assert.ok(
    rate >= MIN_TOP1_HIT_RATE,
    `top-1 hit rate ${hits}/${fixture.items.length} (${rate.toFixed(2)}) < ${MIN_TOP1_HIT_RATE}`,
  );
});
