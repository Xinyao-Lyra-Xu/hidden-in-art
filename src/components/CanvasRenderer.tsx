"use client";

import { useEffect, useRef } from "react";
import type { ArtPoint, RenderSettings } from "@/types/art";

type Props = {
  points: ArtPoint[];
  settings: RenderSettings;
};

export default function CanvasRenderer({ points, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 900;
    const height = 650;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = "#f6f1e8";
    ctx.fillRect(0, 0, width, height);

    if (points.length === 0) {
      drawEmptyState(ctx, width, height);
      drawGrain(ctx, width, height);
      return;
    }

    const bounds = getBounds(points);

    const scale = Math.min(
      (width * 0.78) / bounds.width,
      (height * 0.78) / bounds.height
    );

    const offsetX = width / 2 - (bounds.minX + bounds.width / 2) * scale;
    const offsetY = height / 2 - (bounds.minY + bounds.height / 2) * scale;

    if (settings.showThreads || settings.mode === "thread-memory") {
      drawThreads(ctx, points, scale, offsetX, offsetY, width);
    }

    for (const p of points) {
      const x = p.x * scale + offsetX;
      const y = p.y * scale + offsetY;

      ctx.globalAlpha =
        settings.mode === "lost-portrait" ? p.alpha * 0.45 : p.alpha;

      ctx.fillStyle =
        settings.mode === "lost-portrait" ? "rgb(95, 72, 48)" : p.color;

      ctx.beginPath();

      if (settings.mode === "museum-dust") {
        ctx.ellipse(
          x,
          y,
          p.r * scale * 1.6,
          p.r * scale,
          Math.random() * Math.PI,
          0,
          Math.PI * 2
        );
      } else {
        ctx.arc(x, y, p.r * scale, 0, Math.PI * 2);
      }

      ctx.fill();
    }

    drawGrain(ctx, width, height);
    ctx.globalAlpha = 1;
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
        className="w-full max-w-5xl rounded-2xl border border-neutral-200 bg-white shadow-sm"
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
  width: number
) {
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "rgb(40, 35, 30)";
  ctx.lineWidth = 0.6;

  for (let i = 0; i < points.length; i += 4) {
    const p = points[i];
    const x = p.x * scale + offsetX;
    const y = p.y * scale + offsetY;

    const anchorX = width * 0.5 + Math.sin(i * 0.2) * 180;
    const anchorY = 70 + Math.cos(i * 0.15) * 24;

    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}

function drawGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.globalAlpha = 0.05;

  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const shade = Math.floor(130 + Math.random() * 70);

    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.globalAlpha = 1;
}