// Color histogram: 32 bins per channel (R, G, B) = 96-element vector.
// Artwork histograms are approximated from their palette.

export const BINS = 32;
export type ColorHistogram = Float32Array; // length = BINS * 3

function binIndex(channel: number, value: number): number {
  return channel * BINS + Math.min(BINS - 1, Math.floor((value / 256) * BINS));
}

export function computeHistogram(imageData: Uint8ClampedArray): ColorHistogram {
  const hist = new Float32Array(BINS * 3);
  const pixels = imageData.length / 4;
  for (let i = 0; i < imageData.length; i += 4) {
    hist[binIndex(0, imageData[i])]++;
    hist[binIndex(1, imageData[i + 1])]++;
    hist[binIndex(2, imageData[i + 2])]++;
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= pixels;
  return hist;
}

export function histogramFromPalette(palette: string[]): ColorHistogram {
  const hist = new Float32Array(BINS * 3);
  if (palette.length === 0) return hist;
  const w = 1 / palette.length;
  for (const hex of palette) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    hist[binIndex(0, r)] += w;
    hist[binIndex(1, g)] += w;
    hist[binIndex(2, b)] += w;
  }
  return hist;
}

// Bhattacharyya distance: lower = more similar. Range [0, ∞), practically [0, ~1].
export function bhattacharyyaDistance(a: ColorHistogram, b: ColorHistogram): number {
  let bc = 0;
  for (let i = 0; i < a.length; i++) {
    bc += Math.sqrt(a[i] * b[i]);
  }
  return bc === 0 ? 1 : -Math.log(bc);
}
