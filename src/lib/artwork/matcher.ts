import type { ArtworkMetadata } from "@/types/art";
import type { ImageAnalysis } from "./analyzeImage";

export type ScoreComponents = {
  palette: number;
  brightness: number;
  saturation: number;
  warmth: number;
  texture: number;
  edgeDensity: number;
  reconstructability: number;
  typeMatch: number;
};

export type ArtworkRecommendation = {
  artwork: ArtworkMetadata;
  score: number;          // 0–100
  components: ScoreComponents;
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

function typeCompatibility(analysis: ImageAnalysis, artwork: ArtworkMetadata): number {
  const rt = analysis.roughType;
  const tags = artwork.tags;
  const cat = artwork.category ?? "";
  const rec = artwork.recommendedFor ?? [];

  if (rt === "portrait-like") {
    if (cat === "portrait" || tags.includes("portrait") || tags.includes("face")) return 1;
    if (rec.includes("portrait") || rec.includes("pet")) return 0.7;
  }
  if (rt === "landscape-like") {
    if (cat === "landscape" || tags.includes("landscape")) return 1;
    if (rec.includes("landscape") || rec.includes("nature")) return 0.7;
  }
  if (rt === "high-texture") {
    if (rec.includes("high-texture") || tags.includes("expressive") || tags.includes("pattern")) return 0.8;
  }
  if (rt === "low-texture") {
    if (rec.includes("low-texture") || rec.includes("soft-source")) return 0.8;
  }
  return 0;
}

export function recommendArtworks(
  analysis: ImageAnalysis,
  artworks: ArtworkMetadata[],
  topN = 5
): ArtworkRecommendation[] {
  const scored = artworks.map((artwork) => {
    const palScore  = paletteCompatibility(analysis.dominantColors, artwork.palette);
    const briScore  = artwork.brightness != null
      ? 1 - Math.abs(analysis.averageBrightness - artwork.brightness)
      : 0.5;
    const satScore  = artwork.saturation != null
      ? 1 - Math.abs(analysis.averageSaturation - artwork.saturation)
      : 0.5;
    const warmScore = artwork.warmth != null
      ? 1 - Math.abs(analysis.warmth - artwork.warmth)
      : 0.5;
    const texScore  = artwork.complexity != null
      ? 1 - Math.abs(analysis.textureDensity - artwork.complexity)
      : 0.5;
    const edgeScore = artwork.edgeDensity != null
      ? 1 - Math.abs(analysis.edgeDensity - artwork.edgeDensity)
      : 0.5;
    const reconScore = artwork.reconstructability ?? 0.6;
    const typeScore  = typeCompatibility(analysis, artwork);

    const complexityPenalty =
      analysis.roughType === "low-texture" && (artwork.complexity ?? 0) > 0.75 ? 0.12 : 0;

    const raw =
      0.25 * palScore +
      0.13 * briScore +
      0.10 * satScore +
      0.12 * warmScore +
      0.10 * texScore +
      0.08 * edgeScore +
      0.12 * reconScore +
      0.10 * typeScore -
      complexityPenalty;

    const score = Math.round(Math.max(0, Math.min(1, raw)) * 100);

    const components: ScoreComponents = {
      palette:          Math.round(palScore * 100),
      brightness:       Math.round(briScore * 100),
      saturation:       Math.round(satScore * 100),
      warmth:           Math.round(warmScore * 100),
      texture:          Math.round(texScore * 100),
      edgeDensity:      Math.round(edgeScore * 100),
      reconstructability: Math.round(reconScore * 100),
      typeMatch:        Math.round(typeScore * 100),
    };

    const reasons: string[] = [];
    const artWarmth = paletteWarmth(artwork.palette);

    if (palScore > 0.65) {
      reasons.push(
        artWarmth > 0.55
          ? "Warm source colors match this artwork"
          : artWarmth < 0.45
          ? "Cool tones are compatible"
          : "Color palette is compatible"
      );
    }
    if (briScore > 0.82) reasons.push("Compatible brightness level");
    if (satScore > 0.82) reasons.push("Matching color intensity");
    if (warmScore > 0.82) {
      reasons.push(analysis.warmth > 0.55 ? "Warm tone matches artwork" : "Cool tone matches artwork");
    }
    if (texScore > 0.75) reasons.push("Target complexity suits source texture");
    if (edgeScore > 0.80) reasons.push("Strong edge structure should remain readable");
    if (reconScore > 0.72) reasons.push("High reconstructability for this source type");
    if (typeScore > 0) {
      const rt = analysis.roughType;
      const label =
        rt === "portrait-like"  ? "Portrait-like" :
        rt === "landscape-like" ? "Landscape-like" :
        rt === "high-texture"   ? "High-texture" :
                                  "Low-texture";
      reasons.push(`${label} composition may transfer well`);
    }
    if (reasons.length === 0) reasons.push("Stylistically compatible");

    return { artwork, score, components, reasons };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
