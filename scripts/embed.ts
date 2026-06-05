// Precomputes the RAG corpus embeddings and writes them to a committed JSON file.
//
//   npm run embed                 # embed every painting, refresh embeddings.json
//   npm run embed -- --check      # verify embeddings.json is in sync (CI/dry run)
//
// This is the only RAG step that needs a key and the network — exactly like
// `eval:record`. At runtime the agent reads the committed vectors and does a
// pure in-memory cosine search (no network for the corpus), so unit tests and
// the offline eval stay deterministic and key-free. Re-run this whenever the
// library or the curatorial notes in paintingInfo change.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCorpus, diffCorpus } from "@/domain/agent/corpus";
import type { AgentArtwork } from "@/domain/agent/types";
import { resolveEmbeddingConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatEmbedder } from "@/infrastructure/llm/embedder";

const LIBRARY_PATH = resolve("public/artworks/famous-paintings.json");
const OUT_PATH = resolve("src/infrastructure/llm/embeddings.json");

// Embed in batches so a large library doesn't exceed a provider's per-request
// input cap. 40 paintings fit in one call today; this keeps headroom.
const BATCH_SIZE = 64;

// Each doc carries the curatorial text alongside its vector so retrieval is
// fully server-authoritative: the knowledge surfaced to the model is exactly
// what was embedded, independent of whatever library the client happens to send.
export type EmbeddingsFile = {
  model: string;
  dim: number;
  generatedAt: string;
  docs: { id: string; title: string; artist: string; text: string; vector: number[] }[];
};

// Best-effort load of .env.local (Node 21+), matching scripts/eval.ts.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

function loadLibrary(): AgentArtwork[] {
  const raw = JSON.parse(readFileSync(LIBRARY_PATH, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { artworks?: unknown[] }).artworks ?? [];
  return (list as Record<string, unknown>[]).map((a) => ({
    id: String(a.id),
    title: String(a.title ?? ""),
    artist: String(a.artist ?? ""),
    category: typeof a.category === "string" ? a.category : "",
    tags: Array.isArray(a.tags) ? (a.tags as string[]) : [],
    mood: Array.isArray(a.mood) ? (a.mood as string[]) : [],
  }));
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");

  const library = loadLibrary();
  const corpus = buildCorpus(library);

  // --check is pure and key-free: rebuild the corpus from source and compare its
  // text to what was embedded. Catches stale notes without a model call, so it
  // can run in CI. The real embed below is the only path that needs a key.
  if (check) {
    const existing = readExisting();
    if (!existing) {
      console.error("embed --check: no embeddings.json found. Run `npm run embed`.");
      process.exit(1);
    }
    const diff = diffCorpus(corpus, existing.docs);
    if (!diff.ok) {
      console.error(`embed --check: embeddings.json is stale — ${diff.reason}. Run \`npm run embed\`.`);
      process.exit(1);
    }
    console.log(
      `embed --check: in sync (${corpus.length} paintings, ${existing.model}/${existing.dim}).`,
    );
    return;
  }

  let config;
  try {
    config = resolveEmbeddingConfig();
  } catch (err) {
    if (err instanceof MissingLlmKeyError) {
      console.error(
        "embed: no embedding key. Set LLM_API_KEY (or LLM_EMBED_API_KEY) in .env.local.",
      );
      process.exit(2);
    }
    throw err;
  }

  console.log(
    `embed: ${corpus.length} paintings via ${config.provider}/${config.model}` +
      (config.dimensions ? ` (dim ${config.dimensions})` : ""),
  );

  const embed = createOpenAiCompatEmbedder(config);
  const vectors: number[][] = [];
  for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
    const batch = corpus.slice(i, i + BATCH_SIZE);
    const batchVectors = await embed(batch.map((d) => d.text));
    vectors.push(...batchVectors);
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, corpus.length)}/${corpus.length}`);
  }

  const dim = vectors[0]?.length ?? 0;
  const out: EmbeddingsFile = {
    model: config.model,
    dim,
    generatedAt: new Date().toISOString(),
    docs: corpus.map((d, i) => ({
      id: d.id,
      title: d.title,
      artist: d.artist,
      text: d.text,
      vector: vectors[i],
    })),
  };

  writeFileSync(OUT_PATH, JSON.stringify(out) + "\n");
  console.log(`embed: wrote ${out.docs.length} vectors (dim ${dim}) to ${OUT_PATH}`);
}

function readExisting(): EmbeddingsFile | null {
  try {
    return JSON.parse(readFileSync(OUT_PATH, "utf8")) as EmbeddingsFile;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("embed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
