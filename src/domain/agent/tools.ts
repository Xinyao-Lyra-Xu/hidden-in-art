// Tool definitions + executor for the art agent.
//
// ART_AGENT_TOOLS is the schema the LLM sees (Anthropic tool format).
// executeTool runs a single tool against the current settings and returns a
// patch to merge plus a human-readable summary. Tools never throw: invalid
// input or no-match produces { ok: false, patch: {} } so the runner can hand the
// failure back to the model and let it recover.

import {
  COLOR_MATCH_VALUES,
  FOCAL_REGION_VALUES,
  type AgentArtwork,
  type AgentSettings,
  type Amount,
  type ColorMatch,
  type Direction,
  type FocalRegion,
} from "./types";
import {
  adjustAbstraction,
  adjustPatchCount,
  clamp01,
  clampPatchCount,
} from "./settings";
import { matchArtwork } from "./matchArtwork";
import { fuseRankings } from "./retrieval";
import type { RetrievedDoc } from "./retriever";

export type ToolContext = {
  settings: AgentSettings;
  library: AgentArtwork[];
  // Semantic-search hits for this tool call's `query`, resolved by the runner
  // *before* the tool runs (the embedding is async; tool execution stays sync).
  // Absent when RAG isn't wired or the tool takes no query.
  retrieval?: RetrievedDoc[];
};

export type ToolResult = {
  ok: boolean;
  patch: Partial<AgentSettings>;
  summary: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const DIRECTION_SCHEMA = {
  type: "string",
  enum: ["more", "less"],
  description: "Move the value up ('more') or down ('less').",
};

const AMOUNT_SCHEMA = {
  type: "string",
  enum: ["slight", "moderate", "large"],
  description: "How big the relative change should be. Defaults to moderate.",
};

export const ART_AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "set_target_painting",
    description:
      "Choose which famous painting's style the photo is rebuilt with. Pass a free-text query like an artist name, subject, or mood (e.g. 'Monet water reflections', 'a dramatic portrait').",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of the desired painting or style.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "set_patch_density",
    description:
      "Set how many patches/threads the mosaic uses — higher means finer detail. Provide an absolute 'value', or a relative 'direction' with optional 'amount'.",
    input_schema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Absolute patch count (snapped and clamped to bounds)." },
        direction: DIRECTION_SCHEMA,
        amount: AMOUNT_SCHEMA,
      },
    },
  },
  {
    name: "set_color_matching",
    description:
      "Pick the color-matching algorithm: 'nearest' (exact), 'jitter' (loose, painterly) or 'dither' (ordered). Optionally also set 'abstraction' (0..1).",
    input_schema: {
      type: "object",
      properties: {
        algorithm: {
          type: "string",
          enum: COLOR_MATCH_VALUES,
          description: "Which color-matching algorithm to use.",
        },
        abstraction: {
          type: "number",
          description: "Optional abstraction level from 0 (literal) to 1 (loose).",
        },
      },
      required: ["algorithm"],
    },
  },
  {
    name: "adjust_abstraction",
    description:
      "Control how loose or literal the reconstruction is (0..1). Provide an absolute 'value', or a relative 'direction' with optional 'amount'.",
    input_schema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Absolute abstraction from 0 to 1." },
        direction: DIRECTION_SCHEMA,
        amount: AMOUNT_SCHEMA,
      },
    },
  },
  {
    name: "set_focal_region",
    description:
      "Tell the renderer where to concentrate detail: 'auto', 'center', or a corner like 'top-left'.",
    input_schema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          enum: FOCAL_REGION_VALUES,
          description: "Which part of the image to keep sharp.",
        },
      },
      required: ["region"],
    },
  },
  {
    name: "search_paintings",
    description:
      "Look up paintings in the library by meaning, not just keywords. Use this to answer questions about a painting's story, artist, or brushwork, or to find candidates before setting a target. Returns the most relevant paintings with curatorial notes. This does NOT change any settings.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to search for — a subject, mood, technique, artist, or question (e.g. 'how did Van Gogh build texture', 'something calm and domestic').",
        },
      },
      required: ["query"],
    },
  },
];

