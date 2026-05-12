"use client";

import { useEffect, useRef } from "react";
import type { ArtPoint, RenderSettings, TransferTargetPoint } from "@/types/art";

type Props = {
  points: ArtPoint[];
  settings: RenderSettings;
  sourceImage?: HTMLImageElement | null;
  targetImage?: HTMLImageElement | null;
  transferTargets?: TransferTargetPoint[];
  isAnimating?: boolean;
  onAnimationComplete?: () => void;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Bounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;

export default function CanvasRenderer({
  points,
  settings,
  sourceImage,
  targetImage,
  transferTargets = [],
  isAnimating = false,
  onAnimationComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const animationStateRef = useRef({
    isAnimating: false,
    stage: 0, // 0: markers, 1: lines, 2: patches
  });

  useEffect(() => {
    if (isAnimating) {
      animationStateRef.current.isAnimating = true;
      animationStateRef.current.stage = 0;
    }
  }, [isAnimating]);

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
    const isTransfer = settings.mode === "extracted-painting-transfer";
    const isPainting = isPaintingFragmentActive(settings);
    const visiblePoints = getVisiblePoints(points, settings);
    const renderPoints = isPainting
      ? [...visiblePoints].sort(
          (a, b) => (a.importance ?? 0) - (b.importance ?? 0)
        )
      : visiblePoints;
    const batchSize = Math.max(18, Math.ceil(renderPoints.length / 56));
    let drawnCount = 0;

    if (isTransfer) {
      drawExtractedPaintingTransfer(
        renderCtx,
        points,
        transferTargets,
        sourceImage ?? null,
        targetImage ?? null,
        settings,
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      drawVignette(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      renderCtx.globalAlpha = 1;
      renderCtx.shadowBlur = 0;
      return;
    }

    if (settings.showThreads || settings.mode === "thread-memory") {
      drawThreads(
        renderCtx,
        renderPoints,
        scale,
        offsetX,
        offsetY,
        CANVAS_WIDTH,
        settings
      );
    }

    if (isPainting) {
      drawPaintingFragmentMode(
        renderCtx,
        renderPoints,
        settings,
        scale,
        offsetX,
        offsetY,
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      drawVignette(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      renderCtx.globalAlpha = 1;
      renderCtx.shadowBlur = 0;
      return;
    }

    function animate() {
      const nextCount = Math.min(renderPoints.length, drawnCount + batchSize);

      for (let i = drawnCount; i < nextCount; i++) {
        drawPoint(
          renderCtx,
          renderPoints[i],
          i,
          scale,
          offsetX,
          offsetY,
          settings
        );
      }

      drawnCount = nextCount;

      if (drawnCount < renderPoints.length) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      drawVignette(renderCtx, CANVAS_WIDTH, CANVAS_HEIGHT);
      renderCtx.globalAlpha = 1;
      renderCtx.shadowBlur = 0;
      animationRef.current = null;

      if (isAnimating && onAnimationComplete) {
        onAnimationComplete();
      }
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [points, settings, sourceImage, targetImage, transferTargets, isAnimating, onAnimationComplete]);

  function downloadImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + 60;

    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;

    exportCtx.fillStyle = "#f6f1e8";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    exportCtx.drawImage(canvas, 0, 0);

    exportCtx.fillStyle = "rgba(80, 72, 62, 0.4)";
    exportCtx.font = "12px serif";
    exportCtx.textAlign = "center";
    exportCtx.fillText(
      "Hidden in Art — Material & Memory Transfer",
      exportCanvas.width / 2,
      canvas.height + 25
    );
    exportCtx.fillStyle = "rgba(100, 92, 82, 0.25)";
    exportCtx.font = "10px sans-serif";
    exportCtx.fillText(
      "(Reconstructed from image fragments)",
      exportCanvas.width / 2,
      canvas.height + 42
    );

    const link = document.createElement("a");
    link.download = "hidden-in-art-transfer.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <canvas
        ref={canvasRef}
        className="w-full max-w-5xl rounded border border-neutral-200 bg-white shadow-sm"
      />

      {points.length > 0 && transferTargets.length > 0 && (
        <div className="mx-auto w-full max-w-5xl rounded border border-neutral-200 bg-white/60 px-6 py-4 text-sm text-neutral-700 backdrop-blur">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-center md:grid-cols-4">
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">Style</p>
              <p className="font-semibold">{settings.colorBlend > 30 ? "Guided" : "Pure"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">Sample Points</p>
              <p className="font-semibold">{transferTargets.length}</p>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">Abstraction</p>
              <p className="font-semibold">{settings.abstraction}%</p>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">Detail Retention</p>
              <p className="font-semibold">{100 - settings.memoryDecay}%</p>
            </div>
          </div>
        </div>
      )}

      {points.length > 0 && (
        <button
          onClick={downloadImage}
          className="rounded-full border border-neutral-300 px-5 py-2 text-sm font-medium transition hover:bg-neutral-100"
        >
          Export as PNG
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

function fitRect(
  mediaWidth: number,
  mediaHeight: number,
  x: number,
  y: number,
  width: number,
  height: number
): Rect {
  const scale = Math.min(width / mediaWidth, height / mediaHeight);
  const fittedWidth = mediaWidth * scale;
  const fittedHeight = mediaHeight * scale;

  return {
    x: x + (width - fittedWidth) / 2,
    y: y + (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

function getSourceImageBounds(sourceImage: HTMLImageElement): Bounds {
  const maxSize = 900;
  const scale = Math.min(
    maxSize / sourceImage.width,
    maxSize / sourceImage.height,
    1
  );

  return {
    minX: 0,
    minY: 0,
    width: Math.max(1, Math.floor(sourceImage.width * scale)),
    height: Math.max(1, Math.floor(sourceImage.height * scale)),
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
  const isPainting = isPaintingFragmentActive(settings);
  const threadPoints = points
    .filter((point) => point.alpha * point.r > 0.62)
    .slice(
      0,
      isPainting
        ? Math.min(36, Math.floor(points.length * 0.045))
        : Math.min(150, Math.floor(points.length * 0.18))
    );

  ctx.globalAlpha =
    settings.mode === "thread-memory"
      ? 0.07 - decay * 0.025
      : isPainting
        ? 0.018
        : 0.035;
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

  if (isPaintingFragmentActive(settings)) {
    drawPaintingFragment(ctx, point, index, scale, offsetX, offsetY, settings);
    return;
  }

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
    const importance = Math.min(point.importance ?? point.alpha * point.r, 1);
    const paintingDropout = isPaintingFragmentActive(settings) ? 0.28 : 0;
    const dropout = decay * (0.34 + paintingDropout) * (1 - importance * 0.72);
    return noise01(point.x + index, point.y - index) > dropout;
  });
}

function drawExtractedPaintingTransfer(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  targets: TransferTargetPoint[],
  sourceImage: HTMLImageElement | null,
  targetImage: HTMLImageElement | null,
  settings: RenderSettings,
  width: number,
  height: number
) {
  if (!sourceImage || points.length === 0) {
    drawEmptyState(ctx, width, height);
    return;
  }

  const sourceBounds = getSourceImageBounds(sourceImage);
  const sourceRect = fitRect(
    sourceImage.width,
    sourceImage.height,
    52,
    height * 0.57,
    width - 104,
    height * 0.37
  );
  const topScale = settings.topReconstructionScale / 100;
  const targetRect = {
    x: width * 0.5 - 200 * topScale,
    y: 36,
    width: 400 * topScale,
    height: 310 * topScale,
  };
  const markerScale = settings.markerSize / 16;
  const visibleTargets = targets;

  drawSourcePanel(ctx, sourceImage, sourceRect, settings);
  if (visibleTargets.length === 0) {
    drawNoTargetState(ctx, targetRect);
    drawTransferFrames(ctx, sourceRect, targetRect);
    return;
  }

  drawTargetReconstruction(
    ctx,
    points,
    visibleTargets,
    sourceImage,
    targetImage,
    sourceBounds,
    targetRect,
    markerScale,
    settings
  );

  if (settings.showThreads) {
    drawTransferLines(
      ctx,
      points,
      visibleTargets,
      sourceRect,
      sourceBounds,
      targetRect,
      markerScale
    );
  }

  drawSourceMarkers(
    ctx,
    points,
    visibleTargets,
    sourceRect,
    sourceBounds,
    markerScale,
    settings
  );
  drawTransferFrames(ctx, sourceRect, targetRect);
}

function drawSourcePanel(
  ctx: CanvasRenderingContext2D,
  sourceImage: HTMLImageElement,
  rect: Rect,
  settings: RenderSettings
) {
  ctx.save();
  ctx.globalAlpha = settings.preserveSourceImage ? 0.92 : 0.58;
  ctx.drawImage(sourceImage, rect.x, rect.y, rect.width, rect.height);

  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgb(128, 82, 48)";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawTargetReconstruction(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  targets: TransferTargetPoint[],
  sourceImage: HTMLImageElement,
  targetImage: HTMLImageElement | null,
  sourceBounds: Bounds,
  targetRect: Rect,
  markerScale: number,
  settings: RenderSettings
) {
  const opacity = settings.reconstructionOpacity / 100;
  const targetBlend = settings.colorBlend / 100;
  const sortedTargets = [...targets].sort((a, b) => a.importance - b.importance);

  if (targetImage) {
    drawTargetGhostUnderlay(ctx, targetImage, targetRect, opacity, targetBlend);
    drawTargetEdgeGuide(ctx, targetImage, targetRect, opacity, targetBlend);
  }

  for (let i = 0; i < sortedTargets.length; i++) {
    const target = sortedTargets[i];
    const point = points[target.sourceIndex] ?? points[i % points.length];
    const x = targetRect.x + target.x * targetRect.width;
    const y = targetRect.y + target.y * targetRect.height;
    const layerScale =
      i < sortedTargets.length * 0.3
        ? 1.42
        : target.importance > 0.42
          ? 0.92
          : 0.62;
    const radius =
      target.r * markerScale * (0.78 + target.importance * 0.62) * layerScale;

    if (noise01(target.x * 400 + i, target.y * 400 - i) < settings.memoryDecay / 760) {
      continue;
    }

    drawTargetColorUnderlay(
      ctx,
      x,
      y,
      Math.max(4.2, radius * (1.04 + (1 - target.importance) * 0.18)),
      target.targetColor,
      opacity * (0.12 + target.importance * 0.1)
    );

    drawCircularSourcePatch(
      ctx,
      sourceImage,
      point,
      sourceBounds,
      x,
      y,
      Math.max(3.5, radius),
      target.angle,
      opacity * (0.58 + target.importance * 0.42),
      target.targetColor,
      target.importance,
      targetBlend
    );

    if (target.importance > 0.52) {
      drawTargetDetailDot(
        ctx,
        x,
        y,
        Math.max(1.8, radius * 0.42),
        target.targetColor,
        opacity * (0.2 + target.importance * 0.22)
      );
    }
  }
}

function drawTargetGhostUnderlay(
  ctx: CanvasRenderingContext2D,
  targetImage: HTMLImageElement,
  targetRect: Rect,
  opacity: number,
  targetBlend: number
) {
  ctx.save();
  ctx.globalAlpha = opacity * (0.18 + targetBlend * 0.22);
  ctx.filter = "grayscale(1) sepia(0.35) contrast(1.08)";
  ctx.drawImage(
    targetImage,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height
  );
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = opacity * 0.05;
  ctx.fillStyle = "rgb(109, 82, 52)";
  ctx.fillRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
  ctx.restore();
}

function drawTargetEdgeGuide(
  ctx: CanvasRenderingContext2D,
  targetImage: HTMLImageElement,
  targetRect: Rect,
  opacity: number,
  targetBlend: number
) {
  const sampleWidth = 150;
  const sampleHeight = Math.max(
    1,
    Math.round((targetImage.height / targetImage.width) * sampleWidth)
  );
  const edgeCanvas = document.createElement("canvas");
  const edgeCtx = edgeCanvas.getContext("2d", { willReadFrequently: true });

  if (!edgeCtx) return;

  edgeCanvas.width = sampleWidth;
  edgeCanvas.height = sampleHeight;
  edgeCtx.drawImage(targetImage, 0, 0, sampleWidth, sampleHeight);

  const imageData = edgeCtx.getImageData(0, 0, sampleWidth, sampleHeight);
  const data = imageData.data;
  const step = 3;

  ctx.save();
  ctx.strokeStyle = "rgba(68, 56, 42, 0.22)";
  ctx.lineWidth = 0.42;
  ctx.globalAlpha = opacity * (0.14 + targetBlend * 0.14);

  for (let y = step; y < sampleHeight - step; y += step) {
    for (let x = step; x < sampleWidth - step; x += step) {
      const center = targetBrightnessAt(data, sampleWidth, x, y);
      const right = targetBrightnessAt(data, sampleWidth, x + step, y);
      const down = targetBrightnessAt(data, sampleWidth, x, y + step);
      const edge = Math.abs(center - right) + Math.abs(center - down);

      if (edge < 62) continue;
      if (noise01(x * 13, y * 17) < 0.38) continue;

      const px = targetRect.x + (x / sampleWidth) * targetRect.width;
      const py = targetRect.y + (y / sampleHeight) * targetRect.height;
      const length = 2.6 + Math.min(edge / 70, 2.8);
      const angle = Math.atan2(down - center, right - center) + Math.PI / 2;

      ctx.beginPath();
      ctx.moveTo(px - Math.cos(angle) * length, py - Math.sin(angle) * length);
      ctx.lineTo(px + Math.cos(angle) * length, py + Math.sin(angle) * length);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function targetBrightnessAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
) {
  const index = (y * width + x) * 4;
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function drawTargetColorUnderlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTargetDetailDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTransferLines(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  targets: TransferTargetPoint[],
  sourceRect: Rect,
  sourceBounds: Bounds,
  targetRect: Rect,
  markerScale: number
) {
  ctx.save();
  ctx.strokeStyle = "rgba(70, 66, 58, 0.085)";
  ctx.lineWidth = 0.28;

  const importantTargets = [...targets]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, Math.min(56, Math.floor(targets.length * 0.13)));

  for (let i = 0; i < importantTargets.length; i++) {
    const target = importantTargets[i];
    if (noise01(target.x * 300 + i, target.y * 300 - i) < 0.42) continue;

    const point = points[target.sourceIndex] ?? points[i % points.length];
    const from = sourcePointToCanvas(point, sourceRect, sourceBounds);
    const to = {
      x: targetRect.x + target.x * targetRect.width,
      y: targetRect.y + target.y * targetRect.height,
    };

    ctx.globalAlpha = 0.1 + target.importance * 0.14;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(
      from.x,
      from.y - 170 * markerScale,
      to.x,
      to.y + 110 * markerScale,
      to.x,
      to.y
    );
    ctx.stroke();
  }

  ctx.restore();
}

function drawSourceMarkers(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  targets: TransferTargetPoint[],
  sourceRect: Rect,
  sourceBounds: Bounds,
  markerScale: number,
  settings: RenderSettings
) {
  ctx.save();
  const markerTargets = [...targets]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, Math.min(120, Math.floor(targets.length * 0.18)));

  for (let i = 0; i < markerTargets.length; i++) {
    const target = markerTargets[i];
    if (noise01(target.x * 200 + i, target.y * 200) < 0.28) continue;

    const point = points[target.sourceIndex] ?? points[i % points.length];
    const marker = sourcePointToCanvas(point, sourceRect, sourceBounds);
    const radius = Math.max(
      2.4,
      (settings.markerSize * 0.18 + target.importance * settings.markerSize * 0.18) *
        markerScale
    );

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "rgba(255, 253, 247, 0.34)";
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "rgba(255, 253, 247, 0.78)";
    ctx.lineWidth = 0.62;
    ctx.stroke();

    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "rgba(83, 70, 55, 0.28)";
    ctx.lineWidth = 0.86;
    ctx.stroke();
  }

  ctx.restore();
}

function drawCircularSourcePatch(
  ctx: CanvasRenderingContext2D,
  sourceImage: HTMLImageElement,
  point: ArtPoint,
  sourceBounds: Bounds,
  x: number,
  y: number,
  radius: number,
  angle: number,
  alpha: number,
  targetColor: string,
  importance: number,
  targetBlend: number
) {
  const sx = ((point.x - sourceBounds.minX) / sourceBounds.width) * sourceImage.width;
  const sy = ((point.y - sourceBounds.minY) / sourceBounds.height) * sourceImage.height;
  const cropSize = Math.min(
    sourceImage.width,
    sourceImage.height,
    Math.max(8, point.patchSize ?? radius * 2.8)
  );
  const cropX = Math.max(0, Math.min(sourceImage.width - cropSize, sx - cropSize / 2));
  const cropY = Math.max(0, Math.min(sourceImage.height - cropSize, sy - cropSize / 2));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    sourceImage,
    cropX,
    cropY,
    cropSize,
    cropSize,
    -radius,
    -radius,
    radius * 2,
    radius * 2
  );

  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = alpha * (0.08 + targetBlend * (0.24 + importance * 0.3));
  ctx.fillStyle = targetColor;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = alpha * 0.28;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
  ctx.lineWidth = Math.max(0.35, radius * 0.08);
  ctx.stroke();
  ctx.restore();
}

function drawTransferFrames(
  ctx: CanvasRenderingContext2D,
  sourceRect: Rect,
  targetRect: Rect
) {
  ctx.save();
  ctx.strokeStyle = "rgba(80, 68, 51, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);
  ctx.strokeRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
  ctx.restore();
}

function drawNoTargetState(ctx: CanvasRenderingContext2D, targetRect: Rect) {
  ctx.save();
  ctx.strokeStyle = "rgba(80, 68, 51, 0.14)";
  ctx.strokeRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
  ctx.fillStyle = "rgba(80, 72, 62, 0.62)";
  ctx.font = "15px serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "No target image selected.",
    targetRect.x + targetRect.width / 2,
    targetRect.y + targetRect.height / 2
  );
  ctx.restore();
}

function sourcePointToCanvas(point: ArtPoint, rect: Rect, bounds: Bounds) {
  return {
    x: rect.x + ((point.x - bounds.minX) / bounds.width) * rect.width,
    y: rect.y + ((point.y - bounds.minY) / bounds.height) * rect.height,
  };
}

function drawPaintingFragmentMode(
  ctx: CanvasRenderingContext2D,
  points: ArtPoint[],
  settings: RenderSettings,
  scale: number,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number
) {
  const decay = settings.memoryDecay / 100;
  const densityScale = Math.max(0.9, Math.min(1.18, Math.sqrt((width * height) / (900 * 650))));
  const orderedPoints = [...points].sort((a, b) => a.importance - b.importance);

  // Pass 1: low opacity background material so the image reads as a painted surface, not isolated marks.
  for (let i = 0; i < orderedPoints.length; i++) {
    const point = orderedPoints[i];
    const importance = Math.min(point.importance ?? point.alpha, 1);

    if (importance > 0.78) continue;
    if (noise01(point.x + i * 11, point.y - i * 7) < decay * 0.12) continue;

    drawFragmentWash(ctx, point, i, scale * densityScale, offsetX, offsetY, settings);
  }

  // Pass 2: cropped painting tiles. These do most of the reconstruction work.
  for (let i = 0; i < orderedPoints.length; i++) {
    const point = orderedPoints[i];
    const importance = Math.min(point.importance ?? point.alpha, 1);

    if (importance < 0.08 && noise01(point.x - i, point.y + i) < 0.42) continue;
    if (noise01(point.x - i * 5, point.y + i * 9) < decay * 0.2 * (1 - importance)) {
      continue;
    }

    drawFragmentPatch(ctx, point, i, scale, offsetX, offsetY, settings);
  }

  // Pass 3: thick brush dashes add painterly material without becoming circular particles.
  for (let i = 0; i < orderedPoints.length; i++) {
    const point = orderedPoints[i];
    const importance = Math.min(point.importance ?? point.alpha, 1);

    if (importance < 0.16) continue;
    if (noise01(point.x + i * 23, point.y - i * 3) < decay * 0.22 * (1 - importance)) {
      continue;
    }

    drawBrushStroke(ctx, point, i, scale, offsetX, offsetY, settings);
  }

  // Pass 4: small sharper chips preserve face edges, shadows, and contours.
  for (let i = 0; i < orderedPoints.length; i++) {
    const point = orderedPoints[i];
    const importance = Math.min(point.importance ?? point.alpha, 1);

    if (importance < 0.38) continue;
    if (noise01(point.x + i * 19, point.y + i * 13) < decay * 0.3 * (1 - importance)) {
      continue;
    }

    drawDetailFragment(ctx, point, i, scale, offsetX, offsetY, settings);
  }
}

function drawPaintingFragment(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const colorBlend = settings.colorBlend / 100;
  const importance = Math.min(point.importance ?? point.alpha, 1);
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const baseRadius = point.r * scale;
  const noise = noise01(point.x + index * 3, point.y - index);

  if (noise < decay * 0.42 * (1 - importance)) return;

  const angle =
    (point.angle ?? 0) +
    (noise01(point.x - index, point.y + index) - 0.5) * 0.62;
  const fragmentColor = point.paintingColor ?? point.color;
  const bodyColor = point.color;
  const darkPigment = mixColor(fragmentColor, "rgb(34, 26, 18)", 0.18 + importance * 0.22);
  const palePigment = mixColor(bodyColor, "rgb(246, 241, 232)", 0.16 + (1 - importance) * 0.28);

  drawPaintingWashShape(
    ctx,
    x,
    y,
    baseRadius,
    angle,
    noise,
    importance,
    bodyColor,
    settings
  );
  drawPaintingPatchShape(
    ctx,
    x,
    y,
    baseRadius,
    angle,
    noise,
    importance,
    bodyColor,
    palePigment,
    fragmentColor,
    settings
  );

  if (importance > 0.22) {
    drawPaintingShardShape(
      ctx,
      x,
      y,
      baseRadius,
      angle,
      noise,
      importance,
      fragmentColor,
      darkPigment,
      settings
    );
  }

  if (importance > 0.48 && colorBlend < 0.98) {
    drawStructureTrace(
      ctx,
      x,
      y,
      baseRadius,
      angle,
      point.sourceColor ?? bodyColor,
      importance,
      1 - colorBlend
    );
  }
}

function drawFragmentWash(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const importance = Math.min(point.importance ?? point.alpha, 1);
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const baseRadius = point.r * scale * (1.12 + (1 - importance) * 0.32);
  const noise = noise01(point.x + index * 3, point.y - index);
  const angle =
    point.angle + (noise01(point.x - index, point.y + index) - 0.5) * 0.62;

  if (noise < decay * 0.18 * (1 - importance)) return;

  drawPaintingWashShape(
    ctx,
    x,
    y,
    baseRadius,
    angle,
    noise,
    importance,
    point.color,
    settings
  );
}

function drawFragmentPatch(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const importance = Math.min(point.importance ?? point.alpha, 1);
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const baseRadius = point.r * scale * (1 + importance * 0.16);
  const noise = noise01(point.x + index * 3, point.y - index);
  const angle =
    point.angle + (noise01(point.x - index, point.y + index) - 0.5) * 0.5;
  const fragmentColor = point.paintingColor ?? point.color;
  const palePigment = mixColor(point.color, "rgb(246, 241, 232)", 0.16 + (1 - importance) * 0.28);

  if (noise < decay * 0.22 * (1 - importance)) return;

  drawPaintingPatchShape(
    ctx,
    x,
    y,
    baseRadius,
    angle,
    noise,
    importance,
    point.color,
    palePigment,
    fragmentColor,
    settings
  );
}

function drawBrushStroke(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const importance = Math.min(point.importance ?? point.alpha, 1);
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const baseRadius = point.r * scale;
  const noise = noise01(point.x + index * 3, point.y - index);
  const angle =
    point.angle + (noise01(point.x - index, point.y + index) - 0.5) * 0.32;
  const fragmentColor = point.paintingColor ?? point.color;
  const strokeColor = mixColor(point.color, fragmentColor, 0.52 + importance * 0.28);
  const length = baseRadius * (2.2 + settings.abstraction / 42 + importance * 2.1);
  const thickness = Math.max(1.1, baseRadius * (0.34 + importance * 0.42));
  const alpha = Math.max(0.035, point.alpha * (0.2 + importance * 0.5) * (1 - decay * 0.42));

  if (noise < decay * 0.24 * (1 - importance)) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(59, 44, 27, 0.1)";
  ctx.shadowBlur = (1 - importance) * 4 + decay * 2;

  ctx.beginPath();
  ctx.moveTo(-length * 0.5, (noise - 0.5) * thickness);
  ctx.quadraticCurveTo(
    0,
    (0.5 - noise) * thickness * 0.8,
    length * 0.5,
    (noise01(y, x) - 0.5) * thickness
  );
  ctx.stroke();

  ctx.globalAlpha = alpha * 0.28;
  ctx.strokeStyle = mixColor(fragmentColor, "rgb(248, 242, 226)", 0.24);
  ctx.lineWidth = Math.max(0.4, thickness * 0.34);
  ctx.beginPath();
  ctx.moveTo(-length * 0.38, -thickness * 0.24);
  ctx.lineTo(length * 0.36, thickness * 0.08);
  ctx.stroke();
  ctx.restore();
}

function drawDetailFragment(
  ctx: CanvasRenderingContext2D,
  point: ArtPoint,
  index: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  settings: RenderSettings
) {
  const colorBlend = settings.colorBlend / 100;
  const importance = Math.min(point.importance ?? point.alpha, 1);
  const x = point.x * scale + offsetX;
  const y = point.y * scale + offsetY;
  const baseRadius = point.r * scale;
  const noise = noise01(point.x + index * 3, point.y - index);
  const angle =
    point.angle + (noise01(point.x - index, point.y + index) - 0.5) * 0.22;
  const fragmentColor = point.paintingColor ?? point.color;
  const darkPigment = mixColor(fragmentColor, "rgb(28, 21, 16)", 0.2 + importance * 0.28);

  drawPaintingShardShape(
    ctx,
    x,
    y,
    baseRadius * 0.86,
    angle,
    noise,
    importance,
    fragmentColor,
    darkPigment,
    settings
  );

  if (importance > 0.58 && colorBlend < 0.98) {
    drawStructureTrace(
      ctx,
      x,
      y,
      baseRadius,
      angle,
      point.sourceColor ?? point.color,
      importance,
      1 - colorBlend
    );
  }
}

function drawPaintingWashShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRadius: number,
  angle: number,
  noise: number,
  importance: number,
  color: string,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const abstraction = settings.abstraction / 100;
  const width = baseRadius * (6.4 + abstraction * 2.8 + noise * 1.8);
  const height = baseRadius * (2.4 + (1 - importance) * 2.2);
  const alpha = Math.max(
    0.026,
    (0.078 + (1 - importance) * 0.14) * (1 - decay * 0.34)
  );

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + (noise - 0.5) * 0.35);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(68, 51, 32, 0.08)";
  ctx.shadowBlur = 10 + decay * 7;

  if (noise > 0.52) {
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawRoughPatchPath(ctx, width, height, noise, 0.34);
    ctx.fill();
  }
  ctx.restore();
}

function drawPaintingPatchShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRadius: number,
  angle: number,
  noise: number,
  importance: number,
  color: string,
  paleColor: string,
  strokeColor: string,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const abstraction = settings.abstraction / 100;
  const width = baseRadius * (3.2 + abstraction * 2.15 + importance * 2.2);
  const height = baseRadius * (1.2 + noise * 0.78 + importance * 0.58);
  const alpha = Math.max(
    0.055,
    (0.22 + importance * 0.48) * (1 - decay * 0.34)
  );

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(72, 55, 36, 0.12)";
  ctx.shadowBlur = (1 - importance) * 7 + decay * 4;

  drawRoughPatchPath(ctx, width, height, noise, 0.22);
  ctx.fill();

  ctx.globalAlpha = alpha * 0.42;
  ctx.fillStyle = paleColor;
  drawRoughPatchPath(ctx, width * 0.72, height * 0.52, noise + 0.3, 0.18);
  ctx.fill();

  for (let i = 0; i < 3; i++) {
    const lineNoise = noise01(x + i * 17, y - i * 13);

    ctx.globalAlpha = alpha * (0.18 + importance * 0.16);
    ctx.strokeStyle = i === 1 ? paleColor : strokeColor;
    ctx.lineWidth = Math.max(0.28, height * (0.08 + lineNoise * 0.06));
    ctx.beginPath();
    ctx.moveTo(-width * (0.42 + lineNoise * 0.12), height * (lineNoise - 0.5));
    ctx.lineTo(width * (0.42 + lineNoise * 0.16), height * (0.5 - lineNoise));
    ctx.stroke();
  }

  ctx.restore();
}

function drawPaintingShardShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRadius: number,
  angle: number,
  noise: number,
  importance: number,
  color: string,
  darkColor: string,
  settings: RenderSettings
) {
  const decay = settings.memoryDecay / 100;
  const width = baseRadius * (1.25 + importance * 1.8);
  const height = baseRadius * (0.36 + importance * 0.5);
  const alpha = Math.max(0.055, (0.3 + importance * 0.58) * (1 - decay * 0.34));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + (noise - 0.5) * 0.25);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(48, 36, 22, 0.16)";
  ctx.shadowBlur = Math.max(0, (1 - importance) * 5 + decay * 2);

  drawRoughPatchPath(ctx, width, height, noise + 0.61, 0.12);
  ctx.fill();

  ctx.globalAlpha = alpha * 0.52;
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = Math.max(0.32, height * 0.18);
  ctx.beginPath();
  ctx.moveTo(-width * 0.46, -height * 0.15);
  ctx.lineTo(width * 0.42, height * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawStructureTrace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRadius: number,
  angle: number,
  color: string,
  importance: number,
  amount: number
) {
  const width = baseRadius * (1.1 + importance * 1.3);
  const height = baseRadius * (0.24 + importance * 0.22);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = amount * (0.04 + importance * 0.08);
  ctx.fillStyle = color;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawRoughPatchPath(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  roughness: number
) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const n1 = noise01(seed * 101, width);
  const n2 = noise01(seed * 131, height);
  const n3 = noise01(seed * 173, width + height);
  const n4 = noise01(seed * 191, width - height);
  const rX = width * roughness;
  const rY = height * roughness;

  ctx.beginPath();
  ctx.moveTo(-halfWidth + (n1 - 0.5) * rX, -halfHeight + (n2 - 0.5) * rY);
  ctx.lineTo(halfWidth + (n2 - 0.5) * rX, -halfHeight + (n3 - 0.5) * rY);
  ctx.lineTo(halfWidth + (n3 - 0.5) * rX, halfHeight + (n4 - 0.5) * rY);
  ctx.lineTo(-halfWidth + (n4 - 0.5) * rX, halfHeight + (n1 - 0.5) * rY);
  ctx.closePath();
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

function mixColor(color: string, target: string, amount: number) {
  const source = parseRgb(color);
  const destination = parseRgb(target);
  const clamped = Math.max(0, Math.min(1, amount));

  return `rgb(${(source.r * (1 - clamped) + destination.r * clamped) | 0}, ${
    (source.g * (1 - clamped) + destination.g * clamped) | 0
  }, ${(source.b * (1 - clamped) + destination.b * clamped) | 0})`;
}

function isPaintingFragmentActive(settings: RenderSettings) {
  return (
    settings.mode === "painting-fragment" ||
    (settings.usePaintingFragment && settings.paintingSource !== "none")
  );
}

function noise01(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
