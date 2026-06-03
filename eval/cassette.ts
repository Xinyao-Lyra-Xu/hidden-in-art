// VCR-style cassettes for the eval harness.
//
// Recording mode wraps the real caller and captures every response, in order,
// to a JSON "cassette" per case. Replay mode returns those recorded responses
// without any network — deterministic, free, and key-less, so the eval can run
// in CI. Re-record (`npm run eval -- --record`) whenever you intentionally
// change the prompt/tools and want a new baseline.
//
// The guarantee: replay tests the agent CODE (response parsing, tool execution,
// settings merge, multi-turn assembly) against fixed model outputs. It catches
// code regressions, not model drift.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { LlmCaller, LlmResponse } from "@/domain/agent/runner";

const DIR = path.join(process.cwd(), "eval", "__cassettes__");

function cassettePath(name: string): string {
  const safe = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return path.join(DIR, `${safe}.json`);
}

export type Cassette = {
  caseName: string;
  model: string;
  recordedAt: string;
  responses: LlmResponse[];
};

export function hasCassette(name: string): boolean {
  return existsSync(cassettePath(name));
}

export function loadCassette(name: string): Cassette {
  const raw = readFileSync(cassettePath(name), "utf8");
  return JSON.parse(raw) as Cassette;
}

// Replays recorded responses in order. Throws if the runner asks for more calls
// than were recorded (a sign the call sequence changed — re-record).
export function createReplayCaller(name: string): LlmCaller {
  const tape = loadCassette(name);
  let i = 0;
  return async () => {
    if (i >= tape.responses.length) {
      throw new Error(
        `Cassette "${name}" exhausted after ${tape.responses.length} responses — ` +
          `the call sequence changed. Re-record with: npm run eval -- --record`,
      );
    }
    return tape.responses[i++]!;
  };
}

// Wraps the real caller, capturing each response. Call flush() after the case to
// persist the tape.
export function createRecordingCaller(
  real: LlmCaller,
  name: string,
  model: string,
): { caller: LlmCaller; flush: () => void } {
  const responses: LlmResponse[] = [];
  const caller: LlmCaller = async (args) => {
    const response = await real(args);
    responses.push(response);
    return response;
  };
  const flush = () => {
    mkdirSync(DIR, { recursive: true });
    const tape: Cassette = {
      caseName: name,
      model,
      recordedAt: new Date().toISOString(),
      responses,
    };
    writeFileSync(cassettePath(name), JSON.stringify(tape, null, 2) + "\n", "utf8");
  };
  return { caller, flush };
}
