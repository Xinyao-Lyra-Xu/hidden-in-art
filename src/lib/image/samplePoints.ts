import type { ArtPoint, RenderSettings } from "@/types/art";

function rgbToString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function sampleImagePoints(
  image: HTMLImageElement,
  settings: RenderSettings
): ArtPoint[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) return [];

  const maxSize = 900;
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);

  canvas.width = Math.floor(image.width * scale);
  canvas.height = Math.floor(image.height * scale);

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const points: ArtPoint[] = [];
  const count = Math.floor(settings.pointDensity);

  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * canvas.width);
    const y = Math.floor(Math.random() * canvas.height);
    const index = (y * canvas.width + x) * 4;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    const brightness = (r + g + b) / 3;

    const radius =
      1.5 + (1 - settings.abstraction / 100) * 3 + Math.random() * 2.5;

    points.push({
      x,
      y,
      r: radius,
      color: rgbToString(r, g, b),
      alpha: brightness < 245 ? 0.45 + Math.random() * 0.4 : 0.15,
    });
  }

  return points;
}