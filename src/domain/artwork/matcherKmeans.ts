import type { ArtworkMetadata } from "@/domain/artwork/types";
import { kmeansColors } from "@/domain/image/kmeans";

export type KMeansRecommendation = {
  artwork: ArtworkMetadata;
  score: number;    // 0–100
  paletteScore: number;
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Weighted palette similarity: for each user K-Means cluster,
// find the closest artwork palette color. Weight by cluster size.
function weightedPaletteMatch(
  userColors: { r: number; g: number; b: number; weight: number }[],
  artPalette: string[],
): number {
  if (userColors.length === 0 || artPalette.length === 0) return 0.5;
  const artRgb = artPalette.map(hexToRgb);
  let totalScore = 0;
  for (const uc of userColors) {
    let minDist = Infinity;
    for (const [r, g, b] of artRgb) {
      const d = Math.sqrt((uc.r - r) ** 2 + (uc.g - g) ** 2 + (uc.b - b) ** 2) / 441.67;
      if (d < minDist) minDist = d;
    }
    totalScore += (1 - minDist) * uc.weight;
  }
  return Math.max(0, Math.min(1, totalScore));
}

function getImagePixels(img: HTMLImageElement): Uint8ClampedArray {
  const maxDim = 200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H).data;
}

export function recommendByKmeans(
  userImage: HTMLImageElement,
  artworks: ArtworkMetadata[],
  topN = 5,
): KMeansRecommendation[] {
  const pixels = getImagePixels(userImage);
  const userColors = kmeansColors(pixels, 8);

  const scored = artworks.map((artwork) => {
    const paletteScore = weightedPaletteMatch(userColors, artwork.palette);

    // Also factor in brightness/saturation/warmth from metadata if available
    // (K-Means tells us color identity; metadata tells us tonal character)
    let extraScore = 0.5;
    if (artwork.brightness != null || artwork.saturation != null || artwork.warmth != null) {
      const samples = userColors.slice(0, 5);
      let avgL = 0, avgS = 0, avgWarmth = 0;
      for (const { r, g, b } of samples) {
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        avgL += (max + min) / 2;
        const d = max - min;
        const l = (max + min) / 2;
        avgS += d === 0 ? 0 : d / (l > 0.5 ? 2 - max - min : max + min);
        avgWarmth += (r - b) / 255;
      }
      const n = samples.length;
      avgL /= n; avgS /= n;
      const warmth = Math.max(0, Math.min(1, (avgWarmth / n + 1) / 2));

      let terms = 0, sum = 0;
      if (artwork.brightness != null) { sum += 1 - Math.abs(avgL - artwork.brightness); terms++; }
      if (artwork.saturation != null) { sum += 1 - Math.abs(avgS - artwork.saturation); terms++; }
      if (artwork.warmth != null)     { sum += 1 - Math.abs(warmth - artwork.warmth);   terms++; }
      if (terms > 0) extraScore = sum / terms;
    }

    const raw = 0.70 * paletteScore + 0.30 * extraScore;
    return {
      artwork,
      score: Math.round(Math.max(0, Math.min(100, raw * 100))),
      paletteScore: Math.round(paletteScore * 100),
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
