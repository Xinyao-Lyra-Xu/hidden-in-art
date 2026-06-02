import type { ArtworkMetadata } from "@/domain/artwork/types";
import {
  computeSpatialFeatures,
  spatialFeaturesFromPalette,
  cosineSimilarity,
} from "@/domain/image/spatialFeatures";

export type SpatialRecommendation = {
  artwork: ArtworkMetadata;
  score: number;      // 0–100
  similarity: number; // raw cosine similarity [0,1]
};

function getImageData(img: HTMLImageElement): { data: Uint8ClampedArray; W: number; H: number } {
  const maxDim = 200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d")!.drawImage(img, 0, 0, W, H);
  const data = canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
  return { data, W, H };
}

export function recommendBySpatial(
  userImage: HTMLImageElement,
  artworks: ArtworkMetadata[],
  topN = 5,
): SpatialRecommendation[] {
  const { data, W, H } = getImageData(userImage);
  const userFeat = computeSpatialFeatures(data, W, H);

  const scored = artworks.map((artwork) => {
    const artFeat = spatialFeaturesFromPalette(artwork.palette);
    const similarity = cosineSimilarity(userFeat, artFeat);
    return {
      artwork,
      score: Math.round(Math.max(0, Math.min(100, similarity * 100))),
      similarity,
    };
  });

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}
