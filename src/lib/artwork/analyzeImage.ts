export type ImageAnalysis = {
  dominantColors: string[];
  avgBrightness: number;
  avgSaturation: number;
  edgeDensity: number;
  contrast: number;
  warmth: number;
  imageType: "portrait" | "landscape" | "abstract" | "unknown";
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function getCentralVsEdgeContrast(data: Uint8ClampedArray, W: number, H: number): number {
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * 0.28;
  let centralSum = 0, centralCount = 0;
  let edgeLumSum = 0, edgeCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) {
        centralSum += lum; centralCount++;
      } else if (x < 4 || x >= W - 4 || y < 4 || y >= H - 4) {
        edgeLumSum += lum; edgeCount++;
      }
    }
  }

  if (centralCount === 0 || edgeCount === 0) return 0;
  return Math.abs(centralSum / centralCount - edgeLumSum / edgeCount);
}

export function analyzeImage(img: HTMLImageElement): ImageAnalysis {
  const maxDim = 200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  let totalBrightness = 0, totalSaturation = 0, totalWarmth = 0;
  let minLum = 1, maxLum = 0;
  const colorBuckets = new Map<string, number>();
  const pixels = W * H;

  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const [, s, l] = rgbToHsl(r, g, b);
    totalBrightness += l;
    totalSaturation += s;
    totalWarmth += (r - b) / 255;
    if (l < minLum) minLum = l;
    if (l > maxLum) maxLum = l;

    // quantize to 32-step RGB buckets for dominant color extraction
    const br = Math.floor(r / 32) * 32;
    const bg = Math.floor(g / 32) * 32;
    const bb = Math.floor(b / 32) * 32;
    const key = `${br},${bg},${bb}`;
    colorBuckets.set(key, (colorBuckets.get(key) ?? 0) + 1);
  }

  // Sobel edge detection sampled every 2 pixels
  let edgeSum = 0, edgeSamples = 0;
  const lum = (x: number, y: number) => {
    const idx = (y * W + x) * 4;
    return (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
  };
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      const gx =
        -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1) +
         lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
         lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      edgeSamples++;
    }
  }

  const avgBrightness = totalBrightness / pixels;
  const avgSaturation = totalSaturation / pixels;
  const warmth = Math.max(0, Math.min(1, (totalWarmth / pixels + 1) / 2));
  const edgeDensity = Math.min(1, (edgeSum / edgeSamples) / 0.45);
  const contrast = maxLum - minLum;

  const dominantColors = [...colorBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => {
      const [r, g, b] = key.split(",").map(Number);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    });

  const aspectRatio = img.naturalWidth / img.naturalHeight;
  const centralContrast = getCentralVsEdgeContrast(data, W, H);

  let imageType: ImageAnalysis["imageType"] = "unknown";
  if (edgeDensity > 0.75) {
    imageType = "abstract";
  } else if (aspectRatio < 0.95 && centralContrast > 0.12) {
    imageType = "portrait";
  } else if (aspectRatio > 1.5) {
    imageType = "landscape";
  } else if (centralContrast > 0.15) {
    imageType = "portrait";
  }

  return { dominantColors, avgBrightness, avgSaturation, edgeDensity, contrast, warmth, imageType };
}
