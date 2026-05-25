import type { ArtworkMetadata } from "@/domain/artwork/types";

export const HISTORY_KEY = "hidden-in-art-history-v1";
export const HISTORY_MAX = 12;

export type HistoryItem = {
  key: string;
  photoThumb: string;
  artworkId?: string;
  artworkTitle: string;
  artworkArtist: string;
  artworkImage: string;
  artwork?: ArtworkMetadata;
  createdAt: number;
};

export function buildHistoryItem(
  artwork: ArtworkMetadata,
  photoThumb: string,
  photoKey: string,
): HistoryItem {
  const q = encodeURIComponent(artwork.query ?? `${artwork.title} ${artwork.artist}`);
  return {
    key: `${photoKey}-${artwork.id}`,
    photoThumb,
    artworkId: artwork.id,
    artworkTitle: artwork.title,
    artworkArtist: artwork.artist,
    artworkImage: artwork.image || `/api/met-painting?id=${artwork.metId ?? 0}&q=${q}`,
    artwork,
    createdAt: 0,
  };
}

export function addToHistory(prev: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...prev.filter((x) => x.key !== item.key)].slice(0, HISTORY_MAX);
}

export function resolveArtworkFromHistory(
  item: HistoryItem,
  artworks: ArtworkMetadata[],
): ArtworkMetadata {
  const found = artworks.find((a) =>
    a.id === item.artworkId ||
    (a.title === item.artworkTitle && a.artist === item.artworkArtist)
  );
  if (found) return found;
  if (item.artwork) return item.artwork;
  return {
    id: item.artworkId ?? `history-${item.key}`,
    title: item.artworkTitle,
    artist: item.artworkArtist,
    image: item.artworkImage,
    tags: [],
    palette: [],
  };
}

export function loadHistoryFromStorage(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveHistoryToStorage(items: HistoryItem[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Ignore private-mode or storage quota failures; history is a nice-to-have.
  }
}
