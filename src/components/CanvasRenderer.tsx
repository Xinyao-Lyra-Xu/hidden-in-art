"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderSettings } from "@/types/art";
import { MOSAIC_PAINTINGS } from "@/types/art";

// ── Layout constants ──────────────────────────────────────────────────────────
const CANVAS_W     = 900;
const TOP_PAD      = 52;
const RECON_FRAC   = 0.25;   // reconstruction width as fraction of CANVAS_W (~225 px)
const THREAD_GAP   = 80;
const SOURCE_MAX_H = 560;
const BOTTOM_PAD   = 28;
const MAX_PX       = 800;
const DOT_R        = 4.5;
const FOCAL_GRID   = 20;     // candidates inside focal region: 20×20 = 400
const FOCAL_SCAN   = 10;     // saliency scan grid size
const FOCAL_FRAC   = 0.40;   // focal region size as fraction of painting

// ── Types ─────────────────────────────────────────────────────────────────────
type PaintData = {
  pixels:    Uint8ClampedArray;
  w:         number;
  h:         number;
  srcCanvas: HTMLCanvasElement;
  srcImg:    HTMLImageElement;
};

type Match = {
  srcNx: number;  // normalized x in painting [0,1]
  srcNy: number;
  tgtNx: number;  // normalized x in reconstruction [0,1]
  tgtNy: number;
};

type FocalBox = { nx0: number; ny0: number; nx1: number; ny1: number };

