// Spatial Color Histogram (Spatial Pyramid Matching level-1).
// Divides the image into a GRID×GRID grid, computes a color histogram
// per cell. The resulting feature vector captures *where* colors appear —
// the same information CNN early layers learn, without the network.
//
// Result: GRID² × BINS × 3 dimensions (default 4×4×16×3 = 768 dims).

export const GRID = 4;
export const SPATIAL_BINS = 16; // per channel per cell
export const SPATIAL_DIM = GRID * GRID * SPATIAL_BINS * 3;

export type SpatialFeature = Float32Array; // length = SPATIAL_DIM

function cellBin(channel: number, cellIdx: number, value: number): number {
  const channelOffset = channel * GRID * GRID * SPATIAL_BINS;
  const cellOffset    = cellIdx * SPATIAL_BINS;
  const bin           = Math.min(SPATIAL_BINS - 1, Math.floor((value / 256) * SPATIAL_BINS));
  return channelOffset + cellOffset + bin;
}

export function computeSpatialFeatures(
  imageData: Uint8ClampedArray,
  W: number,
  H: number,
): SpatialFeature {
  const feat = new Float32Array(SPATIAL_DIM);
  const cellCounts = new Float64Array(GRID * GRID);

  for (let y = 0; y < H; y++) {
    const cy = Math.min(GRID - 1, Math.floor((y / H) * GRID));
    for (let x = 0; x < W; x++) {
      const cx  = Math.min(GRID - 1, Math.floor((x / W) * GRID));
      const ci  = cy * GRID + cx;
      const idx = (y * W + x) * 4;
      feat[cellBin(0, ci, imageData[idx])]++;
      feat[cellBin(1, ci, imageData[idx + 1])]++;
      feat[cellBin(2, ci, imageData[idx + 2])]++;
      cellCounts[ci]++;
    }
  }

  // Normalize each cell independently so every cell has equal weight
  for (let ci = 0; ci < GRID * GRID; ci++) {
    const cnt = cellCounts[ci];
    if (cnt === 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      const base = ch * GRID * GRID * SPATIAL_BINS + ci * SPATIAL_BINS;
      for (let b = 0; b < SPATIAL_BINS; b++) {
        feat[base + b] /= cnt;
      }
    }
  }

  return feat;
}

export function spatialFeaturesFromPalette(palette: string[]): SpatialFeature {
  // Without spatial layout information, distribute palette colors uniformly
  // across cells. This is a rough approximation but keeps the vector space consistent.
  const feat = new Float32Array(SPATIAL_DIM);
  if (palette.length === 0) return feat;
  const w = 1 / palette.length;
  for (const hex of palette) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let ci = 0; ci < GRID * GRID; ci++) {
      feat[cellBin(0, ci, r)] += w;
      feat[cellBin(1, ci, g)] += w;
      feat[cellBin(2, ci, b)] += w;
    }
  }
  // Normalize to unit sum per channel per cell
  for (let ci = 0; ci < GRID * GRID; ci++) {
    for (let ch = 0; ch < 3; ch++) {
      const base = ch * GRID * GRID * SPATIAL_BINS + ci * SPATIAL_BINS;
      let sum = 0;
      for (let b = 0; b < SPATIAL_BINS; b++) sum += feat[base + b];
      if (sum > 0) for (let b = 0; b < SPATIAL_BINS; b++) feat[base + b] /= sum;
    }
  }
  return feat;
}

export function cosineSimilarity(a: SpatialFeature, b: SpatialFeature): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
