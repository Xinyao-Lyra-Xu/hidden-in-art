import type { ArtworkMetadata } from "@/domain/artwork/types";
import {
  computeHistogram,
  histogramFromPalette,
  bhattacharyyaDistance,
} from "@/domain/image/histogram";

export type HistogramRecommendation = {
  artwork: ArtworkMetadata;
  score: number;       // 0–100
  distance: number;    // raw Bhattacharyya distance (lower = better)
};

function getPixelsFromImage(img: HTMLImageElement): {
  data: Uint8ClampedArray;
} {
  const maxDim = 200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

export function recommendByHistogram(
  userImage: HTMLImageElement,
  artworks: ArtworkMetadata[],
  topN = 5,
): HistogramRecommendation[] {
  const { data } = getPixelsFromImage(userImage);
  const userHist = computeHistogram(data);

  const scored = artworks.map((artwork) => {
    const artHist = histogramFromPalette(artwork.palette);
    const distance = bhattacharyyaDistance(userHist, artHist);
    // Convert distance to 0–100 score (distance ~0 = 100, distance ~1 = 0)
    const score = Math.round(Math.max(0, Math.min(100, (1 - distance) * 100)));
    return { artwork, score, distance };
  });

  return scored.sort((a, b) => a.distance - b.distance).slice(0, topN);
}
