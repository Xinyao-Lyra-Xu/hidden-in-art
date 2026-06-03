// Online behavioral eval for the art agent.
//
// Runs each scenario in eval/cases.ts against the REAL configured model and
// checks structural outcomes. This hits the provider API (costs quota), so it
// is a manual gate, not part of CI:
//
//   npm run eval            # one pass
//   npm run eval -- --runs 3  # repeat for a flakiness read
//
// Determinism is helped by temperature 0 + structural (not prose) assertions.
// Requires LLM_API_KEY (loaded from .env.local if present).

import { runChatTurn } from "@/application/agentChat";
import { resolveLlmConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatCaller } from "@/infrastructure/llm/openaiCompatCaller";
import { withRetry } from "@/infrastructure/llm/retry";
import { LlmHttpError, LlmTimeoutError } from "@/infrastructure/llm/errors";
import { EVAL_CASES } from "../eval/cases";
import { EVAL_LIBRARY } from "../eval/library";

// Provider/transport problems (auth, disabled API, quota, timeout) mean the eval
// can't measure agent behavior at all — exit distinctly so it's not mistaken for
// a behavioral regression.
class ProviderError extends Error {}
function isInfraError(err: unknown): boolean {
  return err instanceof LlmHttpError || err instanceof LlmTimeoutError;
}

// Best-effort load of .env.local (Node 21+). Ignore if absent.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on real env */
}

function parseRuns(argv: string[]): number {
  const i = argv.indexOf("--runs");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

// Resolve to an exit code instead of calling process.exit() mid-loop: an abrupt
// exit while undici keep-alive sockets are still open trips a libuv assertion on
// Windows. Setting process.exitCode and returning lets the loop drain cleanly.
async function main(): Promise<number> {
  const runs = parseRuns(process.argv.slice(2));

  let config;
  try {
    config = resolveLlmConfig();
  } catch (err) {
    if (err instanceof MissingLlmKeyError) {
      console.error("✗ " + err.message);
      return 2;
    }
    throw err;
  }

  // temperature 0 for repeatability; modest output cap to keep cost down.
  const caller = withRetry(
    createOpenAiCompatCaller({ ...config, temperature: 0, maxOutputTokens: config.maxOutputTokens ?? 512 }),
    { maxAttempts: 3 },
  );

  console.log(`\nArt-agent eval · model=${config.model} · runs=${runs}\n`);

  let checksTotal = 0;
  let checksPassed = 0;
  let casesFailed = 0;

  for (const c of EVAL_CASES) {
    let casePassedAllRuns = true;
    const labelTallies = new Map<string, number>();

    for (let run = 0; run < runs; run++) {
      let result;
      try {
        result = await runChatTurn({
          message: c.message,
          settings: c.settings,
          history: c.history,
          library: EVAL_LIBRARY,
          callLlm: caller,
        });
      } catch (err) {
        // Auth/quota/timeout: the model never ran, so abort the whole eval with
        // a distinct code instead of reporting bogus behavioral failures.
        if (isInfraError(err)) {
          throw new ProviderError(err instanceof Error ? err.message : String(err));
        }
        console.log(`  ✗ ${c.name} — turn threw: ${err instanceof Error ? err.message : String(err)}`);
        casePassedAllRuns = false;
        continue;
      }
      for (const chk of c.checks) {
        const ok = chk.pass(result);
        labelTallies.set(chk.label, (labelTallies.get(chk.label) ?? 0) + (ok ? 1 : 0));
        if (!ok) casePassedAllRuns = false;
      }
    }

    console.log(`${casePassedAllRuns ? "✓" : "✗"} ${c.name}`);
    for (const chk of c.checks) {
      const passes = labelTallies.get(chk.label) ?? 0;
      checksTotal += 1;
      if (passes === runs) checksPassed += 1;
      const rate = runs > 1 ? ` (${passes}/${runs})` : "";
      console.log(`    ${passes === runs ? "✓" : "✗"} ${chk.label}${rate}`);
    }
    if (!casePassedAllRuns) casesFailed += 1;
  }

  console.log(
    `\n${checksPassed}/${checksTotal} checks passed · ${EVAL_CASES.length - casesFailed}/${EVAL_CASES.length} cases green\n`,
  );
  return casesFailed > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof ProviderError) {
      console.error(`\n✗ Provider error — eval could not run:\n  ${err.message.slice(0, 300)}\n`);
      console.error(
        "This is an LLM connectivity/config issue (auth, disabled API, or quota),\n" +
          "not an agent behavior failure. Fix the key/project, then re-run `npm run eval`.\n",
      );
      process.exitCode = 2;
      return;
    }
    console.error(err);
    process.exitCode = 1;
  });