// Maps normalized painting coords to canvas screen coords (accounts for center-crop).
type PaintXform = {
  visNx0: number; visNy0: number;
  visNW:  number; visNH:  number;
  screenY: number; screenH: number;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function n01(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function makeOffscreen(img: HTMLImageElement, maxPx: number): HTMLCanvasElement {
  const s = Math.min(maxPx / img.width, maxPx / img.height, 1);
  const c = document.createElement("canvas");
  c.width  = Math.round(img.width  * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d", { willReadFrequently: true })!
   .drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function avgRgb(
  px: Uint8ClampedArray,
  w: number, h: number,
  x0: number, y0: number,
  x1: number, y1: number,
): [number, number, number] {
  const lx = Math.max(0, Math.floor(x0));
  const ly = Math.max(0, Math.floor(y0));
  const rx = Math.min(w - 1, Math.ceil(x1) - 1);
  const ry = Math.min(h - 1, Math.ceil(y1) - 1);
  if (lx > rx || ly > ry) {
    const cx = Math.max(0, Math.min(w - 1, Math.round((x0 + x1) / 2)));
    const cy = Math.max(0, Math.min(h - 1, Math.round((y0 + y1) / 2)));
    const i  = (cy * w + cx) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  }
  let r = 0, g = 0, b = 0, n = 0;
  const sx = Math.max(1, Math.ceil((rx - lx + 1) / 5));
  const sy = Math.max(1, Math.ceil((ry - ly + 1) / 5));
  for (let qy = ly; qy <= ry; qy += sy) {
    for (let qx = lx; qx <= rx; qx += sx) {
      const i = (qy * w + qx) * 4;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
  }
  return n > 0 ? [r / n, g / n, b / n] : [128, 128, 128];
}

// Map a normalized painting position to screen canvas coords, correcting for center-crop.
function paintToScreen(xf: PaintXform, nx: number, ny: number): [number, number] {
  return [
    ((nx - xf.visNx0) / xf.visNW) * CANVAS_W,
    xf.screenY + ((ny - xf.visNy0) / xf.visNH) * xf.screenH,
  ];
}

// ── Saliency detection ────────────────────────────────────────────────────────
// Scan the inner FOCAL_SCAN×FOCAL_SCAN grid of the painting (skipping 1-cell border
// to avoid dark frames), find the cell with maximum color variance, and return a
// FOCAL_FRAC×FOCAL_FRAC bounding box centered on it.

function detectSalientRegion(px: Uint8ClampedArray, w: number, h: number): FocalBox {
  const cw = w / FOCAL_SCAN;
  const ch = h / FOCAL_SCAN;
  let bestScore = -1;
  let bestGx    = FOCAL_SCAN >> 1;
  let bestGy    = FOCAL_SCAN >> 1;

  // Skip outermost ring (often dark frames / blank margins)
  for (let gy = 1; gy < FOCAL_SCAN - 1; gy++) {
    for (let gx = 1; gx < FOCAL_SCAN - 1; gx++) {
      const x0 = gx * cw, y0 = gy * ch;
      const x1 = x0 + cw,  y1 = y0 + ch;
      const stepX = Math.max(1, Math.floor(cw / 6));
      const stepY = Math.max(1, Math.floor(ch / 6));
      let mr = 0, mg = 0, mb = 0, cnt = 0;

      for (let qy = Math.floor(y0); qy < Math.floor(y1); qy += stepY) {
        for (let qx = Math.floor(x0); qx < Math.floor(x1); qx += stepX) {
          const i = (Math.min(h - 1, qy) * w + Math.min(w - 1, qx)) * 4;
          mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; cnt++;
        }
      }
      if (cnt < 2) continue;
      mr /= cnt; mg /= cnt; mb /= cnt;

      let v = 0;
      for (let qy = Math.floor(y0); qy < Math.floor(y1); qy += stepY) {
        for (let qx = Math.floor(x0); qx < Math.floor(x1); qx += stepX) {
          const i = (Math.min(h - 1, qy) * w + Math.min(w - 1, qx)) * 4;
          const dr = px[i] - mr, dg = px[i + 1] - mg, db = px[i + 2] - mb;
          v += dr * dr + dg * dg + db * db;
        }
      }
      if (v > bestScore) { bestScore = v; bestGx = gx; bestGy = gy; }
    }
  }

  const cx   = (bestGx + 0.5) / FOCAL_SCAN;
  const cy   = (bestGy + 0.5) / FOCAL_SCAN;
  const half = FOCAL_FRAC / 2;
  return {
    nx0: Math.max(0, cx - half),
    ny0: Math.max(0, cy - half),
    nx1: Math.min(1, cx + half),
    ny1: Math.min(1, cy + half),
  };
}

// ── Blob growth (BFS with stochastic holes) ────────────────────────────────────
// Returns grid positions (normalized 0–1) for patches in the reconstruction.
// Grid is 2× target count so blob fills only the center region (torn fragment look).

function growBlob(
  targetCount: number,
  aspect: number,  // reconH / reconW
): { positions: { nx: number; ny: number }[]; blobCols: number; blobRows: number } {
  const blobCols = Math.max(8, Math.ceil(Math.sqrt(targetCount * 2 / aspect)));
  const blobRows = Math.max(8, Math.ceil(targetCount * 2 / blobCols));

  const seedCol = Math.floor(blobCols / 2);
  const seedRow = Math.floor(blobRows / 2);
  const visited = new Uint8Array(blobCols * blobRows);
  const positions: { nx: number; ny: number }[] = [];
  const queue: number[] = [seedCol, seedRow];
  visited[seedRow * blobCols + seedCol] = 1;
  let qi = 0;

  const SKIP = 0.21;

  while (qi < queue.length && positions.length < targetCount) {
    const col = queue[qi++];
    const row = queue[qi++];

    // ~21% stochastic skip creates organic internal holes
    if (n01(col * 0.71 + row * 0.37, col * 0.19 + row * 0.83) >= SKIP) {
      positions.push({ nx: (col + 0.5) / blobCols, ny: (row + 0.5) / blobRows });
    }

    // 4-connected neighbors (skipped cells still enqueue neighbors so BFS flows around holes)
    for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= blobCols || nr < 0 || nr >= blobRows) continue;
      const key = nr * blobCols + nc;
      if (!visited[key]) { visited[key] = 1; queue.push(nc, nr); }
    }
  }

  return { positions, blobCols, blobRows };
}

// ── Connected-component pruning ───────────────────────────────────────────────
// Union-find: two patches connect if their screen distance < (2r × 0.95).
// Keeps only the largest component.

function pruneToLargestComponent(
  matches: Match[],
  reconW: number, reconH: number,
  patchDispR: number,
): Match[] {
  const n = matches.length;
  if (n <= 1) return matches;

  const parent = Array.from({ length: n }, (_, i) => i);
  const rank   = new Int32Array(n);

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }

  const distSq = (2 * patchDispR * 0.95) ** 2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = (matches[i].tgtNx - matches[j].tgtNx) * reconW;
      const dy = (matches[i].tgtNy - matches[j].tgtNy) * reconH;
      if (dx * dx + dy * dy < distSq) {
        const ri = find(i), rj = find(j);
        if (ri !== rj) {
          if (rank[ri] < rank[rj]) parent[ri] = rj;
          else if (rank[ri] > rank[rj]) parent[rj] = ri;
          else { parent[rj] = ri; rank[ri]++; }
        }
      }
    }
  }

  const compSize = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    compSize.set(r, (compSize.get(r) ?? 0) + 1);
  }
  let bestRoot = find(0), bestSize = 0;
  for (const [root, size] of compSize) {
    if (size > bestSize) { bestSize = size; bestRoot = root; }
  }

  return matches.filter((_, i) => find(i) === bestRoot);
}

