import type { ArtPoint, RenderSettings } from "@/types/art";

function rgbToString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function brightness(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function saturation(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function getPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const index = (safeY * width + safeX) * 4;

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  };
}

function edgeStrength(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const gradient = brightnessGradient(data, width, height, x, y);

  return Math.min(
    Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y) / 120,
    1
  );
}

function brightnessGradient(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const left = getPixel(data, width, height, x - 1, y);
  const right = getPixel(data, width, height, x + 1, y);
  const up = getPixel(data, width, height, x, y - 1);
  const down = getPixel(data, width, height, x, y + 1);

  return {
    x: brightness(right.r, right.g, right.b) - brightness(left.r, left.g, left.b),
    y: brightness(down.r, down.g, down.b) - brightness(up.r, up.g, up.b),
  };
}

function localContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const center = getPixel(data, width, height, x, y);
  const centerBrightness = brightness(center.r, center.g, center.b);
  let diff = 0;
  let count = 0;

  for (let oy = -2; oy <= 2; oy += 2) {
    for (let ox = -2; ox <= 2; ox += 2) {
      if (ox === 0 && oy === 0) continue;

      const p = getPixel(data, width, height, x + ox, y + oy);
      diff += Math.abs(centerBrightness - brightness(p.r, p.g, p.b));
      count++;
    }
  }

  return Math.min(diff / Math.max(count * 52, 1), 1);
}

function colorVariance(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const center = getPixel(data, width, height, x, y);
  let diff = 0;
  let count = 0;

  for (let oy = -2; oy <= 2; oy += 4) {
    for (let ox = -2; ox <= 2; ox += 4) {
      const p = getPixel(data, width, height, x + ox, y + oy);
      diff +=
        Math.abs(center.r - p.r) +
        Math.abs(center.g - p.g) +
        Math.abs(center.b - p.b);
      count++;
    }
  }

  return Math.min(diff / Math.max(count * 190, 1), 1);
}

function informationScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const p = getPixel(data, width, height, x, y);
  const b = brightness(p.r, p.g, p.b);
  const dark = 1 - b / 255;
  const sat = saturation(p.r, p.g, p.b);
  const edge = edgeStrength(data, width, height, x, y);
  const contrast = localContrast(data, width, height, x, y);
  const variance = colorVariance(data, width, height, x, y);
  const gradient = brightnessGradient(data, width, height, x, y);
  const nearWhite = b > 232 && sat < 0.1;
  const lowInformation = b > 218 && sat < 0.08 && edge < 0.08 && contrast < 0.08;
  const backgroundPenalty = nearWhite ? 0.16 : lowInformation ? 0.34 : 1;

  return {
    pixel: p,
    brightness: b,
    dark,
    edge,
    contrast,
    saturation: sat,
    angle: Math.atan2(gradient.y, gradient.x) + Math.PI / 2,
    score:
      (edge * 0.42 + contrast * 0.26 + dark * 0.22 + sat * 0.16 + variance * 0.1) *
      backgroundPenalty,
  };
}

function noise01(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function normalizeImportance(score: number): number {
  return Math.max(0, Math.min(1, score));
}

export function sampleImagePoints(
  image: HTMLImageElement,
  settings: RenderSettings
): ArtPoint[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) return [];

  const maxSize = 900;
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);

  canvas.width = Math.floor(image.width * scale);
  canvas.height = Math.floor(image.height * scale);

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const targetCount = Math.floor(settings.pointDensity);
  const decay = settings.memoryDecay / 100;
  const abstraction = settings.abstraction / 100;

  const cellSize = Math.max(
    3,
    Math.floor(Math.sqrt((canvas.width * canvas.height) / targetCount))
  );

  const candidates: Array<ArtPoint & { importance: number }> = [];

  for (let y = 0; y < canvas.height; y += cellSize) {
    for (let x = 0; x < canvas.width; x += cellSize) {
      let bestX = x;
      let bestY = y;
      let bestScore = -1;
      let bestInfo = informationScore(data, canvas.width, canvas.height, x, y);

      const step = Math.max(1, Math.floor(cellSize / 4));
      const maxY = Math.min(canvas.height, y + cellSize);
      const maxX = Math.min(canvas.width, x + cellSize);

      for (let py = y; py < maxY; py += step) {
        for (let px = x; px < maxX; px += step) {
          const info = informationScore(data, canvas.width, canvas.height, px, py);

          if (info.score > bestScore) {
            bestScore = info.score;
            bestX = px;
            bestY = py;
            bestInfo = info;
          }
        }
      }

      if (bestScore < 0.055 + decay * 0.065) continue;
      if (noise01(bestX, bestY) < decay * (1 - Math.min(bestScore * 2.8, 0.86))) {
        continue;
      }

      const jitter = (noise01(bestY, bestX) - 0.5) * cellSize * abstraction * 0.34;
      const radius =
        0.85 +
        abstraction * 2.6 +
        decay * 1.4 +
        noise01(bestX + 17, bestY - 11) * 0.85 -
        bestInfo.edge * 0.9;
      const sourceColor = rgbToString(
        bestInfo.pixel.r,
        bestInfo.pixel.g,
        bestInfo.pixel.b
      );
      const angle =
        Number.isFinite(bestInfo.angle)
          ? bestInfo.angle + (noise01(bestX + 41, bestY - 23) - 0.5) * 0.72
          : (noise01(bestX + 41, bestY - 23) - 0.5) * Math.PI;

      candidates.push({
        x: Math.max(0, Math.min(canvas.width - 1, bestX + jitter)),
        y: Math.max(0, Math.min(canvas.height - 1, bestY - jitter * 0.55)),
        r: Math.max(0.8, radius),
        color: sourceColor,
        alpha: Math.min(
          0.18 + bestInfo.dark * 0.42 + bestInfo.edge * 0.38 + bestInfo.saturation * 0.12,
          0.9
        ),
        sourceColor,
        patchSize: Math.max(8, cellSize * (1.6 + bestScore * 2.4)),
        importance: normalizeImportance(bestScore),
        angle,
      });
    }
  }

  return candidates
    .sort((a, b) => b.importance - a.importance)
    .slice(0, targetCount)
    .map(({ x, y, r, color, alpha, sourceColor, patchSize, importance, angle }) => ({
      x,
      y,
      r,
      color,
      alpha,
      sourceColor,
      patchSize,
      importance,
      angle,
    }));
}
