// Lazy Postgres connection for the RAG corpus.
//
// getDb() returns a Drizzle client bound to a shared pg Pool, or null when
// DATABASE_URL is unset — RAG then falls back to the committed in-memory vectors,
// the same way a missing embedding key falls back to keyword matching. The pool
// is created once and reused across requests (module-level singleton), so route
// handlers don't open a connection per turn.
//
// Generic by design: any standard Postgres works (Neon, Supabase, local
// Docker) — the driver honours sslmode in the connection string, so a Neon URL
// (…?sslmode=require) connects over TLS with no code change. This stays
// env-swappable in the same spirit as the LLM adapter.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: Db | null = null;

export function getDb(env: Record<string, string | undefined> = process.env): Db | null {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "") return null;
  if (!db) {
    pool = new Pool({
      connectionString: url,
      // Small cap: a single instance serves one agent turn at a time under the
      // concurrency limiter, so a large pool would just idle.
      max: 5,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

// For tests/scripts that need to shut the pool cleanly (the long-lived server
// keeps it open for its lifetime).
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
