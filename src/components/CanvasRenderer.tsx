"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Columns2, Download, Image as ImageIcon, RotateCcw } from "lucide-react";
import type { ArtworkMetadata } from "@/domain/artwork/types";
import { getArtworkImageUrl } from "@/lib/artworkUrl";

// ── Layout constants ──────────────────────────────────────────────────────────
const CANVAS_W    = 900;
const TOP_PAD     = 52;
const RECON_FRAC  = 0.55;
const THREAD_GAP  = 36;
const USER_MAX_H  = 300;
const BOTTOM_PAD  = 28;
const MAX_PX      = 900;
const FOCAL_SCAN  = 20;
const FOCAL_FRAC  = 0.30;
const COLOR_GRID  = 64;
const MAX_THREADS = 120;
const DOT_R_USER  = 2;

// Reveal-animation timing (ms)
const PHASE1_HOLD = 700;
const PHASE_FADE  = 900;

// Magnifier
const LENS_DIAM = 140;
const LENS_R    = LENS_DIAM / 2;
const ZOOM      = 5;

// ── Types ─────────────────────────────────────────────────────────────────────
type PaintData = { pixels: Uint8ClampedArray; w: number; h: number };

type FocalBox = { nx0: number; ny0: number; nx1: number; ny1: number };

type ColorCandidate = { nx: number; ny: number; r: number; g: number; b: number };

type GridMatch = {
  focalNx: number; focalNy: number;
  userNx:  number; userNy:  number;
  r: number; g: number; b: number;
};

type ReconLayout = { reconX: number; reconY: number; reconW: number; reconH: number };

type PhasesData = {
  p1: HTMLCanvasElement;
  p3: HTMLCanvasElement;
  matches: GridMatch[];
  userCanvas: HTMLCanvasElement;
  patchR: number;
};

type ClickedMatchInfo = { match: GridMatch; cssX: number; cssY: number };

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

function findClosestMatch(matches: GridMatch[], fnx: number, fny: number): GridMatch | null {
  if (matches.length === 0) return null;
  let best = matches[0];
  let bestD = (best.focalNx - fnx) ** 2 + (best.focalNy - fny) ** 2;
  for (const m of matches) {
    const d = (m.focalNx - fnx) ** 2 + (m.focalNy - fny) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// ── Saliency detection ────────────────────────────────────────────────────────

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
      const ncx = (gx + 0.5) / FOCAL_SCAN - 0.5;
      const ncy = (gy + 0.5) / FOCAL_SCAN - 0.5;
      const centerBonus = (1 - Math.sqrt(ncx * ncx + ncy * ncy) / 0.7) * v * 0.15;
      if (v + centerBonus > bestScore) { bestScore = v + centerBonus; bestGx = gx; bestGy = gy; }
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

function buildColorIndex(px: Uint8ClampedArray, w: number, h: number): ColorCandidate[] {
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
  const cellW   = focalW * paintW / cols;
  const cellH   = focalH * paintH / rows;

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
        const jitter = fastRand(gx * 31 + gy, ci) * MAX_DSQ * 0.018;
        const d = dr * dr + dg * dg + db * db + jitter;
        if (d < bestDist) { bestDist = d; bestIdx = ci; }
      }
      const best = candidates[bestIdx];
      matches.push({
        focalNx: fnx, focalNy: fny,
        userNx: best.nx, userNy: best.ny,
        r: best.r, g: best.g, b: best.b,
      });
    }
  }
  return { matches, cols, rows };
}

// ── Phase pre-rendering ───────────────────────────────────────────────────────

function makePhase1(pd: PaintData, focal: FocalBox, rW: number, rH: number): HTMLCanvasElement {
  const paintC = document.createElement("canvas");
  paintC.width = pd.w; paintC.height = pd.h;
  paintC.getContext("2d")!
    .putImageData(new ImageData(new Uint8ClampedArray(pd.pixels), pd.w), 0, 0);

  const c = document.createElement("canvas");
  c.width = rW; c.height = rH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, rW, rH);
  ctx.drawImage(
    paintC,
    focal.nx0 * pd.w,
    focal.ny0 * pd.h,
    (focal.nx1 - focal.nx0) * pd.w,
    (focal.ny1 - focal.ny0) * pd.h,
    0, 0, rW, rH,
  );
  return c;
}

