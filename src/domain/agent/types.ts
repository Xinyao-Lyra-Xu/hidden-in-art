// Core types and constants for the conversational art agent.
//
// This layer is pure data: no React, no network, no LLM SDK. Everything the
// agent reasons about — the painting library, the live render settings, and the
// bounds those settings live within — is defined here so the rest of the domain
// (settings math, tools, runner) can stay framework-free and fully unit-testable.

export const PATCH_MIN = 1600;
export const PATCH_MAX = 4000;
export const PATCH_STEP = 100;

export type ColorMatch = "nearest" | "jitter" | "dither";

export type FocalRegion =
  | "auto"
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const COLOR_MATCH_VALUES: ColorMatch[] = ["nearest", "jitter", "dither"];

export const FOCAL_REGION_VALUES: FocalRegion[] = [
  "auto",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

// A trimmed view of an artwork — just the fields the agent matches on. The full
// ArtworkMetadata used by the renderer lives in domain/artwork; this slice keeps
// the agent decoupled from rendering concerns.
export type AgentArtwork = {
  id: string;
  title: string;
  artist: string;
  category: string;
  tags: string[];
  mood: string[];
};

export type AgentSettings = {
  targetArtworkId: string | null;
  patchCount: number;
  colorMatch: ColorMatch;
  abstraction: number; // 0..1
  focalRegion: FocalRegion;
};

export const DEFAULT_SETTINGS: AgentSettings = {
  targetArtworkId: null,
  patchCount: 2500,
  colorMatch: "nearest",
  abstraction: 0.35,
  focalRegion: "auto",
};

export type Direction = "more" | "less";
export type Amount = "slight" | "moderate" | "large";
