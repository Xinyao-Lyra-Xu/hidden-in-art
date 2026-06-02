// Pure settings math for the art agent.
//
// Every function here is deterministic and side-effect free so the tools and
// runner can call them freely and tests can pin exact numbers. Non-finite input
// collapses to the safe floor rather than propagating NaN/Infinity outward.

import {
  PATCH_MIN,
  PATCH_MAX,
  PATCH_STEP,
  type Amount,
  type ColorMatch,
  type Direction,
  type FocalRegion,
} from "./types";

const PATCH_AMOUNTS: Record<Amount, number> = {
  slight: 400,
  moderate: 900,
  large: 1600,
};

const ABSTRACTION_AMOUNTS: Record<Amount, number> = {
  slight: 0.15,
  moderate: 0.3,
  large: 0.5,
};

// Free jitter wanders further from the target color than ordered dither, which
// stays tighter to it — both scale with abstraction, nearest never wanders.
const JITTER_GAIN: Record<ColorMatch, number> = {
  nearest: 0,
  dither: 0.2,
  jitter: 0.4,
};

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function clampPatchCount(n: number): number {
  if (!Number.isFinite(n)) return PATCH_MIN;
  const snapped = Math.round(n / PATCH_STEP) * PATCH_STEP;
  return Math.max(PATCH_MIN, Math.min(PATCH_MAX, snapped));
}

export function adjustPatchCount(
  current: number,
  direction: Direction,
  amount: Amount = "moderate",
): number {
  const delta = PATCH_AMOUNTS[amount] * (direction === "more" ? 1 : -1);
  return clampPatchCount(current + delta);
}

export function adjustAbstraction(
  current: number,
  direction: Direction,
  amount: Amount = "moderate",
): number {
  const delta = ABSTRACTION_AMOUNTS[amount] * (direction === "more" ? 1 : -1);
  return clamp01(current + delta);
}

// How far a rendered patch's color is allowed to drift from the exact target.
export function jitterCoeff(opts: { colorMatch: ColorMatch; abstraction: number }): number {
  return JITTER_GAIN[opts.colorMatch] * clamp01(opts.abstraction);
}

export type FocalBox = { nx0: number; ny0: number; nx1: number; ny1: number };

// Maps a named region to a normalized [0,1] box, or null for "auto" (no focus).
// Each region is a half-frame quadrant; center is the middle half-frame.
export function focalRegionToBox(region: FocalRegion): FocalBox | null {
  switch (region) {
    case "auto":
      return null;
    case "center":
      return { nx0: 0.25, ny0: 0.25, nx1: 0.75, ny1: 0.75 };
    case "top-left":
      return { nx0: 0, ny0: 0, nx1: 0.5, ny1: 0.5 };
    case "top-right":
      return { nx0: 0.5, ny0: 0, nx1: 1, ny1: 0.5 };
    case "bottom-left":
      return { nx0: 0, ny0: 0.5, nx1: 0.5, ny1: 1 };
    case "bottom-right":
      return { nx0: 0.5, ny0: 0.5, nx1: 1, ny1: 1 };
  }
}