function makePhase2(
  pd: PaintData,
  focal: FocalBox,
  cols: number, rows: number,
  rW: number, rH: number,
  patchR: number,
): HTMLCanvasElement {
  const focalW = focal.nx1 - focal.nx0;
  const focalH = focal.ny1 - focal.ny0;
  const cellW  = focalW * pd.w / cols;
  const cellH  = focalH * pd.h / rows;

  const c = document.createElement("canvas");
  c.width = rW; c.height = rH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, rW, rH);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const fnx = (gx + 0.5) / cols;
      const fny = (gy + 0.5) / rows;
      const pnx = focal.nx0 + fnx * focalW;
      const pny = focal.ny0 + fny * focalH;
      const px0 = pnx * pd.w - cellW / 2;
      const py0 = pny * pd.h - cellH / 2;
      const [r, g, b] = avgRgb(pd.pixels, pd.w, pd.h, px0, py0, px0 + cellW, py0 + cellH);
      ctx.beginPath();
      ctx.arc(fnx * rW, fny * rH, patchR, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fill();
    }
  }
  return c;
}

function makePhase3(
  matches:    GridMatch[],
  userCanvas: HTMLCanvasElement,
  rW: number, rH: number,
  patchR: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = rW; c.height = rH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, rW, rH);

  for (const m of matches) {
    const cx = m.focalNx * rW;
    const cy = m.focalNy * rH;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, patchR, 0, Math.PI * 2);
    ctx.clip();
    const srcR = Math.max(1.5, patchR);
    ctx.drawImage(
      userCanvas,
      m.userNx * userCanvas.width  - srcR,
      m.userNy * userCanvas.height - srcR,
      srcR * 2, srcR * 2,
      cx - patchR, cy - patchR,
      patchR * 2, patchR * 2,
    );
    ctx.restore();
  }
  return c;
}

// ── Painting locator ──────────────────────────────────────────────────────────

function regionLabel(f: FocalBox): string {
  const cx = (f.nx0 + f.nx1) / 2;
  const cy = (f.ny0 + f.ny1) / 2;
  const h  = cx < 0.33 ? "left"  : cx > 0.67 ? "right"  : "";
  const v  = cy < 0.33 ? "top"   : cy > 0.67 ? "bottom" : "";
  if (v && h) return `${v}-${h}`;
  return v || h || "center";
}

function PaintingLocator({
  focal,
  artwork,
  hoverNorm,
}: {
  focal:     FocalBox;
  artwork:   ArtworkMetadata;
  hoverNorm: { nx: number; ny: number } | null;
}) {
  const src = getArtworkImageUrl(artwork);

  const hx = hoverNorm !== null
    ? focal.nx0 + hoverNorm.nx * (focal.nx1 - focal.nx0)
    : null;
  const hy = hoverNorm !== null
    ? focal.ny0 + hoverNorm.ny * (focal.ny1 - focal.ny0)
    : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative inline-block w-[140px] overflow-hidden rounded border border-neutral-200 shadow-sm sm:w-[176px]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={artwork.title}
          width={176}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full rounded"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <rect
            x={focal.nx0}
            y={focal.ny0}
            width={focal.nx1 - focal.nx0}
            height={focal.ny1 - focal.ny0}
            fill="rgba(220,38,38,0.12)"
            stroke="rgba(220,38,38,0.85)"
            strokeWidth={0.007}
          />
          {hx !== null && hy !== null && (
            <circle cx={hx} cy={hy} r={0.018} fill="rgba(220,38,38,0.85)" />
          )}
        </svg>
      </div>
      <p className="museum-caption max-w-[200px] text-center text-[11px] text-neutral-500">
        Reconstructing:{" "}
        <span className="font-semibold text-neutral-700">{regionLabel(focal)}</span>{" "}
        region of <em>&ldquo;{artwork.title}&rdquo;</em>
        {artwork.artist ? ` by ${artwork.artist}` : ""}
      </p>
    </div>
  );
}

