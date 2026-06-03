// Pure geometry for the draggable / resizable focal box. A FocalBox is stored in
// normalized [0,1] coordinates relative to the painting image.

export type FocalBox = { nx0: number; ny0: number; nx1: number; ny1: number };

export type Corner = "tl" | "tr" | "bl" | "br";

// Minimum box edge length, and how close (normalized) a pointer must be to a
// corner to grab it for resizing.
export const FOCAL_MIN = 0.08;
export const CORNER_HIT = 0.07;

export function clamp01(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function regionLabel(f: FocalBox): string {
  const cx = (f.nx0 + f.nx1) / 2;
  const cy = (f.ny0 + f.ny1) / 2;
  const h  = cx < 0.33 ? "left"  : cx > 0.67 ? "right"  : "";
  const v  = cy < 0.33 ? "top"   : cy > 0.67 ? "bottom" : "";
  if (v && h) return `${v}-${h}`;
  return v || h || "center";
}

// Returns the corner whose handle is within `hit` of (nx, ny), or null.
export function pickCorner(
  nx: number, ny: number, b: FocalBox, hit = CORNER_HIT,
): Corner | null {
  const corners: [Corner, number, number][] = [
    ["tl", b.nx0, b.ny0], ["tr", b.nx1, b.ny0],
    ["bl", b.nx0, b.ny1], ["br", b.nx1, b.ny1],
  ];
  for (const [c, cx, cy] of corners) {
    if (Math.abs(nx - cx) < hit && Math.abs(ny - cy) < hit) return c;
  }
  return null;
}

export function insideFocal(nx: number, ny: number, b: FocalBox): boolean {
  return nx >= b.nx0 && nx <= b.nx1 && ny >= b.ny0 && ny <= b.ny1;
}

// Translate the box by (dnx, dny), keeping its size and clamping it inside [0,1].
export function moveFocal(start: FocalBox, dnx: number, dny: number): FocalBox {
  const w = start.nx1 - start.nx0;
  const h = start.ny1 - start.ny0;
  const nx0 = clamp01(start.nx0 + dnx, 0, 1 - w);
  const ny0 = clamp01(start.ny0 + dny, 0, 1 - h);
  return { nx0, ny0, nx1: nx0 + w, ny1: ny0 + h };
}

// Drag one corner to (nx, ny), keeping each edge at least `min` from its opposite.
export function resizeFocal(
  start: FocalBox, corner: Corner, nx: number, ny: number, min = FOCAL_MIN,
): FocalBox {
  let { nx0, ny0, nx1, ny1 } = start;
  if (corner === "tl" || corner === "bl") nx0 = clamp01(nx, 0, nx1 - min);
  if (corner === "tr" || corner === "br") nx1 = clamp01(nx, nx0 + min, 1);
  if (corner === "tl" || corner === "tr") ny0 = clamp01(ny, 0, ny1 - min);
  if (corner === "bl" || corner === "br") ny1 = clamp01(ny, ny0 + min, 1);
  return { nx0, ny0, nx1, ny1 };
}
