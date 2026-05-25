import type { ArtworkMetadata } from "@/domain/artwork/types";

function metProxyUrl(artwork: ArtworkMetadata): string {
  const q = encodeURIComponent(artwork.query ?? `${artwork.title} ${artwork.artist}`);
  return `/api/met-painting?id=${artwork.metId ?? 0}&q=${q}`;
}

/** URL for thumbnail display (prefers small thumbnail, then full image, then Met proxy). */
export function getArtworkThumbnailUrl(artwork: ArtworkMetadata): string {
  if (artwork.thumbnail || artwork.image) return artwork.thumbnail ?? artwork.image ?? "";
  return metProxyUrl(artwork);
}

/** URL for full image loading (prefers full image, then Met proxy). */
export function getArtworkImageUrl(artwork: ArtworkMetadata): string {
  if (artwork.image) return artwork.image;
  return metProxyUrl(artwork);
}
