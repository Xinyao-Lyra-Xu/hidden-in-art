import { test } from "node:test";
import assert from "node:assert/strict";
import { type GridMatch, findClosestMatch, patchesInRadius } from "@/lib/gridMatch";

function m(focalNx: number, focalNy: number): GridMatch {
  return { focalNx, focalNy, userNx: 0, userNy: 0, r: 0, g: 0, b: 0 };
}

const GRID: GridMatch[] = [
  m(0.1, 0.1), m(0.9, 0.1),
  m(0.1, 0.9), m(0.9, 0.9),
  m(0.5, 0.5),
];

test("findClosestMatch returns null for an empty list", () => {
  assert.equal(findClosestMatch([], 0.5, 0.5), null);
});

test("findClosestMatch returns the nearest grid cell", () => {
  assert.deepEqual(findClosestMatch(GRID, 0.48, 0.52), m(0.5, 0.5));
  assert.deepEqual(findClosestMatch(GRID, 0.05, 0.05), m(0.1, 0.1));
  assert.deepEqual(findClosestMatch(GRID, 0.95, 0.85), m(0.9, 0.9));
});

test("patchesInRadius returns indices of patches under the brush", () => {
  // recon area: origin (0,0), size 100x100 → focal coords map 1:1 to 0..100
  const hits = patchesInRadius(GRID, 0, 0, 100, 100, 50, 50, 5);
  assert.deepEqual(hits, [4]); // only the center patch (50,50) is within 5px
});

test("patchesInRadius includes a patch exactly on the radius boundary", () => {
  // center patch is at (50,50); a brush at (45,50) radius 5 just touches it
  const hits = patchesInRadius(GRID, 0, 0, 100, 100, 45, 50, 5);
  assert.deepEqual(hits, [4]);
});

test("patchesInRadius returns empty when nothing is in range", () => {
  // (50,30) sits 20px from the nearest patch center (50,50); radius 1 misses all
  const hits = patchesInRadius(GRID, 0, 0, 100, 100, 50, 30, 1);
  assert.deepEqual(hits, []);
});

test("patchesInRadius respects the recon offset and size", () => {
  // shift recon origin to (200,200), size 100 → patch (0.1,0.1) sits at (210,210)
  const hits = patchesInRadius(GRID, 200, 200, 100, 100, 210, 210, 5);
  assert.deepEqual(hits, [0]);
});

test("patchesInRadius can return several patches for a large brush", () => {
  const hits = patchesInRadius(GRID, 0, 0, 100, 100, 50, 50, 200);
  assert.deepEqual(hits, [0, 1, 2, 3, 4]);
});
