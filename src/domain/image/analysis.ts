// Image analysis runs in the browser — canvas is used to sample pixel data.
// The math (Sobel filter, HSL conversion, color quantization) is pure domain logic.

export type ImageAnalysis = {
  dominantColors:   string[];
  averageBrightness: number;  // [0,1]
  averageSaturation: number;  // [0,1]
  edgeDensity:      number;   // [0,1] global Sobel edges
  textureDensity:   number;   // [0,1] local luminance variance
  contrast:         number;   // [0,1]
  warmth:           number;   // [0,1]
  roughType: "portrait-like" | "landscape-like" | "high-texture" | "low-texture" | "unknown";
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

function computeTextureDensity(data: Uint8ClampedArray, W: number, H: number): number {
  const GRID = 8;
  const cw = Math.max(1, Math.floor(W / GRID));
  const ch = Math.max(1, Math.floor(H / GRID));
  let totalStdDev = 0, cells = 0;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = gx * cw, y0 = gy * ch;
      const x1 = Math.min(W, x0 + cw), y1 = Math.min(H, y0 + ch);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          cnt++;
        }
      if (cnt === 0) continue;
      const mean = sum / cnt;
      let variance = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          variance += (lum - mean) ** 2;
        }
      totalStdDev += Math.sqrt(variance / cnt);
      cells++;
    }
  }

  return Math.min(1, (totalStdDev / cells) / 0.18);
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

    const br = Math.floor(r / 32) * 32;
    const bg = Math.floor(g / 32) * 32;
    const bb = Math.floor(b / 32) * 32;
    colorBuckets.set(`${br},${bg},${bb}`, (colorBuckets.get(`${br},${bg},${bb}`) ?? 0) + 1);
  }

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

  const averageBrightness = totalBrightness / pixels;
  const averageSaturation = totalSaturation / pixels;
  const warmth = Math.max(0, Math.min(1, (totalWarmth / pixels + 1) / 2));
  const edgeDensity = Math.min(1, (edgeSum / edgeSamples) / 0.45);
  const contrast = maxLum - minLum;
  const textureDensity = computeTextureDensity(data, W, H);

  const dominantColors = [...colorBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => {
      const [r, g, b] = key.split(",").map(Number);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    });

  const aspectRatio = img.naturalWidth / img.naturalHeight;
  const centralContrast = getCentralVsEdgeContrast(data, W, H);

  let roughType: ImageAnalysis["roughType"] = "unknown";
  if (edgeDensity > 0.75) {
    roughType = "high-texture";
  } else if (edgeDensity < 0.25 && textureDensity < 0.30) {
    roughType = "low-texture";
  } else if (aspectRatio < 0.95 && centralContrast > 0.12) {
    roughType = "portrait-like";
  } else if (aspectRatio > 1.5) {
    roughType = "landscape-like";
  } else if (centralContrast > 0.15) {
    roughType = "portrait-like";
  }

  return { dominantColors, averageBrightness, averageSaturation, edgeDensity, textureDensity, contrast, warmth, roughType };
}
