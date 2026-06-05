import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddingsCompatible, ragMinScore } from "@/infrastructure/llm/rag";

// embeddingsCompatible guards against silently comparing query vectors from one
// model against corpus vectors built by another (or a different truncation),
// which yields plausible-but-wrong cosine scores.

test("compatible when model matches and no explicit dimension override", () => {
  assert.equal(
    embeddingsCompatible({ model: "gemini-embedding-001", dim: 768 }, { model: "gemini-embedding-001" }),
    true,
  );
});

test("compatible when model and explicit dimension both match", () => {
  assert.equal(
    embeddingsCompatible(
      { model: "gemini-embedding-001", dim: 768 },
      { model: "gemini-embedding-001", dimensions: 768 },
    ),
    true,
  );
});

test("incompatible when the embedding model differs (same dim is the dangerous case)", () => {
  assert.equal(
    embeddingsCompatible(
      { model: "gemini-embedding-001", dim: 768 },
      { model: "text-embedding-3-small", dimensions: 768 },
    ),
    false,
  );
});

test("incompatible when the configured dimension differs from the file", () => {
  assert.equal(
    embeddingsCompatible(
      { model: "gemini-embedding-001", dim: 768 },
      { model: "gemini-embedding-001", dimensions: 1536 },
    ),
    false,
  );
});

// ── ragMinScore (search relevance floor, off by default) ─────────────────────

test("ragMinScore is undefined when unset or blank", () => {
  assert.equal(ragMinScore({}), undefined);
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "" }), undefined);
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "   " }), undefined);
});

test("ragMinScore parses a finite number", () => {
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "0.5" }), 0.5);
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "0" }), 0);
});

test("ragMinScore ignores non-numeric values", () => {
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "high" }), undefined);
  assert.equal(ragMinScore({ LLM_RAG_MIN_SCORE: "NaN" }), undefined);
});
