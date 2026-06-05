// Drizzle Kit config: schema location, migration output, and the Postgres
// connection (read from DATABASE_URL).
//
//   npm run db:generate   # diff schema -> SQL migration in ./drizzle (no DB)
//   npm run db:migrate    # apply migrations (needs DATABASE_URL)
//   npm run db:seed       # load embeddings.json into the paintings table
//
// generate is offline (schema diff only); migrate/push/studio need DATABASE_URL.

import { defineConfig } from "drizzle-kit";

// Best-effort load of .env.local so `drizzle-kit` picks up DATABASE_URL without a
// separate dotenv dep, matching scripts/embed.ts and scripts/eval.ts.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Unused by `generate`; required by migrate/push/studio. Empty string keeps
    // generate working offline when DATABASE_URL isn't set.
    url: process.env.DATABASE_URL ?? "",
  },
});