// ── Compute blob matches ──────────────────────────────────────────────────────
// For each blob position in reconstruction space, find the best-matching painting
// region within the focal box by color similarity to the user's photo.

function computeBlobMatches(
  srcPx: Uint8ClampedArray, srcW: number, srcH: number,
  focal: FocalBox,
  tgtPx: Uint8ClampedArray, tgtW: number, tgtH: number,
  patchCount: number,
  reconAspect: number,
): { matches: Match[]; blobCols: number; blobRows: number } {
  const { positions, blobCols, blobRows } = growBlob(patchCount, reconAspect);

  // Pre-sample painting candidates confined to focal region
  type Candidate = { nx: number; ny: number; r: number; g: number; b: number };
  const candidates: Candidate[] = [];
  const fgW = (focal.nx1 - focal.nx0) / FOCAL_GRID;
  const fgH = (focal.ny1 - focal.ny0) / FOCAL_GRID;

  for (let gy = 0; gy < FOCAL_GRID; gy++) {
    for (let gx = 0; gx < FOCAL_GRID; gx++) {
      const nx0 = focal.nx0 + gx * fgW;
      const ny0 = focal.ny0 + gy * fgH;
      const [r, g, b] = avgRgb(
        srcPx, srcW, srcH,
        nx0 * srcW, ny0 * srcH,
        (nx0 + fgW) * srcW, (ny0 + fgH) * srcH,
      );
      candidates.push({ nx: nx0 + fgW / 2, ny: ny0 + fgH / 2, r, g, b });
    }
  }

  const MAX_DIST_SQ = 3 * 255 * 255;
  const matches: Match[] = [];

  for (let pi = 0; pi < positions.length; pi++) {
    const pos = positions[pi];
    const px0 = pos.nx * tgtW - 8, py0 = pos.ny * tgtH - 8;
    const [tr, tg, tb] = avgRgb(tgtPx, tgtW, tgtH, px0, py0, px0 + 16, py0 + 16);

    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const dr = c.r - tr, dg = c.g - tg, db = c.b - tb;
      const jitter = n01(i + pos.nx * 7.3, i * 0.13 + pos.ny * 5.1) * MAX_DIST_SQ * 0.04;
      const dist = dr * dr + dg * dg + db * db + jitter;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    matches.push({
      srcNx: candidates[bestIdx].nx,
      srcNy: candidates[bestIdx].ny,
      tgtNx: pos.nx,
      tgtNy: pos.ny,
    });
  }

  return { matches, blobCols, blobRows };
}

// ── Main draw routine ─────────────────────────────────────────────────────────

