// A GridMatch maps one cell of the focal grid (focalNx/focalNy, normalized within
// the focal box) to the source-photo pixel it borrows color from (userNx/userNy).

export type GridMatch = {
  focalNx: number; focalNy: number;
  userNx:  number; userNy:  number;
  r: number; g: number; b: number;
};

// Nearest match to a focal-grid point, by squared distance. Used by hover tracing
// to find which patch the cursor is over.
export function findClosestMatch(
  matches: GridMatch[], fnx: number, fny: number,
): GridMatch | null {
  if (matches.length === 0) return null;
  let best = matches[0];
  let bestD = (best.focalNx - fnx) ** 2 + (best.focalNy - fny) ** 2;
  for (const m of matches) {
    const d = (m.focalNx - fnx) ** 2 + (m.focalNy - fny) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// Indices of patches whose on-canvas center falls within `rad` of (mx, my).
// Drives the brush-reveal mode: each pointer move reveals the patches it touches.
export function patchesInRadius(
  matches: GridMatch[],
  reconX: number, reconY: number, reconW: number, reconH: number,
  mx: number, my: number, rad: number,
): number[] {
  const rad2 = rad * rad;
  const out: number[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m  = matches[i];
    const cx = reconX + m.focalNx * reconW;
    const cy = reconY + m.focalNy * reconH;
    const dx = cx - mx, dy = cy - my;
    if (dx * dx + dy * dy <= rad2) out.push(i);
  }
  return out;
}
