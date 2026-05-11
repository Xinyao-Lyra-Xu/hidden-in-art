import type { ArtPoint, RenderSettings } from "@/types/art";

function rgbToString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function brightness(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
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
  const c = getPixel(data, width, height, x, y);
  const l = getPixel(data, width, height, x - 1, y);
  const r = getPixel(data, width, height, x + 1, y);
  const u = getPixel(data, width, height, x, y - 1);
  const d = getPixel(data, width, height, x, y + 1);

  const cb = brightness(c.r, c.g, c.b);

  const diff =
    Math.abs(cb - brightness(l.r, l.g, l.b)) +
    Math.abs(cb - brightness(r.r, r.g, r.b)) +
    Math.abs(cb - brightness(u.r, u.g, u.b)) +
    Math.abs(cb - brightness(d.r, d.g, d.b));

  return Math.min(diff / 180, 1);
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

  // pointDensity increase -> cellSize decrease -> more points, but more expensive to compute
  const cellSize = Math.max(
    4,
    Math.floor(Math.sqrt((canvas.width * canvas.height) / targetCount))
  );

  const candidates: ArtPoint[] = [];

  for (let y = 0; y < canvas.height; y += cellSize) {
    for (let x = 0; x < canvas.width; x += cellSize) {
      let bestX = x;
      let bestY = y;
      let bestScore = -1;
      let bestColor = { r: 0, g: 0, b: 0 };

      // pick 8 random points in the cell, score them, and keep the best one
      for (let i = 0; i < 8; i++) {
        const px = Math.min(
          canvas.width - 1,
          x + Math.floor(Math.random() * cellSize)
        );

        const py = Math.min(
          canvas.height - 1,
          y + Math.floor(Math.random() * cellSize)
        );

        const p = getPixel(data, canvas.width, canvas.height, px, py);
        const b = brightness(p.r, p.g, p.b);
        const dark = 1 - b / 255;
        const edge = edgeStrength(data, canvas.width, canvas.height, px, py);
        const sat = saturation(p.r, p.g, p.b);

        // blank area penalty: very bright and low saturation points are likely just background, so we give them a lower score to reduce meaningless points
        const backgroundPenalty = b > 235 && sat < 0.08 ? 0.25 : 1;

        const score =
          (dark * 0.5 + edge * 0.65 + sat * 0.25) * backgroundPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestX = px;
          bestY = py;
          bestColor = { r: p.r, g: p.g, b: p.b };
        }
      }

      // low score means the point is likely in a blank area, we can skip it to save points and improve overall quality
      if (bestScore < 0.08) continue;

      const b = brightness(bestColor.r, bestColor.g, bestColor.b);
      const dark = 1 - b / 255;
      const edge = edgeStrength(
        data,
        canvas.width,
        canvas.height,
        bestX,
        bestY
      );

      const abstraction = settings.abstraction / 100;

      const radius =
        1.1 +
        abstraction * 3.5 +
        Math.random() * 1.4 -
        edge * 1.2;

      candidates.push({
        x: bestX,
        y: bestY,
        r: Math.max(0.8, radius),
        color: rgbToString(bestColor.r, bestColor.g, bestColor.b),
        alpha: Math.min(0.22 + dark * 0.55 + edge * 0.45, 0.92),
      });
    }
  }

  // ranking points by a combination of darkness and edge strength, so that important details are more likely to be included when we limit the number of points
  return candidates
    .sort((a, b) => b.alpha * b.r - a.alpha * a.r)
    .slice(0, targetCount);
}