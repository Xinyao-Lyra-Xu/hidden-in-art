import type { ArtPoint, RenderSettings, TransferTargetPoint } from "@/types/art";

type Pixel = {
  r: number;
  g: number;
  b: number;
};

type TargetFeatures = {
  brightness: number;
  saturation: number;
  warmth: number;
};

type SourceCandidate = {
  index: number;
  point: ArtPoint;
  brightness: number;
  saturation: number;
  warmth: number;
};

function rgbToString({ r, g, b }: Pixel) {
  return `rgb(${r}, ${g}, ${b})`;
}

function brightness({ r, g, b }: Pixel) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function saturation({ r, g, b }: Pixel) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function warmth({ r, b }: Pixel) {
  return (r - b + 255) / 510;
}

function parseRgb(color: string): Pixel {
  const channels = color.match(/\d+/g)?.map(Number) ?? [128, 128, 128];
  const [r, g, b] = channels;

  return { r, g, b };
}

function getPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): Pixel {
  const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
  const index = (safeY * width + safeX) * 4;

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
  };
}

function edgeStrength(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const left = brightness(getPixel(data, width, height, x - 1, y));
  const right = brightness(getPixel(data, width, height, x + 1, y));
  const up = brightness(getPixel(data, width, height, x, y - 1));
  const down = brightness(getPixel(data, width, height, x, y + 1));

  return Math.min(
    Math.sqrt((right - left) * (right - left) + (down - up) * (down - up)) / 120,
    1
  );
}

function localContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const center = brightness(getPixel(data, width, height, x, y));
  let total = 0;
  let count = 0;

  for (let dy = -3; dy <= 3; dy += 3) {
    for (let dx = -3; dx <= 3; dx += 3) {
      if (dx === 0 && dy === 0) continue;
      total += Math.abs(center - brightness(getPixel(data, width, height, x + dx, y + dy)));
      count++;
    }
  }

  return Math.min(total / Math.max(1, count) / 88, 1);
}

function noise01(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function scoreTargetPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const pixel = getPixel(data, width, height, x, y);
  const b = brightness(pixel);
  const dark = 1 - b / 255;
  const sat = saturation(pixel);
  const edge = edgeStrength(data, width, height, x, y);
  const contrast = localContrast(data, width, height, x, y);
  const nearWhiteBlank = b > 224 && sat < 0.1 && edge < 0.12 && contrast < 0.12;
  const brightBlankPenalty = nearWhiteBlank ? 0.018 : b > 238 && sat < 0.08 ? 0.08 : 1;
  const centerX = (x / Math.max(1, width - 1) - 0.5) / 0.48;
  const centerY = (y / Math.max(1, height - 1) - 0.5) / 0.56;
  const centralFalloff = Math.max(0.72, 1 - Math.max(0, centerX * centerX + centerY * centerY - 0.6) * 0.2);
  const tonalPresence = b < 218 || sat > 0.14 || edge > 0.18 || contrast > 0.18 ? 1 : 0.42;

  return {
    color: pixel,
    brightness: b / 255,
    saturation: sat,
    warmth: warmth(pixel),
    score:
      (dark * 0.3 + edge * 0.38 + contrast * 0.32 + sat * 0.16) *
      brightBlankPenalty *
      centralFalloff *
      tonalPresence,
  };
}

function colorFeatures(point: ArtPoint): TargetFeatures {
  const color = parseRgb(point.sourceColor ?? point.color);

  return {
    brightness: brightness(color) / 255,
    saturation: saturation(color),
    warmth: warmth(color),
  };
}

function createSourceCandidates(sourcePoints: ArtPoint[]): SourceCandidate[] {
  return sourcePoints
    .map((point, index) => ({
      index,
      point,
      ...colorFeatures(point),
    }))
    .sort((a, b) => b.point.importance - a.point.importance);
}