function drawSharePanel(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(23,23,23,0.14)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const imageY = y + 48;
  const imageH = h - 48;
  const scale = Math.max(w / source.width, imageH / source.height);
  const sw = w / scale;
  const sh = imageH / scale;
  const sx = (source.width - sw) / 2;
  const sy = (source.height - sh) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, x, imageY, w, imageH);

  ctx.fillStyle = "#171717";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 22, y + 25);
  ctx.restore();
}

function fitCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  fontSize: number,
) {
  let size = fontSize;
  while (size > 18 && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `${size}px Georgia, serif`;
  }
  ctx.fillText(text, x, y);
}

// ── Hover magnifier ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HoverMagnifier({
  match,
  userCanvas,
  cssX,
  cssY,
}: {
  match:      GridMatch;
  userCanvas: HTMLCanvasElement;
  cssX:       number;
  cssY:       number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const srcR = LENS_R / ZOOM;
    ctx.clearRect(0, 0, LENS_DIAM, LENS_DIAM);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LENS_R, LENS_R, LENS_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      userCanvas,
      match.userNx * userCanvas.width  - srcR,
      match.userNy * userCanvas.height - srcR,
      srcR * 2, srcR * 2,
      0, 0, LENS_DIAM, LENS_DIAM,
    );
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(LENS_R, LENS_R, LENS_R - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(220,38,38,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LENS_R - 7, LENS_R); ctx.lineTo(LENS_R + 7, LENS_R);
    ctx.moveTo(LENS_R, LENS_R - 7); ctx.lineTo(LENS_R, LENS_R + 7);
    ctx.stroke();
  }, [match, userCanvas]);

  return (
    <div
      className="pointer-events-none absolute z-10"
      style={{ left: cssX - LENS_R, top: cssY - LENS_R, width: LENS_DIAM, height: LENS_DIAM }}
    >
      <canvas
        ref={ref}
        width={LENS_DIAM}
        height={LENS_DIAM}
        className="rounded-full shadow-lg"
      />
    </div>
  );
}

// ── Patch popup ───────────────────────────────────────────────────────────────

