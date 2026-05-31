import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustAbstraction,
  adjustPatchCount,
  clamp01,
  clampPatchCount,
  focalRegionToBox,
  jitterCoeff,
} from "@/domain/agent/settings";
import { PATCH_MAX, PATCH_MIN } from "@/domain/agent/types";

test("clamp01 keeps values within [0,1] and handles NaN", () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
});

test("clampPatchCount snaps to step and clamps to bounds", () => {
  assert.equal(clampPatchCount(2543), 2500); // snaps to nearest 100
  assert.equal(clampPatchCount(50), PATCH_MIN); // below floor
  assert.equal(clampPatchCount(99999), PATCH_MAX); // above ceiling
  assert.equal(clampPatchCount(Infinity), PATCH_MIN);
});

test("adjustPatchCount moves by amount and respects bounds", () => {
  assert.equal(adjustPatchCount(2500, "more", "slight"), 2900);
  assert.equal(adjustPatchCount(2500, "less", "moderate"), 1600);
  assert.equal(adjustPatchCount(4000, "more", "large"), PATCH_MAX); // clamped
  assert.equal(adjustPatchCount(2500, "more"), 3400); // default = moderate
});

test("adjustAbstraction moves by amount within [0,1]", () => {
  assert.equal(adjustAbstraction(0.35, "more", "slight"), 0.5);
  assert.equal(adjustAbstraction(0.1, "less", "large"), 0);
  assert.equal(adjustAbstraction(0.9, "more", "large"), 1);
});

test("jitterCoeff is zero for nearest, scales with abstraction otherwise", () => {
  assert.equal(jitterCoeff({ colorMatch: "nearest", abstraction: 1 }), 0);
  assert.ok(jitterCoeff({ colorMatch: "jitter", abstraction: 0.5 }) > 0);
  // dither stays tighter than free jitter at the same abstraction
  const j = jitterCoeff({ colorMatch: "jitter", abstraction: 0.5 });
  const d = jitterCoeff({ colorMatch: "dither", abstraction: 0.5 });
  assert.ok(d < j);
});

test("focalRegionToBox returns null for auto and a centered box otherwise", () => {
  assert.equal(focalRegionToBox("auto"), null);

  const center = focalRegionToBox("center");
  assert.ok(center);
  // centered horizontally and vertically
  assert.ok(Math.abs((center.nx0 + center.nx1) / 2 - 0.5) < 1e-9);
  assert.ok(Math.abs((center.ny0 + center.ny1) / 2 - 0.5) < 1e-9);

  const topLeft = focalRegionToBox("top-left");
  assert.ok(topLeft);
  // top-left box sits above and left of center
  assert.ok((topLeft.nx0 + topLeft.nx1) / 2 < 0.5);
  assert.ok((topLeft.ny0 + topLeft.ny1) / 2 < 0.5);
  // stays within the normalized [0,1] frame
  assert.ok(topLeft.nx0 >= 0 && topLeft.ny0 >= 0);
});
