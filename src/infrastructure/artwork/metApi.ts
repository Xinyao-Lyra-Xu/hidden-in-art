// Met Museum API client — used by build scripts (npm run build:paintings), not the browser bundle.

import type { ArtworkMetadata } from "@/domain/artwork/types";

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "hidden-in-art-local-importer/0.1",
};

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);

type MetSearchResponse = {
  total: number;
  objectIDs: number[] | null;
};

type MetObject = {
  objectID: number;
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  department: string;
  objectName: string;
  title: string;
  artistDisplayName: string;
  artistNationality: string;
  objectDate: string;
  classification: string;
  medium: string;
  objectURL: string;
  tags?: Array<{ term: string }> | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  retries = 3,
  initialDelay = 1000
): Promise<Response> {
  let delay = initialDelay;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: REQUEST_HEADERS });
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  [met] Network error — retrying in ${delay}ms: ${(err as Error).message}`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
    if (res.ok) return res;
    if (RETRYABLE.has(res.status) && attempt < retries) {
      console.warn(`  [met] HTTP ${res.status} — retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
      continue;
    }
    return res;
  }
  throw new Error("fetchWithRetry: unreachable");
}

const ARTWORK_PATTERN =
  /paint|drawing|print|watercolor|gouache|pastel|sketch|illustrat|litho|etch|engrav|woodcut|miniature|photograph|tempera|fresco/i;

function isArtworkObject(obj: MetObject): boolean {
  const combined = `${obj.classification} ${obj.objectName} ${obj.medium}`;
  return ARTWORK_PATTERN.test(combined);
}

function inferCategory(obj: MetObject): string {
  const combined = `${obj.classification} ${obj.objectName} ${obj.medium}`.toLowerCase();
  if (/portrait|figure|person|face/.test(combined) || /portrait/i.test(obj.title)) return "portrait";
  if (/landscape|scene|view|garden|nature|coast|mountain|sea|river/.test(combined)) return "landscape";
  if (/abstract|geometry|pattern|composition/.test(combined)) return "abstract";
  return "painting";
}

function inferTags(obj: MetObject): string[] {
  const tags: string[] = [];
  const title = obj.title.toLowerCase();
  const med   = obj.medium.toLowerCase();
  const dept  = obj.department.toLowerCase();

  if (/portrait|figure|person|face|woman|man|child|mother|father/.test(title)) tags.push("portrait");
  if (/landscape|garden|park|river|mountain|coast|sea|lake|forest|field/.test(title)) tags.push("landscape");
  if (/flower|blossom|bouquet|rose|lily|tulip/.test(title)) tags.push("flowers");
  if (/night|dark|twilight|dusk/.test(title)) tags.push("night");
  if (/water|rain|sea|ocean|river|lake|pond/.test(title)) tags.push("water");
  if (/oil/.test(med)) tags.push("oil");
  if (/watercolor/.test(med)) tags.push("watercolor");
  if (/european|french|dutch|italian|spanish|german|flemish/.test(dept)) tags.push("european");
  if (obj.tags) {
    for (const t of obj.tags) {
      const term = t.term.toLowerCase().replace(/\s+/g, "-");
      if (!tags.includes(term)) tags.push(term);
    }
  }
  return tags;
}

function mapMetObject(obj: MetObject): ArtworkMetadata {
  const image = obj.primaryImageSmall || obj.primaryImage;
  return {
    id:        `met-${obj.objectID}`,
    title:     obj.title,
    artist:    obj.artistDisplayName || "Unknown artist",
    image,
    thumbnail: obj.primaryImageSmall || undefined,
    year:      obj.objectDate || undefined,
    publicDomain: true,
    category:  inferCategory(obj),
    tags:      inferTags(obj),
    palette:   [],
    reconstructability: 0.6,
    source:    "met",
    sourceUrl: obj.objectURL || undefined,
    metId:     obj.objectID,
    query:     obj.title,
  };
}

export async function searchMetObjectIds(query: string): Promise<number[]> {
  const url = `${MET_BASE}/search?q=${encodeURIComponent(query)}&isPublicDomain=true&hasImages=true`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Met search failed HTTP ${res.status} for "${query}"`);
  const data = (await res.json()) as MetSearchResponse;
  return data.objectIDs ?? [];
}

export const searchMetArtworks = searchMetObjectIds;

export async function getMetObject(objectID: number): Promise<MetObject | null> {
  try {
    const res = await fetchWithRetry(`${MET_BASE}/objects/${objectID}`);
    if (!res.ok) { console.warn(`  [met] Skipping ${objectID}: HTTP ${res.status}`); return null; }
    return (await res.json()) as MetObject;
  } catch (err) {
    console.warn(`  [met] Skipping ${objectID}: ${(err as Error).message}`);
    return null;
  }
}

const OBJECT_FETCH_DELAY = 200;

export async function importMetArtworks(
  query: string,
  limit = 20,
  onProgress?: (fetched: number, accepted: number, total: number) => void
): Promise<ArtworkMetadata[]> {
  const allIds    = await searchMetObjectIds(query);
  const candidates = allIds.slice(0, Math.min(allIds.length, limit * 6));
  const results: ArtworkMetadata[] = [];

  for (let i = 0; i < candidates.length && results.length < limit; i++) {
    const obj = await getMetObject(candidates[i]);
    onProgress?.(i + 1, results.length, candidates.length);

    if (!obj) { await sleep(OBJECT_FETCH_DELAY); continue; }

    if (
      obj.isPublicDomain &&
      (obj.primaryImageSmall || obj.primaryImage) &&
      obj.title?.trim() &&
      isArtworkObject(obj)
    ) {
      results.push(mapMetObject(obj));
    }

    if (i + 1 < candidates.length && results.length < limit) {
      await sleep(OBJECT_FETCH_DELAY);
    }
  }

  return results;
}