function drawThreadArt(
  ctx:        CanvasRenderingContext2D,
  pd:         PaintData,
  userCanvas: HTMLCanvasElement | null,
  patchCount: number,
) {
  // --- Detect focal (iconic) region ------------------------------------------
  const focal       = detectSalientRegion(pd.pixels, pd.w, pd.h);
  const focalW      = focal.nx1 - focal.nx0;
  const focalH      = focal.ny1 - focal.ny0;
  const focalAspect = focalH / focalW;

  // --- Layout ----------------------------------------------------------------
  const paintAspect = pd.srcImg.height / pd.srcImg.width;
  const sourceH     = Math.min(SOURCE_MAX_H, CANVAS_W * paintAspect);
  const reconW      = Math.round(CANVAS_W * RECON_FRAC);
  const reconH      = Math.round(reconW * focalAspect);
  const reconX      = Math.round((CANVAS_W - reconW) / 2);
  const reconY      = TOP_PAD;
  const sourceY     = reconY + reconH + THREAD_GAP;
  const canvasH     = sourceY + sourceH + BOTTOM_PAD;

  ctx.canvas.width  = CANVAS_W;
  ctx.canvas.height = canvasH;

  // --- Background ------------------------------------------------------------
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  // --- Source painting (center-crop to fill 900 × sourceH) -------------------
  const img   = pd.srcImg;
  const scale = Math.max(CANVAS_W / img.width, sourceH / img.height);
  const visW  = CANVAS_W / scale;
  const visH  = sourceH  / scale;
  const cropX = (img.width  - visW) / 2;
  const cropY = (img.height - visH) / 2;
  ctx.drawImage(img, cropX, cropY, visW, visH, 0, sourceY, CANVAS_W, sourceH);

  // Transform to map normalized painting coords → screen, correcting for crop
  const xf: PaintXform = {
    visNx0:  cropX / img.width,
    visNy0:  cropY / img.height,
    visNW:   visW  / img.width,
    visNH:   visH  / img.height,
    screenY: sourceY,
    screenH: sourceH,
  };

  // Dashed box on the painting showing the detected focal region
  {
    const [fx0, fy0] = paintToScreen(xf, focal.nx0, focal.ny0);
    const [fx1, fy1] = paintToScreen(xf, focal.nx1, focal.ny1);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // --- Placeholder when no photo uploaded ------------------------------------
  if (!userCanvas) {
    ctx.strokeStyle = "rgba(160,140,120,0.35)";
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(reconX + 0.5, reconY + 0.5, reconW, reconH);
    ctx.setLineDash([]);
    ctx.fillStyle    = "#b0a494";
    ctx.font         = "italic 12px serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Upload a photo", reconX + reconW / 2, reconY + reconH / 2);
    return;
  }

  // --- Compute blob matches --------------------------------------------------
  const tgtCtx = userCanvas.getContext("2d")!;
  const tgtPx  = tgtCtx.getImageData(0, 0, userCanvas.width, userCanvas.height).data;

  const { matches: rawMatches, blobCols, blobRows } = computeBlobMatches(
    pd.pixels, pd.w, pd.h,
    focal,
    tgtPx, userCanvas.width, userCanvas.height,
    patchCount,
    reconH / reconW,
  );

  // Patch display radius: large enough that 4-connected grid neighbors always overlap
  const gridStepX  = reconW / blobCols;
  const gridStepY  = reconH / blobRows;
  const patchDispR = Math.max(4, Math.max(gridStepX, gridStepY) * 0.65);

  // Source patch radius: how many srcCanvas pixels to copy per patch
  const patchSrcR = Math.max(8, patchDispR * pd.w * focalW / reconW);

  // --- Prune to largest connected component ----------------------------------
  const matches = pruneToLargestComponent(rawMatches, reconW, reconH, patchDispR);

  // Pre-compute canvas coordinates for each match
  type PtCoord = { sx: number; sy: number; rx: number; ry: number };
  const ptCoords: PtCoord[] = matches.map((m) => {
    const [sx, sy] = paintToScreen(xf, m.srcNx, m.srcNy);
    return {
      sx,
      sy,
      rx: reconX + m.tgtNx * reconW,
      ry: reconY + m.tgtNy * reconH,
    };
  });

  // --- 1. Threads (behind everything) ----------------------------------------
  ctx.save();
  ctx.strokeStyle = "rgba(110,100,90,0.36)";
  ctx.lineWidth   = 0.9;
  for (const p of ptCoords) {
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy);
    ctx.lineTo(p.rx, p.ry);
    ctx.stroke();
  }
  ctx.restore();

  // --- 2. Circular patches in the reconstruction (middle layer) ---------------
  for (let i = 0; i < matches.length; i++) {
    const m  = matches[i];
    const p  = ptCoords[i];
    const sx = m.srcNx * pd.w;
    const sy = m.srcNy * pd.h;

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.rx, p.ry, patchDispR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      pd.srcCanvas,
      sx - patchSrcR, sy - patchSrcR, patchSrcR * 2, patchSrcR * 2,
      p.rx - patchDispR, p.ry - patchDispR, patchDispR * 2, patchDispR * 2,
    );
    ctx.restore();
  }

  // --- 3. White sample dots on the source painting (top layer) ----------------
  ctx.save();
  for (const p of ptCoords) {
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle   = "rgba(255,255,255,0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth   = 0.7;
    ctx.stroke();
  }
  ctx.restore();
}