function fail(summary: string): ToolResult {
  return { ok: false, patch: {}, summary };
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function num(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  return typeof v === "number" ? v : undefined;
}

function setTargetPainting(input: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const query = str(input, "query") ?? "";
  const inLibrary = new Set(ctx.library.map((a) => a.id));

  // Two independent rankers over the live library:
  //   - keyword: deterministic, nails exact artist/subject/tag tokens
  //   - semantic: understands mood/technique ("a swirling emotional sky"), only
  //     usable when RAG is wired; restricted to ids the renderer actually has.
  const keywordIds = matchArtwork(query, ctx.library).map((m) => m.artwork.id);
  const semanticIds = (ctx.retrieval ?? [])
    .map((h) => h.id)
    .filter((id) => inLibrary.has(id));

  // Fuse when both fire (best of both signals); otherwise use whichever ranker
  // produced anything — preserving the keyword-only behavior when RAG is off.
  let chosenId: string | undefined;
  if (semanticIds.length > 0 && keywordIds.length > 0) {
    chosenId = fuseRankings([semanticIds, keywordIds])[0]?.id;
  } else {
    chosenId = semanticIds[0] ?? keywordIds[0];
  }

  if (!chosenId) {
    return fail(`Nothing in the library matches "${query}". Try an artist or subject.`);
  }
  const best = ctx.library.find((a) => a.id === chosenId);
  if (!best) {
    return fail(`Nothing in the library matches "${query}". Try an artist or subject.`);
  }
  return {
    ok: true,
    patch: { targetArtworkId: best.id },
    summary: `Target set to "${best.title}" by ${best.artist}.`,
  };
}

function setPatchDensity(input: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const value = num(input, "value");
  if (value != null) {
    const patchCount = clampPatchCount(value);
    return { ok: true, patch: { patchCount }, summary: `Patch density set to ${patchCount}.` };
  }
  const direction = str(input, "direction") as Direction | undefined;
  if (direction === "more" || direction === "less") {
    const amount = str(input, "amount") as Amount | undefined;
    const patchCount = adjustPatchCount(ctx.settings.patchCount, direction, amount);
    return { ok: true, patch: { patchCount }, summary: `Patch density now ${patchCount}.` };
  }
  return fail("Provide either a numeric value or a direction ('more'/'less').");
}

function setColorMatching(input: Record<string, unknown>): ToolResult {
  const algorithm = str(input, "algorithm");
  if (!algorithm || !COLOR_MATCH_VALUES.includes(algorithm as ColorMatch)) {
    return fail(`Unknown algorithm "${algorithm}". Use one of: ${COLOR_MATCH_VALUES.join(", ")}.`);
  }
  const patch: Partial<AgentSettings> = { colorMatch: algorithm as ColorMatch };
  const abstraction = num(input, "abstraction");
  if (abstraction != null) patch.abstraction = clamp01(abstraction);
  return { ok: true, patch, summary: `Color matching set to ${algorithm}.` };
}

function adjustAbstractionTool(input: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const value = num(input, "value");
  if (value != null) {
    const abstraction = clamp01(value);
    return { ok: true, patch: { abstraction }, summary: `Abstraction set to ${abstraction}.` };
  }
  const direction = str(input, "direction") as Direction | undefined;
  if (direction === "more" || direction === "less") {
    const amount = str(input, "amount") as Amount | undefined;
    const abstraction = adjustAbstraction(ctx.settings.abstraction, direction, amount);
    return { ok: true, patch: { abstraction }, summary: `Abstraction now ${abstraction}.` };
  }
  return fail("Provide either a numeric value or a direction ('more'/'less').");
}

function setFocalRegion(input: Record<string, unknown>): ToolResult {
  const region = str(input, "region");
  if (!region || !FOCAL_REGION_VALUES.includes(region as FocalRegion)) {
    return fail(`Unknown region "${region}". Use one of: ${FOCAL_REGION_VALUES.join(", ")}.`);
  }
  return {
    ok: true,
    patch: { focalRegion: region as FocalRegion },
    summary: `Focal region set to ${region}.`,
  };
}

// How many retrieved paintings to surface back to the model for a knowledge
// lookup. Enough to give context without flooding the prompt.
const SEARCH_RESULT_LIMIT = 3;

function searchPaintings(ctx: ToolContext): ToolResult {
  const hits = (ctx.retrieval ?? []).slice(0, SEARCH_RESULT_LIMIT);
  if (hits.length === 0) {
    // No retrieval wired, or nothing matched — let the model fall back to the
    // library list in the system prompt rather than inventing facts.
    return fail("No painting matched that search. Try a different description.");
  }
  const body = hits
    .map((h, i) => `${i + 1}. "${h.title}" by ${h.artist} — ${h.text}`)
    .join("\n");
  return {
    ok: true,
    patch: {},
    summary: `Most relevant paintings:\n${body}`,
  };
}

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolResult {
  switch (name) {
    case "set_target_painting":
      return setTargetPainting(input, ctx);
    case "set_patch_density":
      return setPatchDensity(input, ctx);
    case "set_color_matching":
      return setColorMatching(input);
    case "adjust_abstraction":
      return adjustAbstractionTool(input, ctx);
    case "set_focal_region":
      return setFocalRegion(input);
    case "search_paintings":
      return searchPaintings(ctx);
    default:
      return fail(`Unknown tool "${name}".`);
  }
}
