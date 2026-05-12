import type { ArtworkMetadata } from "@/types/art";
import type { ImageAnalysis } from "./analyzeImage";

export type ArtworkRecommendation = {
  artwork: ArtworkMetadata;
  score: number;
  reasons: string[];
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.67;
}

function paletteCompatibility(userColors: string[], artPalette: string[]): number {
  if (userColors.length === 0 || artPalette.length === 0) return 0.5;
  let total = 0;
  for (const uc of userColors) {
    total += Math.min(...artPalette.map((ac) => colorDistance(uc, ac)));
  }
  return 1 - total / userColors.length;
}

function paletteWarmth(palette: string[]): number {
  if (palette.length === 0) return 0.5;
  let sum = 0;
  for (const hex of palette) {
    const [r, , b] = hexToRgb(hex);
    sum += (r - b) / 255;
  }
  return Math.max(0, Math.min(1, (sum / palette.length + 1) / 2));
}

export function recommendArtworks(
  analysis: ImageAnalysis,
  artworks: ArtworkMetadata[],
  topN = 3
): ArtworkRecommendation[] {
  const scored = artworks.map((artwork) => {
    const reasons: string[] = [];

    const palScore = paletteCompatibility(analysis.dominantColors, artwork.palette);
    const briScore = 1 - Math.abs(analysis.avgBrightness - artwork.brightness);
    const satScore = 1 - Math.abs(analysis.avgSaturation - artwork.saturation);
    const texScore = 1 - Math.abs(analysis.edgeDensity - artwork.complexity);

    let typeScore = 0;
    if (
      (analysis.imageType === "portrait" && (artwork.tags.includes("portrait") || artwork.tags.includes("face"))) ||
      (analysis.imageType === "landscape" && artwork.tags.includes("landscape"))
    ) {
      typeScore = 1;
    }

    const score =
      0.35 * palScore +
      0.2 * briScore +
      0.2 * satScore +
      0.15 * texScore +
      0.1 * typeScore;

    const artWarmth = paletteWarmth(artwork.palette);
    if (palScore > 0.62) {
      const warmLabel = artWarmth > 0.55 ? "warm " : artWarmth < 0.45 ? "cool " : "";
      reasons.push(`similar ${warmLabel}palette`);
    }
    if (briScore > 0.78) reasons.push("compatible brightness");
    if (satScore > 0.78) reasons.push("matching saturation");
    if (texScore > 0.75) reasons.push("good texture density");
    if (typeScore > 0) reasons.push(`${analysis.imageType}-like target`);
    if (reasons.length === 0) reasons.push("stylistically compatible");

    return { artwork, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