// ── React component ───────────────────────────────────────────────────────────

type Props = {
  sourceImage: HTMLImageElement | null;
  settings:    RenderSettings;
};

export default function CanvasRenderer({ sourceImage, settings }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const userCacheRef = useRef<{ src: HTMLImageElement; canvas: HTMLCanvasElement } | null>(null);

  const [pd,         setPd]         = useState<PaintData | null>(null);
  const [statusLine, setStatusLine] = useState("Choose a painting above to begin");
  const [isLoading,  setIsLoading]  = useState(false);

  useEffect(() => {
    const meta = MOSAIC_PAINTINGS.find((p) => p.id === settings.targetPainting);
    if (!meta) { setStatusLine("Unknown painting"); return; }

    let cancelled = false;
    setIsLoading(true);
    setStatusLine(`Loading ${meta.title}…`);
    setPd(null);

    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const oc   = makeOffscreen(img, MAX_PX);
      const octx = oc.getContext("2d")!;
      const id   = octx.getImageData(0, 0, oc.width, oc.height);
      setPd({
        pixels:    new Uint8ClampedArray(id.data),
        w:         oc.width,
        h:         oc.height,
        srcCanvas: oc,
        srcImg:    img,
      });
      setStatusLine(`${meta.title} — ${meta.artist}`);
      setIsLoading(false);
    };
    img.onerror = () => {
      if (!cancelled) { setStatusLine(`Failed to load "${meta.title}"`); setIsLoading(false); }
    };
    img.src = `/api/met-painting?id=${meta.metId}&q=${encodeURIComponent(meta.query)}`;
    return () => { cancelled = true; };
  }, [settings.targetPainting]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!pd) {
      canvas.width  = CANVAS_W;
      canvas.height = 600;
      ctx.fillStyle = "#f5f2ee";
      ctx.fillRect(0, 0, CANVAS_W, 600);
      ctx.fillStyle    = "#a89888";
      ctx.font         = "italic 15px serif";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        isLoading ? "Loading painting…" : "Choose a painting to begin",
        CANVAS_W / 2, 300,
      );
      return;
    }

    if (sourceImage) {
      if (userCacheRef.current?.src !== sourceImage) {
        userCacheRef.current = { src: sourceImage, canvas: makeOffscreen(sourceImage, MAX_PX) };
      }
    } else {
      userCacheRef.current = null;
    }

    drawThreadArt(ctx, pd, userCacheRef.current?.canvas ?? null, settings.patchCount);
  }, [sourceImage, pd, settings.patchCount, isLoading]);

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href     = canvas.toDataURL("image/png");
    a.download = "hidden-in-art.png";
    a.click();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas ref={canvasRef} className="max-w-full rounded shadow-md" />
      <div className="flex w-full max-w-[900px] items-center justify-between px-1">
        <p className="text-xs italic text-neutral-400">{statusLine}</p>
        <button
          onClick={handleExport}
          disabled={!pd}
          className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
        >
          Export PNG
        </button>
      </div>
    </div>
  );
}
