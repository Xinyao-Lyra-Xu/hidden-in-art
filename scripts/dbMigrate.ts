// Applies Drizzle migrations to the Postgres pointed at by DATABASE_URL.
//
//   npm run db:generate   # author SQL from the schema (offline, no DB)
//   npm run db:migrate    # apply it here
//
// The pgvector extension is created first: the table/index migration references
// the `vector` type and `vector_cosine_ops`, which don't exist until the
// extension is installed. `CREATE EXTENSION IF NOT EXISTS vector` is idempotent
// and a no-op on re-runs. Neon/Supabase ship the extension; a bare Postgres
// needs the pgvector package installed server-side.

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Best-effort load of .env.local (Node 21+), matching scripts/embed.ts.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    console.error("db:migrate: set DATABASE_URL in .env.local first.");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("db:migrate: migrations applied (pgvector ready).");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("db:migrate failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
