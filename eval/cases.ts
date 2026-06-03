// Behavioral eval scenarios for the art agent.
//
// Checks assert on STRUCTURAL outcomes (which tool ran, the resulting settings,
// the chosen painting) — never on the model's exact prose, which is inherently
// nondeterministic. Each check is tolerant: prefer "abstraction went up" over
// "abstraction === 0.65".

import type { AgentTurnResult } from "@/domain/agent/runner";
import type { AgentSettings } from "@/domain/agent/types";
import { DEFAULT_SETTINGS } from "@/domain/agent/types";

export type Check = { label: string; pass: (r: AgentTurnResult) => boolean };

export type EvalCase = {
  name: string;
  message: string;
  settings?: Partial<AgentSettings>;
  history?: { role: "user" | "assistant"; text: string }[];
  checks: Check[];
};

const calledOk = (r: AgentTurnResult, name: string) =>
  r.toolCalls.some((t) => t.name === name && t.ok);

export const EVAL_CASES: EvalCase[] = [
  {
    name: "selects Van Gogh for a swirling look",
    message: "make my photo look like a swirling Van Gogh painting",
    checks: [
      { label: "called set_target_painting", pass: (r) => calledOk(r, "set_target_painting") },
      { label: "target is The Starry Night", pass: (r) => r.settings.targetArtworkId === "vangogh-starry" },
    ],
  },
  {
    name: "selects a dramatic portrait",
    message: "I want a dramatic, dark portrait style",
    checks: [
      { label: "target is a portrait", pass: (r) => r.settings.targetArtworkId === "rembrandt-self" || r.settings.targetArtworkId === "vermeer-pearl" },
    ],
  },
  {
    name: "increases abstraction on request",
    message: "make it much more abstract and loose",
    settings: { abstraction: 0.35 },
    checks: [
      { label: "abstraction increased", pass: (r) => r.settings.abstraction > 0.35 },
    ],
  },
  {
    name: "adds more detail",
    message: "add a lot more fine detail",
    settings: { patchCount: DEFAULT_SETTINGS.patchCount, abstraction: 0.5 },
    checks: [
      {
        label: "more patches or less abstraction",
        pass: (r) =>
          r.settings.patchCount > DEFAULT_SETTINGS.patchCount || r.settings.abstraction < 0.5,
      },
    ],
  },
  {
    name: "looser color blending leaves nearest",
    message: "use a looser, more painterly color blending",
    settings: { colorMatch: "nearest" },
    checks: [
      { label: "colorMatch changed from nearest", pass: (r) => r.settings.colorMatch !== "nearest" },
    ],
  },
  {
    name: "remembers context across turns",
    message: "actually, make it even more abstract than that",
    settings: { abstraction: 0.5 },
    history: [
      { role: "user", text: "make it a bit more abstract" },
      { role: "assistant", text: "Done — nudged the abstraction up." },
    ],
    checks: [
      { label: "abstraction increased again", pass: (r) => r.settings.abstraction > 0.5 },
    ],
  },
];
