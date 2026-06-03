// Behavioral eval for the art agent — two modes.
//
//   npm run eval                  # REPLAY (default): offline, no key, CI-safe.
//                                  # Returns recorded model responses from
//                                  # eval/__cassettes__/ and checks agent code.
//   npm run eval -- --record      # RECORD: hits the REAL model, refreshes the
//                                  # cassettes. Needs LLM_API_KEY. Re-record
//                                  # whenever you change the prompt/tools.
//   npm run eval -- --runs 3      # replay 3x (flakiness read; deterministic)
//   npm run eval -- --record --interval 8000   # pace recording under free-tier RPM
//
// Checks assert STRUCTURAL outcomes (which tool ran, resulting settings, chosen
// painting), never the model's prose. Replay catches code regressions; re-record
// to re-baseline model behavior.

import { runChatTurn } from "@/application/agentChat";
import { resolveLlmConfig, MissingLlmKeyError } from "@/infrastructure/llm/config";
import { createOpenAiCompatCaller } from "@/infrastructure/llm/openaiCompatCaller";
import { withRetry } from "@/infrastructure/llm/retry";
import { LlmHttpError, LlmTimeoutError } from "@/infrastructure/llm/errors";
import type { LlmCaller } from "@/domain/agent/runner";
import { EVAL_CASES } from "../eval/cases";
import { EVAL_LIBRARY } from "../eval/library";
import {
  createReplayCaller,
  createRecordingCaller,
  hasCassette,
} from "../eval/cassette";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Enforce a minimum gap between model calls to respect free-tier RPM limits.
function throttleCaller(caller: LlmCaller, minIntervalMs: number): LlmCaller {
  if (minIntervalMs <= 0) return caller;
  let last = 0;
  return async (args) => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return caller(args);
  };
}

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

function parseIntFlag(argv: string[], flag: string, fallback: number, min = 1): number {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n >= min) return Math.floor(n);
  }
  return fallback;
}

type CaseCallerFactory = (caseName: string) => { caller: LlmCaller; flush: () => void };

// Resolve to an exit code instead of calling process.exit() mid-loop: an abrupt
// exit while undici keep-alive sockets are still open trips a libuv assertion on
// Windows. Setting process.exitCode and returning lets the loop drain cleanly.
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const record = argv.includes("--record");
  const force = argv.includes("--force");
  const runs = record ? 1 : parseIntFlag(argv, "--runs", 1);
  const intervalMs = parseIntFlag(argv, "--interval", 6500, 0);

  let modelLabel = "cassette";
  let makeCaller: CaseCallerFactory;

  if (record) {
    // RECORD: real model, throttled + patient retry, capture to cassettes.
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
    modelLabel = config.model;
    const real = throttleCaller(
      withRetry(
        createOpenAiCompatCaller({
          ...config,
          temperature: 0,
          maxOutputTokens: config.maxOutputTokens ?? 512,
        }),
        { maxAttempts: 5, baseDelayMs: 2000, maxDelayMs: 30_000 },
      ),
      intervalMs,
    );
    // Resumable: skip cases already recorded (verify via replay) so a run
    // interrupted by a rate-limit window can be re-run to finish the rest.
    // --force re-records everything.
    makeCaller = (caseName) => {
      if (!force && hasCassette(caseName)) {
        return { caller: createReplayCaller(caseName), flush: () => {} };
      }
      return createRecordingCaller(real, caseName, config!.model);
    };
  } else {
    // REPLAY: offline. Fail fast if any cassette is missing.
    const missing = EVAL_CASES.filter((c) => !hasCassette(c.name)).map((c) => c.name);
    if (missing.length > 0) {
      console.error(
        `✗ Missing cassettes for: ${missing.join(", ")}\n` +
          "  Record them once with: npm run eval -- --record\n",
      );
      return 2;
    }
    makeCaller = (caseName) => ({ caller: createReplayCaller(caseName), flush: () => {} });
  }

  console.log(
    `\nArt-agent eval · mode=${record ? "record" : "replay"} · model=${modelLabel} · runs=${runs}\n`,
  );

  let checksTotal = 0;
  let checksPassed = 0;
  let casesFailed = 0;

  for (const c of EVAL_CASES) {
    let casePassedAllRuns = true;
    const labelTallies = new Map<string, number>();

    for (let run = 0; run < runs; run++) {
      const { caller, flush } = makeCaller(c.name);
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
        if (isInfraError(err)) {
          throw new ProviderError(err instanceof Error ? err.message : String(err));
        }
        console.log(`  ✗ ${c.name} — turn threw: ${err instanceof Error ? err.message : String(err)}`);
        casePassedAllRuns = false;
        continue;
      }
      if (record) flush(); // persist the tape only after a successful turn
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
    `\n${checksPassed}/${checksTotal} checks passed · ${EVAL_CASES.length - casesFailed}/${EVAL_CASES.length} cases green` +
      (record ? " · cassettes refreshed" : "") +
      "\n",
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
          "not an agent behavior failure. Fix the key/project, then re-run with --record.\n",
      );
      process.exitCode = 2;
      return;
    }
    console.error(err);
    process.exitCode = 1;
  });
