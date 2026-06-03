import { test } from "node:test";
import assert from "node:assert/strict";
import { type PatchPathCtx, fastRand, patchPath } from "@/lib/patchShape";

type Call = { op: string; args: number[] };

// Records the path calls patchPath makes, standing in for a real canvas context.
function recorder() {
  const calls: Call[] = [];
  const ctx: PatchPathCtx = {
    beginPath() { calls.push({ op: "beginPath", args: [] }); },
    rect(x, y, w, h) { calls.push({ op: "rect", args: [x, y, w, h] }); },
    arc(x, y, r, s, e) { calls.push({ op: "arc", args: [x, y, r, s, e] }); },
    ellipse(x, y, rx, ry, rot, s, e) {
      calls.push({ op: "ellipse", args: [x, y, rx, ry, rot, s, e] });
    },
  };
  return { ctx, calls };
}

test("fastRand is deterministic for the same seed", () => {
  assert.equal(fastRand(3, 7), fastRand(3, 7));
});

test("fastRand returns values in (-1, 1)", () => {
  for (let a = 0; a < 50; a++) {
    for (let b = 0; b < 5; b++) {
      const v = fastRand(a, b);
      assert.ok(v > -1 && v < 1, `fastRand(${a},${b}) = ${v} out of range`);
    }
  }
});

test("circle shape draws an arc of radius r", () => {
  const { ctx, calls } = recorder();
  patchPath(ctx, 10, 20, 5, "circle", 0);
  assert.deepEqual(calls[0], { op: "beginPath", args: [] });
  assert.deepEqual(calls[1], { op: "arc", args: [10, 20, 5, 0, Math.PI * 2] });
});

test("square shape draws a 2r x 2r rect centered on (cx,cy)", () => {
  const { ctx, calls } = recorder();
  patchPath(ctx, 10, 20, 5, "square", 0);
  assert.deepEqual(calls[1], { op: "rect", args: [5, 15, 10, 10] });
});

test("brush shape draws an ellipse with a seed-stable angle", () => {
  const { ctx, calls } = recorder();
  patchPath(ctx, 10, 20, 5, "brush", 4);
  const e = calls[1];
  assert.equal(e.op, "ellipse");
  assert.deepEqual(e.args.slice(0, 4), [10, 20, 5 * 1.55, 5 * 0.72]);
  const expectedAngle = fastRand(4 * 31 + 5, 7) * Math.PI;
  assert.ok(Math.abs(e.args[4] - expectedAngle) < 1e-12);
});

test("brush angle is stable across passes for the same seed", () => {
  const a = recorder();
  const b = recorder();
  patchPath(a.ctx, 0, 0, 5, "brush", 9);
  patchPath(b.ctx, 0, 0, 5, "brush", 9);
  assert.equal(a.calls[1].args[4], b.calls[1].args[4]);
});
