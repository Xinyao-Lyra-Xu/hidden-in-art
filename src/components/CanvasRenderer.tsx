"use client";

import { useEffect, useRef } from "react";
import type { ArtPoint, RenderSettings } from "@/types/art";

type Props = {
  points: ArtPoint[];
  settings: RenderSettings;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 650;

export default function CanvasRenderer({ points, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderCtx = ctx;

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    drawBase(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (points.length === 0) {
      drawEmptyState(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawVignette(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }

    const bounds = getBounds(points);
    const scale = Math.min(
      (CANVAS_WIDTH * 0.78) / bounds.width,
      (CANVAS_HEIGHT * 0.78) / bounds.height
    );
    const offsetX =
      CANVAS_WIDTH / 2 - (bounds.minX + bounds.width / 2) * scale;
    const offsetY =
      CANVAS_HEIGHT / 2 - (bounds.minY + bounds.height / 2) * scale;
    const visiblePoints = getVisiblePoints(points, settings);
    const batchSize = Math.max(18, Math.ceil(visiblePoints.length / 56));
    let drawnCount = 0;

    if (settings.showThreads || settings.mode === "thread-memory") {
      drawThreads(
        renderCtx,
        visiblePoints,
        scale,
        offsetX,
        offsetY,
        CANVAS_WIDTH,
        settings
      );
    }

    function animate() {
      const nextCount = Math.min(visiblePoints.length, drawnCount + batchSize);

      for (let i = drawnCount; i < nextCount; i++) {
        drawPoint(
          renderCtx,
          visiblePoints[i],
          i,
          scale,
          offsetX,
          offsetY,
          settings
        );
      }

      drawnCount = nextCount;

      if (drawnCount < visiblePoints.length) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      drawVignette(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      renderCtx.globalAlpha = 1;
      renderCtx.shadowBlur = 0;
      animationRef.current = null;
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [points, settings]);

  function downloadImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = "hidden-in-art.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        className="w-full max-w-5xl rounded border border-neutral-200 bg-white shadow-sm"
      />

      {points.length > 0 && (
        <button
          onClick={downloadImage}
          className="rounded-full border border-neutral-300 px-5 py-2 text-sm hover:bg-neutral-100"
        >
          Export PNG
        </button>
      )}
    </div>
  );
}

function drawBase(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, width, height);
  drawPaperGrain(ctx, width, height);
  drawFrameMargin(ctx, width, height);
}

function drawEmptyState(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.fillStyle = "rgba(80, 80, 80, 0.65)";
  ctx.font = "16px serif";
  ctx.textAlign = "center";
  ctx.fillText("Upload an image to reconstruct a memory.", width / 2, height / 2);
}

function getBounds(points: ArtPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function drawThreads(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  scale: number,
  offsetX: number,
  offsetY: number,
  width: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const threadPoints = points
    .filter((point) => point.alpha * point.r > 0.62)
    .slice(0, Math.min(150, Math.floor(points.length * 0.18)));

  ctx.globalAlpha =
    settings.mode === "thread-memory" ? 0.07 - decay * 0.025 : 0.035;
  ctx.strokeStyle =
    settings.mode === "lost-portrait" ? "rgb(102, 78, 50)" : "rgb(42, 38, 32)";
  ctx.lineWidth = settings.mode === "thread-memory" ? 0.55 : 0.4;

  for (let i = 0; i < threadPoints.length; i += 3) {
    const p = threadPoints[i];
    const x = p.x * scale + offsetX;
    const y = p.y * scale + offsetY;
    const anchorX = width * 0.5 + Math.sin(i * 0.41) * 130;
    const anchorY = 82 + Math.cos(i * 0.27) * 18;

    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.quadraticCurveTo((anchorX + x) / 2, y - 28 * scale, x, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawPoint(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const abstraction = settings.abstraction / 100;
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const noise = noise01(point.x + index * 3, point.y - index);
  const baseRadius = point.r * scale;

  if (noise < decay * 0.28 * (1 - Math.min(point.alpha, 0.85))) return;

  const alphaMultiplier =
    settings.mode === "lost-portrait"
      ? 0.46
      : settings.mode === "museum-dust"
        ? 0.36
        : settings.mode === "thread-memory"
          ? 0.62
          : 0.78;

  ctx.globalAlpha = Math.max(
    0.03,
    point.alpha * alphaMultiplier * (1 - decay * 0.62)
  );
  ctx.fillStyle =
    settings.mode === "lost-portrait"
      ? toSepia(point.color)
      : softenColor(point.color, settings.mode);
  ctx.shadowColor =
    settings.mode === "museum-dust"
      ? "rgba(90, 72, 48, 0.16)"
      : "rgba(80, 65, 45, 0.08)";
  ctx.shadowBlur =
    settings.mode === "museum-dust"
      ? 7 + decay * 8
      : settings.mode === "lost-portrait"
        ? 2 + decay * 4
        : decay * 3;

  ctx.beginPath();

  if (settings.mode === "museum-dust") {
    const radius = baseRadius * (2.1 + abstraction * 0.9 + decay * 0.8);
    ctx.ellipse(
      x,
      y,
      radius * (1.25 + noise * 0.45),
      radius * (0.7 + noise * 0.28),
      noise * Math.PI,
      0,
      Math.PI * 2
    );
  } else if (settings.mode === "thread-memory") {
    const radius = baseRadius * (0.8 + abstraction * 0.36);
    ctx.ellipse(
      x,
      y,
      radius * 1.55,
      radius * 0.75,
      noise * Math.PI,
      0,
      Math.PI * 2
    );
  } else if (settings.mode === "lost-portrait") {
    const radius = baseRadius * (1.15 + decay * 0.55);
    ctx.ellipse(
      x,
      y,
      radius * 1.2,
      radius * 0.9,
      noise * Math.PI,
      0,
      Math.PI * 2
    );
  } else {
    const radius = Math.max(0.65, baseRadius * (0.62 + abstraction * 0.2));
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }

  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function getVisiblePoints(points: ArtPoint[], settings: RenderSettings) {
  const decay = settings.memoryDecay / 100;

  return points.filter((point, index) => {
    const importance = Math.min(point.alpha * point.r, 1);
    const dropout = decay * 0.34 * (1 - importance * 0.65);
    return noise01(point.x + index, point.y - index) > dropout;
  });
}

function drawPaperGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.globalAlpha = 0.05;

  for (let i = 0; i < 5200; i++) {
    const x = (noise01(i, 11) * width) | 0;
    const y = (noise01(i, 29) * height) | 0;
    const shade = Math.floor(128 + noise01(i, 47) * 72);

    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.globalAlpha = 1;
}

function drawFrameMargin(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.strokeStyle = "rgba(84, 72, 54, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(34, 34, width - 68, height - 68);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.strokeRect(42, 42, width - 84, height - 84);
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.18,
    width / 2,
    height / 2,
    width * 0.68
  );

  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(1, "rgba(70, 52, 32, 0.13)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function parseRgb(color: string) {
  const channels = color.match(/\d+/g)?.map(Number) ?? [90, 76, 58];
  const [r, g, b] = channels;

  return { r, g, b };
}

function toSepia(color: string) {
  const { r, g, b } = parseRgb(color);
  const value = r * 0.299 + g * 0.587 + b * 0.114;
  const sr = Math.min(148, value * 0.62 + 56);
  const sg = Math.min(126, value * 0.5 + 45);
  const sb = Math.min(94, value * 0.36 + 32);

  return `rgb(${sr | 0}, ${sg | 0}, ${sb | 0})`;
}

function softenColor(color: string, mode: RenderSettings["mode"]) {
  if (mode === "point-memory") return color;

  const { r, g, b } = parseRgb(color);
  const mix = mode === "museum-dust" ? 0.34 : 0.18;
  const paper = { r: 246, g: 241, b: 232 };

  return `rgb(${(r * (1 - mix) + paper.r * mix) | 0}, ${
    (g * (1 - mix) + paper.g * mix) | 0
  }, ${(b * (1 - mix) + paper.b * mix) | 0})`;
}

function noise01(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