function pickSourceIndex(
  sourceCandidates: SourceCandidate[],
  target: TargetFeatures,
  salt: number
) {
  const searchCount = Math.min(sourceCandidates.length, 190);
  const randomWindow = Math.max(searchCount, Math.floor(sourceCandidates.length * 0.55));
  let bestCandidate = sourceCandidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < searchCount; i++) {
    const candidate =
      i < 56
        ? sourceCandidates[i]
        : sourceCandidates[
            Math.floor(noise01(salt + i * 13, i) * randomWindow) % sourceCandidates.length
          ];
    const score =
      Math.abs(candidate.brightness - target.brightness) * 1.75 +
      Math.abs(candidate.saturation - target.saturation) * 0.82 +
      Math.abs(candidate.warmth - target.warmth) * 1.02 -
      candidate.point.importance * 0.2;

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate.index;
}

export function buildTargetReconstruction(
  painting: HTMLImageElement | null,
  sourcePoints: ArtPoint[],
  settings: RenderSettings
): TransferTargetPoint[] {
  if (!painting || sourcePoints.length === 0) {
    return [];
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) return [];

  const maxSize = 420;
  const scale = Math.min(maxSize / painting.width, maxSize / painting.height, 1);

  canvas.width = Math.max(1, Math.floor(painting.width * scale));
  canvas.height = Math.max(1, Math.floor(painting.height * scale));
  ctx.drawImage(painting, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const targetCount = Math.max(
    260,
    Math.min(780, Math.round(settings.pointDensity / 3.35))
  );
  const cellSize = Math.max(
    3,
    Math.floor(Math.sqrt((canvas.width * canvas.height) / (targetCount * 1.35)))
  );
  const sourceCandidates = createSourceCandidates(sourcePoints);
  const candidates: TransferTargetPoint[] = [];

  for (let y = 0; y < canvas.height; y += cellSize) {
    for (let x = 0; x < canvas.width; x += cellSize) {
      let bestX = x;
      let bestY = y;
      let bestScore = -1;
      let bestColor = { r: 0, g: 0, b: 0 };
      let bestBrightness = 0;
      let bestSaturation = 0;
      let bestWarmth = 0;
      const maxY = Math.min(canvas.height, y + cellSize);
      const maxX = Math.min(canvas.width, x + cellSize);
      const step = Math.max(2, Math.floor(cellSize / 3));

      for (let py = y; py < maxY; py += step) {
        for (let px = x; px < maxX; px += step) {
          const result = scoreTargetPixel(data, canvas.width, canvas.height, px, py);

          if (result.score > bestScore) {
            bestScore = result.score;
            bestX = px;
            bestY = py;
            bestColor = result.color;
            bestBrightness = result.brightness;
            bestSaturation = result.saturation;
            bestWarmth = result.warmth;
          }
        }
      }

      if (bestScore < 0.034) continue;

      const sourceIndex = pickSourceIndex(
        sourceCandidates,
        {
          brightness: bestBrightness,
          saturation: bestSaturation,
          warmth: bestWarmth,
        },
        bestX + bestY * 17
      );
      const source = sourcePoints[sourceIndex];
      const tierNoise = noise01(bestX + 31, bestY - 29);
      const tierScale = tierNoise > 0.82 ? 0.52 : tierNoise > 0.48 ? 0.82 : 1.3;

      candidates.push({
        x: bestX / Math.max(1, canvas.width - 1),
        y: bestY / Math.max(1, canvas.height - 1),
        r: (2.9 + bestScore * 8.6 + (settings.abstraction / 100) * 2.2) * tierScale,
        sourceIndex,
        importance: Math.max(0, Math.min(1, bestScore)),
        angle: source.angle + (noise01(bestX + 17, bestY - 9) - 0.5) * 0.7,
        targetColor: rgbToString(bestColor),
        targetBrightness: bestBrightness,
        targetSaturation: bestSaturation,
        targetWarmth: bestWarmth,
      });
    }
  }

  return candidates
    .sort((a, b) => b.importance - a.importance)
    .slice(0, targetCount);
}
