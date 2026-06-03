import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type FocalBox,
  clamp01, regionLabel, pickCorner, insideFocal, moveFocal, resizeFocal,
  FOCAL_MIN, CORNER_HIT,
} from "@/lib/focalBox";

const BOX: FocalBox = { nx0: 0.3, ny0: 0.3, nx1: 0.6, ny1: 0.6 };

test("clamp01 keeps values within the given bounds", () => {
  assert.equal(clamp01(0.5, 0, 1), 0.5);
  assert.equal(clamp01(-2, 0, 1), 0);
  assert.equal(clamp01(5, 0, 1), 1);
  assert.equal(clamp01(0.1, 0.2, 0.8), 0.2);
});

test("regionLabel names the box by its center", () => {
  assert.equal(regionLabel({ nx0: 0.4, ny0: 0.4, nx1: 0.5, ny1: 0.5 }), "center");
  assert.equal(regionLabel({ nx0: 0.0, ny0: 0.0, nx1: 0.2, ny1: 0.2 }), "top-left");
  assert.equal(regionLabel({ nx0: 0.8, ny0: 0.8, nx1: 1.0, ny1: 1.0 }), "bottom-right");
  assert.equal(regionLabel({ nx0: 0.0, ny0: 0.4, nx1: 0.2, ny1: 0.5 }), "left");
  assert.equal(regionLabel({ nx0: 0.4, ny0: 0.8, nx1: 0.5, ny1: 1.0 }), "bottom");
});

test("pickCorner returns the corner under the pointer, else null", () => {
  assert.equal(pickCorner(0.3, 0.3, BOX), "tl");
  assert.equal(pickCorner(0.6, 0.3, BOX), "tr");
  assert.equal(pickCorner(0.3, 0.6, BOX), "bl");
  assert.equal(pickCorner(0.6, 0.6, BOX), "br");
  // dead center is far from every corner
  assert.equal(pickCorner(0.45, 0.45, BOX), null);
});

test("pickCorner respects the hit radius", () => {
  // just inside the default hit radius of the tl corner
  assert.equal(pickCorner(0.3 + CORNER_HIT * 0.5, 0.3, BOX), "tl");
  // just outside it
  assert.equal(pickCorner(0.3 + CORNER_HIT * 1.5, 0.3, BOX), null);
});

test("insideFocal detects points within the box", () => {
  assert.equal(insideFocal(0.45, 0.45, BOX), true);
  assert.equal(insideFocal(0.3, 0.3, BOX), true); // edge counts as inside
  assert.equal(insideFocal(0.1, 0.45, BOX), false);
  assert.equal(insideFocal(0.45, 0.9, BOX), false);
});

test("moveFocal translates the box and preserves its size", () => {
  const moved = moveFocal(BOX, 0.1, -0.1);
  assert.ok(Math.abs(moved.nx0 - 0.4) < 1e-9);
  assert.ok(Math.abs(moved.ny0 - 0.2) < 1e-9);
  assert.ok(Math.abs((moved.nx1 - moved.nx0) - 0.3) < 1e-9);
  assert.ok(Math.abs((moved.ny1 - moved.ny0) - 0.3) < 1e-9);
});

test("moveFocal clamps the box inside [0,1] without shrinking it", () => {
  const moved = moveFocal(BOX, 1, 1); // push far past the right/bottom edge
  assert.ok(Math.abs(moved.nx1 - 1) < 1e-9);
  assert.ok(Math.abs(moved.ny1 - 1) < 1e-9);
  assert.ok(Math.abs((moved.nx1 - moved.nx0) - 0.3) < 1e-9);
  assert.ok(Math.abs((moved.ny1 - moved.ny0) - 0.3) < 1e-9);
});

test("resizeFocal drags a corner to the pointer", () => {
  const r = resizeFocal(BOX, "br", 0.8, 0.75);
  assert.ok(Math.abs(r.nx1 - 0.8) < 1e-9);
  assert.ok(Math.abs(r.ny1 - 0.75) < 1e-9);
  assert.equal(r.nx0, BOX.nx0);
  assert.equal(r.ny0, BOX.ny0);
});

test("resizeFocal enforces the minimum box size", () => {
  // drag br all the way to the tl corner — edges should stop FOCAL_MIN apart
  const r = resizeFocal(BOX, "br", 0, 0);
  assert.ok(Math.abs(r.nx1 - (r.nx0 + FOCAL_MIN)) < 1e-9);
  assert.ok(Math.abs(r.ny1 - (r.ny0 + FOCAL_MIN)) < 1e-9);
});

test("resizeFocal clamps a corner inside [0,1]", () => {
  const r = resizeFocal(BOX, "tl", -1, -1);
  assert.equal(r.nx0, 0);
  assert.equal(r.ny0, 0);
});
