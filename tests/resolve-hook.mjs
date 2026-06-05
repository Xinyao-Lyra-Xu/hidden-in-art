// Module resolution hook for `node --test`.
//
// The source uses TypeScript's bundler-style imports — the `@/*` path alias and
// extensionless specifiers — which Node can't resolve on its own. This hook
// teaches the loader to:
//   1. rewrite `@/foo` to <project>/src/foo,
//   2. retry a failed resolve by appending `.ts` / `.tsx` / `/index.ts`, and
//   3. attach the `type: "json"` import attribute for `.json` modules, which the
//      bundler adds implicitly but the bare Node loader requires explicitly.
//
// Node 24 strips the TypeScript types itself, so no transpiler is needed. This
// stays dependency-free and runs offline — no API key, no install.

import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const EXT_CANDIDATES = [".ts", ".tsx", "/index.ts"];

// Mirror the bundler's implicit JSON attribute so `import x from "./y.json"`
// resolves the same way under `node --test` as it does in the Next build.
function withJsonAttribute(result) {
  if (result?.url?.endsWith(".json")) {
    return { ...result, importAttributes: { ...result.importAttributes, type: "json" } };
  }
  return result;
}

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;

  // `@/foo/bar` -> absolute file URL under src/
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  }

  try {
    return withJsonAttribute(await nextResolve(spec, context));
  } catch (err) {
    // Retry with explicit TypeScript extensions before giving up.
    for (const ext of EXT_CANDIDATES) {
      try {
        return withJsonAttribute(await nextResolve(spec + ext, context));
      } catch {
        // try the next candidate
      }
    }
    throw err;
  }
}
