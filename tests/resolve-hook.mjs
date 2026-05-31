// Module resolution hook for `node --test`.
//
// The source uses TypeScript's bundler-style imports — the `@/*` path alias and
// extensionless specifiers — which Node can't resolve on its own. This hook
// teaches the loader to:
//   1. rewrite `@/foo` to <project>/src/foo, and
//   2. retry a failed resolve by appending `.ts` / `.tsx` / `/index.ts`.
//
// Node 24 strips the TypeScript types itself, so no transpiler is needed. Tests
// only import pure `.ts` domain modules (never `.tsx` or `next/*`), so this stays
// dependency-free and runs offline — no API key, no install.

import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const EXT_CANDIDATES = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;

  // `@/foo/bar` -> absolute file URL under src/
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  }

  try {
    return await nextResolve(spec, context);
  } catch (err) {
    // Retry with explicit TypeScript extensions before giving up.
    for (const ext of EXT_CANDIDATES) {
      try {
        return await nextResolve(spec + ext, context);
      } catch {
        // try the next candidate
      }
    }
    throw err;
  }
}
