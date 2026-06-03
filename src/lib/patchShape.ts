// Patch shape used to render each reconstructed pixel: a circle, a square, or a
// rotated brush stroke (ellipse).

export type PatchShape = "circle" | "square" | "brush";

// Cheap deterministic hash in (-1, 1) — the final XOR yields a signed 32-bit int,
// so the sign varies. Used to give each brush patch a stable angle across render
// passes (same seed → same value); the sign is irrelevant to its callers.
export function fastRand(a: number, b: number): number {
  let x = ((a * 12347 + b * 17911) ^ (a << 5)) >>> 0;
  x ^= x >>> 16;
  x = (x * 0x45d9f3b) >>> 0;
  x ^= x >>> 16;
  return x / 0xffffffff;
}

// Minimal subset of CanvasRenderingContext2D that patchPath needs. Lets the path
// math be exercised without a real DOM canvas.
export interface PatchPathCtx {
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(
    x: number, y: number, rx: number, ry: number,
    rotation: number, start: number, end: number,
  ): void;
}

// Sets the current path on ctx for one patch. `seed` keeps the brush angle stable
// for a given patch across the colored / pixel render passes.
export function patchPath(
  ctx: PatchPathCtx,
  cx: number, cy: number, r: number,
  shape: PatchShape,
  seed: number,
): void {
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(cx - r, cy - r, r * 2, r * 2);
  } else if (shape === "brush") {
    const angle = fastRand(seed * 31 + 5, 7) * Math.PI;
    ctx.ellipse(cx, cy, r * 1.55, r * 0.72, angle, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}
