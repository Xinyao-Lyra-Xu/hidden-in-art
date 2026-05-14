"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtworkMetadata } from "@/types/art";

// ── Layout constants ──────────────────────────────────────────────────────────
const CANVAS_W    = 900;
const TOP_PAD     = 52;
const RECON_FRAC  = 0.55;   // reconstruction width ~495 px
const THREAD_GAP  = 80;
const USER_MAX_H  = 480;
const BOTTOM_PAD  = 28;
const MAX_PX      = 900;
const FOCAL_SCAN  = 20;     // 20×20 saliency scan
const FOCAL_FRAC  = 0.30;   // focal crop: 30% of painting dimension per axis (~9% area)
const COLOR_GRID  = 64;     // 64×64 = 4096 color candidates from user photo
const MAX_THREADS = 120;    // max connecting lines drawn
const DOT_R_USER  = 2;      // radius of sampling markers on user photo

// ── Types ─────────────────────────────────────────────────────────────────────
type PaintData = {
  pixels: Uint8ClampedArray;
  w:      number;
  h:      number;
};

type FocalBox = { nx0: number; ny0: number; nx1: number; ny1: number };

type ColorCandidate = { nx: number; ny: number; r: number; g: number; b: number };

type GridMatch = {
  focalNx: number; focalNy: number;
  userNx:  number; userNy:  number;
  r: number; g: number; b: number;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

// Fast integer hash — replaces Math.sin-based jitter in the hot inner loop
function fastRand(a: number, b: number): number {
  let x = ((a * 12347 + b * 17911) ^ (a << 5)) >>> 0;
  x ^= x >>> 16;
  x = (x * 0x45d9f3b) >>> 0;
  x ^= x >>> 16;
  return x / 0xffffffff;
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
  const sx = Math.max(1, Math.ceil((rx - lx + 1) / 6));
  const sy = Math.max(1, Math.ceil((ry - ly + 1) / 6));
  for (let qy = ly; qy <= ry; qy += sy)
    for (let qx = lx; qx <= rx; qx += sx) {
      const i = (qy * w + qx) * 4;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
  return n > 0 ? [r / n, g / n, b / n] : [128, 128, 128];
}

// ── Saliency detection ────────────────────────────────────────────────────────
// Finds the most visually rich region; adds gentle center-bias so face/subject
// regions score higher than equally-varied corners/backgrounds.

function detectSalientRegion(px: Uint8ClampedArray, w: number, h: number): FocalBox {
  const cw = w / FOCAL_SCAN;
  const ch = h / FOCAL_SCAN;
  let bestScore = -1, bestGx = FOCAL_SCAN >> 1, bestGy = FOCAL_SCAN >> 1;

  for (let gy = 1; gy < FOCAL_SCAN - 1; gy++) {
    for (let gx = 1; gx < FOCAL_SCAN - 1; gx++) {
      const x0 = gx * cw, y0 = gy * ch;
      const stepX = Math.max(1, Math.floor(cw / 6));
      const stepY = Math.max(1, Math.floor(ch / 6));
      let mr = 0, mg = 0, mb = 0, cnt = 0;
      for (let qy = Math.floor(y0); qy < Math.floor(y0 + ch); qy += stepY)
        for (let qx = Math.floor(x0); qx < Math.floor(x0 + cw); qx += stepX) {
          const i = (Math.min(h - 1, qy) * w + Math.min(w - 1, qx)) * 4;
          mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; cnt++;
        }
      if (cnt < 2) continue;
      mr /= cnt; mg /= cnt; mb /= cnt;
      let v = 0;
      for (let qy = Math.floor(y0); qy < Math.floor(y0 + ch); qy += stepY)
        for (let qx = Math.floor(x0); qx < Math.floor(x0 + cw); qx += stepX) {
          const i = (Math.min(h - 1, qy) * w + Math.min(w - 1, qx)) * 4;
          const dr = px[i] - mr, dg = px[i + 1] - mg, db = px[i + 2] - mb;
          v += dr * dr + dg * dg + db * db;
        }
      // Gentle center bias: cells near center of painting score slightly higher
      const ncx = (gx + 0.5) / FOCAL_SCAN - 0.5;
      const ncy = (gy + 0.5) / FOCAL_SCAN - 0.5;
      const centerBonus = (1 - Math.sqrt(ncx * ncx + ncy * ncy) / 0.7) * v * 0.15;
      const score = v + centerBonus;
      if (score > bestScore) { bestScore = score; bestGx = gx; bestGy = gy; }
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

// ── Color index ───────────────────────────────────────────────────────────────
function buildColorIndex(
  px: Uint8ClampedArray,
  w: number,
  h: number,
): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  for (let gy = 0; gy < COLOR_GRID; gy++)
    for (let gx = 0; gx < COLOR_GRID; gx++) {
      const nx  = (gx + 0.5) / COLOR_GRID;
      const ny  = (gy + 0.5) / COLOR_GRID;
      const ipx = Math.min(w - 1, Math.round(nx * w));
      const ipy = Math.min(h - 1, Math.round(ny * h));
      const i   = (ipy * w + ipx) * 4;
      out.push({ nx, ny, r: px[i], g: px[i + 1], b: px[i + 2] });
    }
  return out;
}

// ── Grid matching ─────────────────────────────────────────────────────────────
function computeGridMatches(
  paintPx: Uint8ClampedArray,
  paintW:  number,
  paintH:  number,
  focal:   FocalBox,
  candidates: ColorCandidate[],
  patchCount: number,
): { matches: GridMatch[]; cols: number; rows: number } {
  const focalW  = focal.nx1 - focal.nx0;
  const focalH  = focal.ny1 - focal.ny0;
  const aspect  = focalH / focalW;
  const cols    = Math.max(4, Math.round(Math.sqrt(patchCount / aspect)));
  const rows    = Math.max(4, Math.round(patchCount / cols));
  const MAX_DSQ = 3 * 255 * 255;
  const matches: GridMatch[] = [];

  const cellW = focalW * paintW / cols;
  const cellH = focalH * paintH / rows;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const fnx = (gx + 0.5) / cols;
      const fny = (gy + 0.5) / rows;

      const pnx = focal.nx0 + fnx * focalW;
      const pny = focal.ny0 + fny * focalH;
      const px0 = pnx * paintW - cellW / 2;
      const py0 = pny * paintH - cellH / 2;
      const [tr, tg, tb] = avgRgb(paintPx, paintW, paintH, px0, py0, px0 + cellW, py0 + cellH);

      let bestIdx = 0, bestDist = Infinity;
      for (let ci = 0; ci < candidates.length; ci++) {
        const c  = candidates[ci];
        const dr = c.r - tr, dg = c.g - tg, db = c.b - tb;
        // Small jitter breaks ties; use fast integer hash (no Math.sin)
        const jitter = fastRand(gx * 31 + gy, ci) * MAX_DSQ * 0.018;
        const d = dr * dr + dg * dg + db * db + jitter;
        if (d < bestDist) { bestDist = d; bestIdx = ci; }
      }

      const best = candidates[bestIdx];
      matches.push({
        focalNx: fnx, focalNy: fny,
        userNx:  best.nx, userNy: best.ny,
        r: best.r, g: best.g, b: best.b,
      });
    }
  }

  return { matches, cols, rows };
}

// ── Main draw routine ─────────────────────────────────────────────────────────
function drawThreadArt(
  ctx:        CanvasRenderingContext2D,
  dpr:        number,
  pd:         PaintData,
  userCanvas: HTMLCanvasElement,
  patchCount: number,
) {
  const focal  = detectSalientRegion(pd.pixels, pd.w, pd.h);
  const focalW = focal.nx1 - focal.nx0;
  const focalH = focal.ny1 - focal.ny0;

  // --- Layout (logical pixels) ------------------------------------------------
  const reconW = Math.round(CANVAS_W * RECON_FRAC);
  const reconH = Math.round(reconW * focalH / focalW);
  const reconX = Math.round((CANVAS_W - reconW) / 2);
  const reconY = TOP_PAD;

  const uAspect = userCanvas.height / userCanvas.width;
  const userH   = Math.min(USER_MAX_H, Math.round(CANVAS_W * uAspect));
  const userY   = reconY + reconH + THREAD_GAP;
  const canvasH = userY + userH + BOTTOM_PAD;

  // Retina: physical canvas = logical × dpr; CSS size = logical px
  ctx.canvas.width        = CANVAS_W * dpr;
  ctx.canvas.height       = canvasH  * dpr;
  ctx.canvas.style.width  = `${CANVAS_W}px`;
  ctx.canvas.style.height = `${canvasH}px`;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  // --- User photo (bottom, center-cropped to fill CANVAS_W × userH) ----------
  const uScale = Math.max(CANVAS_W / userCanvas.width, userH / userCanvas.height);
  const uVisW  = CANVAS_W / uScale;
  const uVisH  = userH    / uScale;
  const uCropX = (userCanvas.width  - uVisW) / 2;
  const uCropY = (userCanvas.height - uVisH) / 2;
  ctx.drawImage(userCanvas, uCropX, uCropY, uVisW, uVisH, 0, userY, CANVAS_W, userH);

  // --- Build color index -------------------------------------------------------
  const uCtx = userCanvas.getContext("2d")!;
  const uPx  = uCtx.getImageData(0, 0, userCanvas.width, userCanvas.height).data;
  const candidates = buildColorIndex(uPx, userCanvas.width, userCanvas.height);

  // --- Compute grid matches ----------------------------------------------------
  const { matches, cols, rows } = computeGridMatches(
    pd.pixels, pd.w, pd.h, focal, candidates, patchCount,
  );

  // Dot radius: 56% of cell half-size → adjacent dots overlap ~12%, no white gaps
  const cellDispW  = reconW / cols;
  const cellDispH  = reconH / rows;
  const patchDispR = Math.max(1.0, Math.min(cellDispW, cellDispH) * 0.56);

  // Map normalized user-photo coords → screen position in bottom photo area
  const toScreen = (nx: number, ny: number): [number, number] => [
    ((nx * userCanvas.width  - uCropX) / uVisW) * CANVAS_W,
    userY + ((ny * userCanvas.height - uCropY) / uVisH) * userH,
  ];

  const inUserArea = (ux: number, uy: number) =>
    ux >= 0 && ux <= CANVAS_W && uy >= userY && uy <= userY + userH;

  type Pt = { rx: number; ry: number; ux: number; uy: number };
  const pts: Pt[] = matches.map((m) => {
    const [ux, uy] = toScreen(m.userNx, m.userNy);
    return { rx: reconX + m.focalNx * reconW, ry: reconY + m.focalNy * reconH, ux, uy };
  });

  // --- Thread subset: evenly spaced, capped at MAX_THREADS --------------------
  const validPts  = pts.filter((p) => inUserArea(p.ux, p.uy));
  const threadStep = Math.max(1, Math.floor(validPts.length / MAX_THREADS));
  const threadPts  = validPts.filter((_, i) => i % threadStep === 0).slice(0, MAX_THREADS);

  // --- 1. Threads (behind everything) ----------------------------------------
  ctx.save();
  ctx.strokeStyle = "rgba(110,100,90,0.28)";
  ctx.lineWidth   = 0.65;
  for (const p of threadPts) {
    ctx.beginPath();
    ctx.moveTo(p.ux, p.uy);
    ctx.lineTo(p.rx, p.ry);
    ctx.stroke();
  }
  ctx.restore();

  // --- 2. Circular patches in reconstruction (user photo fragments) -----------
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const p = pts[i];
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.rx, p.ry, patchDispR, 0, Math.PI * 2);
    ctx.clip();
    // Source radius in user-canvas pixels; 1:1 mapping shows real photo texture
    const srcR = Math.max(1.5, patchDispR);
    ctx.drawImage(
      userCanvas,
      m.userNx * userCanvas.width  - srcR,
      m.userNy * userCanvas.height - srcR,
      srcR * 2, srcR * 2,
      p.rx - patchDispR, p.ry - patchDispR,
      patchDispR * 2, patchDispR * 2,
    );
    ctx.restore();
  }

  // --- 3. Small sampling markers on user photo (only for thread endpoints) ---
  ctx.save();
  for (const p of threadPts) {
    ctx.beginPath();
    ctx.arc(p.ux, p.uy, DOT_R_USER, 0, Math.PI * 2);
    ctx.fillStyle   = "rgba(255,255,255,0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.20)";
    ctx.lineWidth   = 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

// ── React component ───────────────────────────────────────────────────────────

type Props = {
  sourceImage: HTMLImageElement | null;
  artwork:     ArtworkMetadata | null;
  patchCount:  number;
};

export default function CanvasRenderer({ sourceImage, artwork, patchCount }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const userCacheRef = useRef<{ src: HTMLImageElement; canvas: HTMLCanvasElement } | null>(null);

  const [pd,         setPd]         = useState<PaintData | null>(null);
  const [statusLine, setStatusLine] = useState("Choose a painting to begin");
  const [isLoading,  setIsLoading]  = useState(false);

  useEffect(() => {
    if (!artwork) { setPd(null); setStatusLine("Choose a painting to begin"); return; }

    let cancelled = false;
    setIsLoading(true);
    setStatusLine(`Loading ${artwork.title}…`);
    setPd(null);

    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const oc   = makeOffscreen(img, MAX_PX);
      const octx = oc.getContext("2d")!;
      const id   = octx.getImageData(0, 0, oc.width, oc.height);
      setPd({ pixels: new Uint8ClampedArray(id.data), w: oc.width, h: oc.height });
      setStatusLine(`${artwork.title} — ${artwork.artist}`);
      setIsLoading(false);
    };
    img.onerror = () => {
      if (!cancelled) { setStatusLine(`Failed to load "${artwork.title}"`); setIsLoading(false); }
    };
    const q = artwork.query ?? `${artwork.title} ${artwork.artist}`;
    img.src = `/api/met-painting?id=${artwork.metId ?? 0}&q=${encodeURIComponent(q)}`;
    return () => { cancelled = true; };
  }, [artwork]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    if (!pd) {
      canvas.width        = CANVAS_W * dpr;
      canvas.height       = 600      * dpr;
      canvas.style.width  = `${CANVAS_W}px`;
      canvas.style.height = "600px";
      ctx.scale(dpr, dpr);
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
      if (userCacheRef.current?.src !== sourceImage)
        userCacheRef.current = { src: sourceImage, canvas: makeOffscreen(sourceImage, MAX_PX) };
    } else {
      userCacheRef.current = null;
    }

    if (!userCacheRef.current) {
      const reconW = Math.round(CANVAS_W * RECON_FRAC);
      const reconH = Math.round(reconW * 0.75);
      const reconX = Math.round((CANVAS_W - reconW) / 2);
      const reconY = TOP_PAD;
      const h = reconY + reconH + THREAD_GAP + 180 + BOTTOM_PAD;
      canvas.width        = CANVAS_W * dpr;
      canvas.height       = h        * dpr;
      canvas.style.width  = `${CANVAS_W}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, h);
      ctx.strokeStyle = "rgba(160,140,120,0.35)";
      ctx.setLineDash([4, 5]);
      ctx.strokeRect(reconX + 0.5, reconY + 0.5, reconW, reconH);
      ctx.setLineDash([]);
      ctx.fillStyle    = "#b0a494";
      ctx.font         = "italic 12px serif";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Upload a photo to see the reconstruction", reconX + reconW / 2, reconY + reconH / 2);
      return;
    }

    drawThreadArt(ctx, dpr, pd, userCacheRef.current.canvas, patchCount);
  }, [sourceImage, pd, patchCount, isLoading]);

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
