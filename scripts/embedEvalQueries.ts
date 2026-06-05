// Records query embeddings for the retrieval-quality eval.
//
//   npm run embed:eval            # embed the labeled queries, refresh the fixture
//
// Like `npm run embed`, this is the only step that needs a key + network. The
// resulting fixture (tests/fixtures/retrievalVectors.json) carries one vector
// per labeled query so tests/agent.retrievalQuality.test.ts can score them
// (fixture lives at tests/retrievalVectors.json)
// against the committed corpus offline and deterministically — no key in CI.
// Re-run whenever the cases or the embedding model change. The vectors MUST come
// from the same model as embeddings.json or the cosine scores are meaningless;
// the fixture records the model so the test can guard against drift.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEmbeddingConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatEmbedder } from "@/infrastructure/llm/embedder";

const OUT_PATH = resolve("tests/retrievalVectors.json");

// Labeled queries: a natural-language request and the painting id it should
// surface. Chosen to span subject, mood, technique, artist, and medium — the
// kinds of queries the keyword matcher can't reach. ids are from
// public/artworks/famous-paintings.json.
export const RETRIEVAL_CASES: { query: string; expectedId: string }[] = [
  { query: "a swirling emotional sky", expectedId: "met-437984" },
  { query: "the great wave off the coast of japan", expectedId: "met-45434" },
  { query: "a quiet woman absorbed in reading a book", expectedId: "met-0-fragonard-reading" },
  { query: "a dramatic stormy sky over a city", expectedId: "met-29150" },
  { query: "ballet dancers rehearsing", expectedId: "met-436928" },
  { query: "water lilies floating on a pond", expectedId: "met-437980" },
  { query: "a self-portrait of van gogh", expectedId: "met-436532" },
  { query: "japanese woodblock print of falling rain", expectedId: "met-0-hiroshige-sudden-shower" },
];

export type RetrievalVectorsFile = {
  model: string;
  dim: number;
  generatedAt: string;
  items: { query: string; expectedId: string; vector: number[] }[];
};

try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

async function main(): Promise<void> {
  let config;
  try {
    config = resolveEmbeddingConfig();
  } catch (err) {
    if (err instanceof MissingLlmKeyError) {
      console.error("embed:eval: no embedding key. Set LLM_API_KEY in .env.local.");
      process.exit(2);
    }
    throw err;
  }

  console.log(`embed:eval: ${RETRIEVAL_CASES.length} queries via ${config.provider}/${config.model}`);
  const embed = createOpenAiCompatEmbedder(config);
  const vectors = await embed(RETRIEVAL_CASES.map((c) => c.query));

  const out: RetrievalVectorsFile = {
    model: config.model,
    dim: vectors[0]?.length ?? 0,
    generatedAt: new Date().toISOString(),
    items: RETRIEVAL_CASES.map((c, i) => ({
      query: c.query,
      expectedId: c.expectedId,
      vector: vectors[i],
    })),
  };

  writeFileSync(OUT_PATH, JSON.stringify(out) + "\n");
  console.log(`embed:eval: wrote ${out.items.length} query vectors (dim ${out.dim}) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("embed:eval failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