function PatchPopup({
  match,
  userCanvas,
  cssX,
  cssY,
  onClose,
}: {
  match:      GridMatch;
  userCanvas: HTMLCanvasElement;
  cssX:       number;
  cssY:       number;
  onClose:    () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const PW  = 180;
  const PH  = Math.round(PW * (userCanvas.height / userCanvas.width));

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(userCanvas, 0, 0, PW, PH);
    const cx = match.userNx * PW;
    const cy = match.userNy * PH;
    ctx.strokeStyle = "rgba(220,38,38,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy); ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy + 15);
    ctx.stroke();
  }, [match, userCanvas, PW, PH]);

  const POP_W = PW + 16;
  const POP_H = PH + 44;
  let left = cssX - POP_W / 2;
  let top  = cssY - POP_H - 10;
  if (top < 0) top = cssY + 10;
  if (left < 0) left = 4;

  return (
    <div
      className="absolute z-20 rounded border border-neutral-200 bg-white p-2 shadow-lg"
      style={{ left, top, width: POP_W }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <p className="museum-label text-neutral-400">
          Source pixel
        </p>
        <button
          onClick={onClose}
          className="text-xs leading-none text-neutral-400 hover:text-neutral-600"
        >
          ✕
        </button>
      </div>
      <canvas ref={ref} width={PW} height={PH} className="w-full rounded" />
    </div>
  );
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
  const rafRef       = useRef<number>(0);
  const layoutRef    = useRef<ReconLayout | null>(null);
  const startAnimRef = useRef<() => void>(() => {});
  const drawCompareRef = useRef<(norm: number) => void>(() => {});
  const phasesRef    = useRef<PhasesData | null>(null);
  const sliderNormRef  = useRef(0.5);
  const isDraggingRef  = useRef(false);
  const compareModeRef = useRef(false);
  const longPressRef   = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  // Tracks the effective logical canvas width (= CANVAS_W on desktop, smaller on mobile).
  // Written by the draw effect, read by pointer-event handlers.
  const cwRef = useRef(CANVAS_W);

  const [pd,           setPd]          = useState<PaintData | null>(null);
  const [focal,        setFocal]       = useState<FocalBox | null>(null);
  const [hoverNorm,    setHoverNorm]   = useState<{ nx: number; ny: number } | null>(null);
  const [clickedMatch, setClickedMatch] = useState<ClickedMatchInfo | null>(null);
  const [compareMode,  setCompareMode] = useState(false);
  const [statusLine,   setStatusLine]  = useState("Choose a painting to begin");
  const [isLoading,    setIsLoading]   = useState(false);
  const [isMobile,     setIsMobile]    = useState(false);
  // Mirrors phasesRef so PatchPopup can read userCanvas during render without ref access.
  const [renderPhases, setRenderPhases] = useState<PhasesData | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // ── Load painting from Met API ──────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!artwork) { setPd(null); setStatusLine("Choose a painting to begin"); return; }

    let cancelled = false;
    setIsLoading(true);
    setStatusLine(`Loading ${artwork.title}…`);
    setPd(null);

    const img = new window.Image();
    const imageSrc = getArtworkImageUrl(artwork);
    if (/^https?:\/\//i.test(imageSrc)) img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      let oc: HTMLCanvasElement;
      let id: ImageData;
      try {
        oc = makeOffscreen(img, MAX_PX);
        const octx = oc.getContext("2d")!;
        id = octx.getImageData(0, 0, oc.width, oc.height);
      } catch {
        setPd(null);
        console.warn("Target image failed to load:", artwork.title);
        setStatusLine(`Could not reconstruct "${artwork.title}" because its image blocks canvas access.`);
        setIsLoading(false);
        return;
      }
      setPd({ pixels: new Uint8ClampedArray(id.data), w: oc.width, h: oc.height });
      console.log("Target image loaded:", artwork.title);
      setStatusLine(`${artwork.title} — ${artwork.artist}`);
      setIsLoading(false);
    };
    img.onerror = () => {
      if (!cancelled) {
        console.warn("Target image failed to load:", artwork.title);
        setStatusLine(`Failed to load "${artwork.title}"`);
        setIsLoading(false);
      }
    };
    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [artwork]);

  // ── Draw / animate ──────────────────────────────────────────────────────────
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

    // Reset interactive overlay state on any input change
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompareMode(false);
    compareModeRef.current = false;
    setClickedMatch(null);
    setHoverNorm(null);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    // On mobile the canvas CSS width is limited by max-w-full (≈ viewport width).
    // Render the logical coordinate space at that smaller width so the height
    // scales proportionally — prevents the 2.5× vertical-stretch distortion.
    const cw = isMobile ? Math.min(CANVAS_W, window.innerWidth - 32) : CANVAS_W;
    cwRef.current = cw;

    if (!pd) {
      setFocal(null);
      layoutRef.current = null;
      phasesRef.current = null;
      setRenderPhases(null);
      canvas.width        = cw   * dpr;
      canvas.height       = 600  * dpr;
      canvas.style.width  = `${cw}px`;
      canvas.style.height = "600px";
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#f5f2ee";
      ctx.fillRect(0, 0, cw, 600);
      ctx.fillStyle    = "#a89888";
      ctx.font         = "italic 15px serif";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        isLoading ? "Loading painting…" : "Choose a painting to begin",
        cw / 2, 300,
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
      setFocal(null);
      layoutRef.current = null;
      phasesRef.current = null;
      setRenderPhases(null);
      const reconW = Math.round(cw * RECON_FRAC);
      const reconH = Math.round(reconW * 0.75);
      const reconX = Math.round((cw - reconW) / 2);
      const reconY = TOP_PAD;
      const h = reconY + reconH + THREAD_GAP + 180 + BOTTOM_PAD;
      canvas.width        = cw * dpr;
      canvas.height       = h  * dpr;
      canvas.style.width  = `${cw}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, h);
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

    const userCanvas = userCacheRef.current.canvas;

    // ── Compute focal region + grid matches ──────────────────────────────────
    const computedFocal = detectSalientRegion(pd.pixels, pd.w, pd.h);
    setFocal(computedFocal);

    const focalW = computedFocal.nx1 - computedFocal.nx0;
    const focalH = computedFocal.ny1 - computedFocal.ny0;
    const reconW = Math.round(cw * RECON_FRAC);
    const reconH = Math.round(reconW * focalH / focalW);
    const reconX = Math.round((cw - reconW) / 2);
    const reconY = TOP_PAD;
    layoutRef.current = { reconX, reconY, reconW, reconH };

    const uCtx       = userCanvas.getContext("2d")!;
    const uPx        = uCtx.getImageData(0, 0, userCanvas.width, userCanvas.height).data;
    const candidates = buildColorIndex(uPx, userCanvas.width, userCanvas.height);
    const { matches, cols, rows } = computeGridMatches(
      pd.pixels, pd.w, pd.h, computedFocal, candidates, patchCount,
    );
    const cellDispW = reconW / cols;
    const cellDispH = reconH / rows;
    const patchR    = Math.max(1.0, Math.min(cellDispW, cellDispH) * 0.56);

    const uAspect = userCanvas.height / userCanvas.width;
    const userH   = Math.min(USER_MAX_H, Math.round(cw * uAspect));
    const userY   = reconY + reconH + THREAD_GAP;
    const canvasH = userY + userH + BOTTOM_PAD;

    const uScale = isMobile
      ? Math.min(cw / userCanvas.width, userH / userCanvas.height)
      : Math.max(cw / userCanvas.width, userH / userCanvas.height);
    const uVisW  = isMobile ? userCanvas.width : cw / uScale;
    const uVisH  = isMobile ? userCanvas.height : userH / uScale;
    const uDrawW = isMobile ? userCanvas.width * uScale : cw;
    const uDrawH = isMobile ? userCanvas.height * uScale : userH;
    const uDrawX = isMobile ? (cw - uDrawW) / 2 : 0;
    const uDrawY = isMobile ? userY + (userH - uDrawH) / 2 : userY;
    const uCropX = isMobile ? 0 : (userCanvas.width - uVisW) / 2;
    const uCropY = isMobile ? 0 : (userCanvas.height - uVisH) / 2;

    const toScreen = (nx: number, ny: number): [number, number] => [
      uDrawX + ((nx * userCanvas.width - uCropX) / uVisW) * uDrawW,
      uDrawY + ((ny * userCanvas.height - uCropY) / uVisH) * uDrawH,
    ];
    const inUserArea = (ux: number, uy: number) =>
      ux >= uDrawX && ux <= uDrawX + uDrawW && uy >= uDrawY && uy <= uDrawY + uDrawH;

    const pts = matches.map((m) => {
      const [ux, uy] = toScreen(m.userNx, m.userNy);
      return { rx: reconX + m.focalNx * reconW, ry: reconY + m.focalNy * reconH, ux, uy };
    });
    const validPts   = pts.filter((p) => inUserArea(p.ux, p.uy));
    const threadStep = Math.max(1, Math.floor(validPts.length / MAX_THREADS));
    const threadPts  = validPts.filter((_, i) => i % threadStep === 0).slice(0, MAX_THREADS);

    const p1 = makePhase1(pd, computedFocal, reconW, reconH);
    const p2 = makePhase2(pd, computedFocal, cols, rows, reconW, reconH, patchR);
    const p3 = makePhase3(matches, userCanvas, reconW, reconH, patchR);

    // Store phases for overlay features; mirror to state so render can read without ref access.
    const newPhases = { p1, p3, matches, userCanvas, patchR };
    phasesRef.current = newPhases;
    setRenderPhases(newPhases);

    // ── Compare drawing (closed over ctx with DPR scale applied) ─────────────
    drawCompareRef.current = (norm: number) => {
      cancelAnimationFrame(rafRef.current);
      const splitX = Math.round(norm * reconW);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, canvasH);
      ctx.drawImage(userCanvas, uCropX, uCropY, uVisW, uVisH, uDrawX, uDrawY, uDrawW, uDrawH);

      // Left: painting crop
      ctx.save();
      ctx.beginPath();
      ctx.rect(reconX, reconY, splitX, reconH);
      ctx.clip();
      ctx.drawImage(p1, reconX, reconY, reconW, reconH);
      ctx.restore();

      // Right: user mosaic
      ctx.save();
      ctx.beginPath();
      ctx.rect(reconX + splitX, reconY, reconW - splitX, reconH);
      ctx.clip();
      ctx.drawImage(p3, reconX, reconY, reconW, reconH);
      ctx.restore();

      // Divider
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(reconX + splitX, reconY);
      ctx.lineTo(reconX + splitX, reconY + reconH);
      ctx.stroke();
      ctx.restore();

      // Handle circle
      const hx = reconX + splitX;
      const hy = reconY + reconH / 2;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(hx, hy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#555";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⇔", hx, hy + 0.5);
      ctx.restore();

      // Labels
      ctx.save();
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      if (splitX > 72) {
        ctx.fillStyle = "rgba(0,0,0,0.52)";
        ctx.fillRect(reconX + 6, reconY + 6, 68, 16);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText("ORIGINAL", reconX + 10, reconY + 14);
      }
      if (reconW - splitX > 90) {
        ctx.fillStyle = "rgba(0,0,0,0.52)";
        ctx.fillRect(reconX + reconW - 90, reconY + 6, 84, 16);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "right";
        ctx.fillText("YOUR PHOTO", reconX + reconW - 6, reconY + 14);
      }
      ctx.restore();
    };

    canvas.width        = cw      * dpr;
    canvas.height       = canvasH * dpr;
    canvas.style.width  = `${cw}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, canvasH);
    ctx.drawImage(userCanvas, uCropX, uCropY, uVisW, uVisH, uDrawX, uDrawY, uDrawW, uDrawH);
    ctx.drawImage(p1, reconX, reconY, reconW, reconH);

    // ── Animation starter ─────────────────────────────────────────────────────
    startAnimRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, canvasH);
      ctx.drawImage(userCanvas, uCropX, uCropY, uVisW, uVisH, uDrawX, uDrawY, uDrawW, uDrawH);

      const startMs = performance.now();

      const animate = (ts: number) => {
        const t = ts - startMs;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(reconX, reconY, reconW, reconH);

        if (t < PHASE1_HOLD) {
          ctx.drawImage(p1, reconX, reconY, reconW, reconH);
          rafRef.current = requestAnimationFrame(animate);

        } else if (t < PHASE1_HOLD + PHASE_FADE) {
          const alpha = (t - PHASE1_HOLD) / PHASE_FADE;
          ctx.drawImage(p1, reconX, reconY, reconW, reconH);
          ctx.globalAlpha = alpha;
          ctx.drawImage(p2, reconX, reconY, reconW, reconH);
          ctx.globalAlpha = 1;
          rafRef.current = requestAnimationFrame(animate);

        } else if (t < PHASE1_HOLD + PHASE_FADE * 2) {
          const alpha = (t - PHASE1_HOLD - PHASE_FADE) / PHASE_FADE;
          ctx.drawImage(p2, reconX, reconY, reconW, reconH);
          ctx.globalAlpha = alpha;
          ctx.drawImage(p3, reconX, reconY, reconW, reconH);
          ctx.globalAlpha = 1;
          rafRef.current = requestAnimationFrame(animate);

        } else {
          // Final: native-DPR draw for sharp Retina output
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(reconX, reconY, reconW, reconH);
          for (const m of matches) {
            const cx = reconX + m.focalNx * reconW;
            const cy = reconY + m.focalNy * reconH;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, patchR, 0, Math.PI * 2);
            ctx.clip();
            const srcR = Math.max(1.5, patchR);
            ctx.drawImage(
              userCanvas,
              m.userNx * userCanvas.width  - srcR,
              m.userNy * userCanvas.height - srcR,
              srcR * 2, srcR * 2,
              cx - patchR, cy - patchR,
              patchR * 2, patchR * 2,
            );
            ctx.restore();
          }
          if (!isMobile) {
            ctx.save();
            ctx.strokeStyle = "rgba(110,100,90,0.28)";
            ctx.lineWidth   = 0.65;
            for (const p of threadPts) {
              ctx.beginPath(); ctx.moveTo(p.ux, p.uy); ctx.lineTo(p.rx, p.ry); ctx.stroke();
            }
            ctx.restore();
            ctx.save();
            for (const p of threadPts) {
              ctx.beginPath();
              ctx.arc(p.ux, p.uy, DOT_R_USER, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();
              ctx.strokeStyle = "rgba(0,0,0,0.20)"; ctx.lineWidth = 0.6; ctx.stroke();
            }
            ctx.restore();
          }
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    };

    return () => {
      cancelAnimationFrame(rafRef.current);
      startAnimRef.current = () => {};
      drawCompareRef.current = () => {};
    };
  }, [sourceImage, pd, patchCount, isLoading, isMobile]);

  // ── IntersectionObserver: auto-play on scroll into view ──────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pd || !sourceImage) return;

    let fired = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !fired) {
          fired = true;
          observer.disconnect();
          startAnimRef.current();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [pd, sourceImage, patchCount]);

  // ── Mouse handlers ────────────────────────────────────────────────────────────
  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }, []);

  const openPatchAt = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const layout = layoutRef.current;
    const phases = phasesRef.current;
    if (!layout || !phases) return;

    const rect  = canvas.getBoundingClientRect();
    const scale = cwRef.current / rect.width;
    const mx    = (clientX - rect.left) * scale;
    const my    = (clientY - rect.top) * scale;
    const { reconX, reconY, reconW, reconH } = layout;

    if (mx >= reconX && mx <= reconX + reconW && my >= reconY && my <= reconY + reconH) {
      const fnx   = (mx - reconX) / reconW;
      const fny   = (my - reconY) / reconH;
      const match = findClosestMatch(phases.matches, fnx, fny);
      if (match) {
        setClickedMatch((prev) =>
          prev && prev.match === match
            ? null
            : { match, cssX: clientX - rect.left, cssY: clientY - rect.top },
        );
      }
    } else {
      setClickedMatch(null);
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "mouse") clearLongPress();
    const layout = layoutRef.current;
    if (!layout) { setHoverNorm(null); return; }

    const rect  = e.currentTarget.getBoundingClientRect();
    const scale = cwRef.current / rect.width;
    const mx    = (e.clientX - rect.left) * scale;
    const my    = (e.clientY - rect.top)  * scale;
    const { reconX, reconY, reconW, reconH } = layout;
    const inRecon = mx >= reconX && mx <= reconX + reconW && my >= reconY && my <= reconY + reconH;

    if (compareModeRef.current) {
      if (isDraggingRef.current) {
        const norm = Math.max(0, Math.min(1, (mx - reconX) / reconW));
        sliderNormRef.current = norm;
        drawCompareRef.current(norm);
      }
      return;
    }

    if (inRecon) {
      const fnx = (mx - reconX) / reconW;
      const fny = (my - reconY) / reconH;
      setHoverNorm({ nx: fnx, ny: fny });
    } else {
      setHoverNorm(null);
    }
  }, [clearLongPress]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const scale = cwRef.current / rect.width;
    const mx    = (e.clientX - rect.left) * scale;
    const my    = (e.clientY - rect.top)  * scale;
    const { reconX, reconY, reconW, reconH } = layout;
    if (mx >= reconX && mx <= reconX + reconW && my >= reconY && my <= reconY + reconH) {
      if (!compareModeRef.current && e.pointerType !== "mouse") {
        const canvas = e.currentTarget;
        const clientX = e.clientX;
        const clientY = e.clientY;
        suppressClickRef.current = true;
        longPressRef.current = window.setTimeout(() => openPatchAt(canvas, clientX, clientY), 500);
        return;
      }
      if (!compareModeRef.current) return;
      isDraggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [openPatchAt]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    clearLongPress();
    isDraggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, [clearLongPress]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (compareModeRef.current) return;
    openPatchAt(e.currentTarget, e.clientX, e.clientY);
  }, [openPatchAt]);

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href     = canvas.toDataURL("image/png");
    a.download = "hidden-in-art.png";
    a.click();
  }

  function handleShareExport() {
    const phases = phasesRef.current;
    if (!phases || !artwork) {
      handleExport();
      return;
    }

    const size = 1080;
    const share = document.createElement("canvas");
    share.width = size;
    share.height = size;
    const ctx = share.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#f8f5ee";
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#171717";
    ctx.font = "56px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Hidden in Art", size / 2, 104);

    ctx.fillStyle = "#6b6258";
    ctx.font = "22px Arial, sans-serif";
    ctx.fillText("Your photo, reconstructed through a famous painting", size / 2, 146);

    const gap = 28;
    const panelW = (size - 120 - gap) / 2;
    const panelH = 570;
    const y = 190;
    const leftX = 60;
    const rightX = leftX + panelW + gap;

    drawSharePanel(ctx, phases.p3, leftX, y, panelW, panelH, "YOUR RESULT");
    drawSharePanel(ctx, phases.p1, rightX, y, panelW, panelH, "ORIGINAL CROP");

    ctx.fillStyle = "#171717";
    ctx.font = "42px Georgia, serif";
    fitCenteredText(ctx, artwork.title, size / 2, 835, 900, 42);

    ctx.fillStyle = "#6b6258";
    ctx.font = "24px Arial, sans-serif";
    fitCenteredText(ctx, artwork.artist, size / 2, 876, 820, 24);

    ctx.strokeStyle = "rgba(23,23,23,0.16)";
    ctx.beginPath();
    ctx.moveTo(260, 924);
    ctx.lineTo(820, 924);
    ctx.stroke();

    ctx.fillStyle = "#171717";
    ctx.font = "26px Georgia, serif";
    ctx.fillText("hidden-in-art", size / 2, 982);

    const a = document.createElement("a");
    a.href = share.toDataURL("image/png");
    a.download = "hidden-in-art-share.png";
    a.click();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {focal && artwork && (
        <PaintingLocator focal={focal} artwork={artwork} hoverNorm={hoverNorm} />
      )}

      {/* Canvas wrapper — relative so overlays can be positioned inside */}
      <div className="relative w-full" style={{ maxWidth: CANVAS_W }}>
        <canvas
          ref={canvasRef}
          className="max-w-full touch-manipulation rounded shadow-md"
          style={{
            cursor: compareMode ? "ew-resize" : "crosshair",
            touchAction: compareMode ? "none" : "manipulation",
          }}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            clearLongPress();
            setHoverNorm(null);
            isDraggingRef.current = false;
          }}
          onClick={handleClick}
        />
        {/* Click-patch popup */}
        {!compareMode && clickedMatch && renderPhases && (
          <PatchPopup
            match={clickedMatch.match}
            userCanvas={renderPhases.userCanvas}
            cssX={clickedMatch.cssX}
            cssY={clickedMatch.cssY}
            onClose={() => setClickedMatch(null)}
          />
        )}
      </div>

      <div className="flex w-full max-w-[900px] flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="museum-caption text-xs text-neutral-400">{statusLine}</p>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            onClick={() => {
              const next = !compareMode;
              setCompareMode(next);
              compareModeRef.current = next;
              setClickedMatch(null);
              if (next) drawCompareRef.current(sliderNormRef.current);
              else      startAnimRef.current();
            }}
            disabled={!pd || !sourceImage}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-600 transition active:scale-[0.97] hover:bg-neutral-50 disabled:opacity-40 sm:min-h-0"
          >
            <Columns2 className="h-3.5 w-3.5" />
            {compareMode ? "✕ Compare" : "⇔ Compare"}
          </button>
          <button
            onClick={() => {
              if (compareMode) return;
              startAnimRef.current();
            }}
            disabled={!pd || !sourceImage || compareMode}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-600 transition active:scale-[0.97] hover:bg-neutral-50 disabled:opacity-40 sm:min-h-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            ↺ Replay
          </button>
          <button
            onClick={handleExport}
            disabled={!pd}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-600 transition active:scale-[0.97] hover:bg-neutral-50 disabled:opacity-40 sm:min-h-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export PNG
          </button>
          <button
            onClick={handleShareExport}
            disabled={!pd || !sourceImage}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-1.5 text-xs text-white transition active:scale-[0.97] hover:bg-neutral-700 disabled:opacity-40 sm:min-h-0"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Share square
          </button>
        </div>
      </div>
    </div>
  );
}
