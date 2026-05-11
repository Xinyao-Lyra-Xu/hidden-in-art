import type { ArtPoint, RenderSettings } from "@/types/art";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

function rgbToString({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function parseRgb(color: string): Rgb {
  const channels = color.match(/\d+/g)?.map(Number) ?? [90, 76, 58];
  const [r, g, b] = channels;

  return { r, g, b };
}

function blendRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const clamped = Math.max(0, Math.min(1, amount));

  return {
    r: a.r * (1 - clamped) + b.r * clamped,
    g: a.g * (1 - clamped) + b.g * clamped,
    b: a.b * (1 - clamped) + b.b * clamped,
  };
}

function getPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): Rgb {
  const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
  const index = (safeY * width + safeX) * 4;

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
  };
}

function boundsFor(points: ArtPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

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

function noise01(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function mapPaintingColors(
  points: ArtPoint[],
  painting: HTMLImageElement | null,
  settings: RenderSettings
): ArtPoint[] {
  if (
    !painting ||
    !settings.usePaintingFragment ||
    settings.paintingSource === "none" ||
    points.length === 0
  ) {
    return points;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) return points;

  const maxSize = 900;
  const scale = Math.min(maxSize / painting.width, maxSize / painting.height, 1);

  canvas.width = Math.max(1, Math.floor(painting.width * scale));
  canvas.height = Math.max(1, Math.floor(painting.height * scale));
  ctx.drawImage(painting, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = boundsFor(points);
  const blend = settings.colorBlend / 100;

  return points.map((point, index) => {
    const nx = (point.x - bounds.minX) / bounds.width;
    const ny = (point.y - bounds.minY) / bounds.height;
    const grainX = (noise01(point.x + index * 5, point.y) - 0.5) * 0.12;
    const grainY = (noise01(point.y, point.x - index * 3) - 0.5) * 0.12;
    const driftX = Math.sin(ny * Math.PI * 2 + index * 0.015) * 0.035;
    const driftY = Math.cos(nx * Math.PI * 2 + index * 0.012) * 0.035;
    const px = clamp01(nx + grainX + driftX) * (canvas.width - 1);
    const py = clamp01(ny + grainY + driftY) * (canvas.height - 1);
    const sourceColor = point.sourceColor ?? point.color;
    const paintingColor = getPixel(imageData.data, canvas.width, canvas.height, px, py);
    const sourceRgb = parseRgb(sourceColor);
    const mappedColor = blendRgb(sourceRgb, paintingColor, blend);

    return {
      ...point,
      sourceColor,
      paintingColor: rgbToString(paintingColor),
      color: rgbToString(mappedColor),
      angle:
        point.angle ??
        (noise01(point.x * 0.7 + 19, point.y * 0.7 - 3) - 0.5) * Math.PI,
    };
  });
}
