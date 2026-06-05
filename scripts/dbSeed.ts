// Loads the committed corpus embeddings into the Postgres paintings table.
//
//   npm run db:migrate   # create the table (once / after schema changes)
//   npm run db:seed      # load embeddings.json into it
//
// Seeds straight from src/infrastructure/llm/embeddings.json — the same vectors
// the in-memory retriever uses — so Postgres is a *query backend* for the
// offline `embed` pipeline, never a second source of truth. The seed is a
// truncate-then-insert in one transaction, so it's idempotent and also drops
// paintings that were removed from the library. No model/network call here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "@/infrastructure/db/client";
import { paintings, EMBEDDING_DIM, type NewPaintingRow } from "@/infrastructure/db/schema";

// Best-effort load of .env.local (Node 21+), matching scripts/embed.ts.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

type EmbeddingsFile = {
  model: string;
  dim: number;
  docs: { id: string; title: string; artist: string; text: string; vector: number[] }[];
};

const EMBEDDINGS_PATH = resolve("src/infrastructure/llm/embeddings.json");

async function main(): Promise<void> {
  const db = getDb();
  if (!db) {
    console.error("db:seed: set DATABASE_URL in .env.local first.");
    process.exit(2);
  }

  const data = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8")) as EmbeddingsFile;

  // The table column is vector(EMBEDDING_DIM); a file built at a different
  // dimensionality would fail the insert with an opaque error. Catch it early.
  if (data.dim !== EMBEDDING_DIM) {
    console.error(
      `db:seed: embeddings.json is ${data.dim}-dim but the schema is ${EMBEDDING_DIM}-dim. ` +
        "Re-run `npm run embed` at the right dimension or update EMBEDDING_DIM in schema.ts.",
    );
    process.exit(1);
  }

  const rows: NewPaintingRow[] = data.docs.map((d) => ({
    id: d.id,
    title: d.title,
    artist: d.artist,
    text: d.text,
    model: data.model,
    dim: data.dim,
    embedding: d.vector,
  }));

  // Truncate + insert in one transaction so the table mirrors the file exactly
  // (mid-run failures roll back rather than leaving a half-seeded corpus).
  await db.transaction(async (tx) => {
    await tx.delete(paintings);
    await tx.insert(paintings).values(rows);
  });

  console.log(`db:seed: loaded ${rows.length} paintings (${data.model}/${data.dim}).`);
  await closeDb();
}

main().catch(async (err) => {
  console.error("db:seed failed:", err instanceof Error ? err.message : err);
  await closeDb().catch(() => {});
  process.exit(1);
});
