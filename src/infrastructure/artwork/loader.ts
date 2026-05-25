import type { ArtworkMetadata } from "@/domain/artwork/types";
import { validateArtworkMetadata } from "@/domain/artwork/validate";

export type LoadArtworksResult = {
  artworks: ArtworkMetadata[];
  warnings: string[];
  error: string | null;
};

// famous-paintings.json is the primary curated library.
// met.metadata.json is populated by `npm run build:paintings`.
// metadata.json is the legacy hand-crafted file kept for fallback.
const METADATA_FILES = [
  "/artworks/famous-paintings.json",
  "/artworks/met.metadata.json",
  "/artworks/metadata.json",
] as const;

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadLocalArtworks(): Promise<LoadArtworksResult> {
  const allWarnings: string[] = [];
  const seen = new Set<string>();
  const artworks: ArtworkMetadata[] = [];

  const results = await Promise.all(METADATA_FILES.map(tryFetchJson));

  for (let i = 0; i < METADATA_FILES.length; i++) {
    const raw = results[i];
    if (raw === null) continue;

    const { valid, warnings } = validateArtworkMetadata(raw);
    allWarnings.push(...warnings.map((w) => `[${METADATA_FILES[i]}] ${w}`));

    for (const artwork of valid) {
      if (!seen.has(artwork.id)) {
        seen.add(artwork.id);
        artworks.push(artwork);
      }
    }
  }

  if (artworks.length === 0) {
    return {
      artworks: [],
      warnings: allWarnings,
      error: "No artworks loaded. Run 'npm run build:paintings' to expand the library.",
    };
  }

  return { artworks, warnings: allWarnings, error: null };
}
