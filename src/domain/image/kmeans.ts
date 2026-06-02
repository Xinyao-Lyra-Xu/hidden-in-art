// K-Means++ color clustering.
// Returns dominant colors sorted by cluster weight (largest first).

export type KMeansColor = {
  r: number;
  g: number;
  b: number;
  weight: number; // fraction of sampled pixels in this cluster
  hex: string;
};

function kppInit(pixels: Float32Array, n: number, k: number): Float32Array {
  const centroids = new Float32Array(k * 3);
  const first = Math.floor(Math.random() * n);
  centroids[0] = pixels[first * 3];
  centroids[1] = pixels[first * 3 + 1];
  centroids[2] = pixels[first * 3 + 2];

  const dists = new Float64Array(n);

  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (let j = 0; j < c; j++) {
        const dr = pixels[i * 3] - centroids[j * 3];
        const dg = pixels[i * 3 + 1] - centroids[j * 3 + 1];
        const db = pixels[i * 3 + 2] - centroids[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < minD) minD = d;
      }
      dists[i] = minD;
      total += minD;
    }
    let r = Math.random() * total;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = i; break; }
    }
    centroids[c * 3]     = pixels[chosen * 3];
    centroids[c * 3 + 1] = pixels[chosen * 3 + 1];
    centroids[c * 3 + 2] = pixels[chosen * 3 + 2];
  }
  return centroids;
}

export function kmeansColors(
  imageData: Uint8ClampedArray,
  k = 8,
  maxIter = 25,
  sampleFraction = 0.05,
): KMeansColor[] {
  const totalPixels = imageData.length / 4;
  const step = Math.max(1, Math.floor(1 / sampleFraction));
  const n = Math.ceil(totalPixels / step);

  const pixels = new Float32Array(n * 3);
  for (let i = 0, pi = 0; i < totalPixels; i += step, pi++) {
    pixels[pi * 3]     = imageData[i * 4];
    pixels[pi * 3 + 1] = imageData[i * 4 + 1];
    pixels[pi * 3 + 2] = imageData[i * 4 + 2];
  }

  const clampedK = Math.min(k, n);
  const centroids = kppInit(pixels, n, clampedK);
  const assignments = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < clampedK; j++) {
        const dr = pixels[i * 3] - centroids[j * 3];
        const dg = pixels[i * 3 + 1] - centroids[j * 3 + 1];
        const db = pixels[i * 3 + 2] - centroids[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    if (!changed && iter > 0) break;

    const sums = new Float64Array(clampedK * 4); // r,g,b,count
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c * 4]     += pixels[i * 3];
      sums[c * 4 + 1] += pixels[i * 3 + 1];
      sums[c * 4 + 2] += pixels[i * 3 + 2];
      sums[c * 4 + 3]++;
    }
    for (let j = 0; j < clampedK; j++) {
      const cnt = sums[j * 4 + 3];
      if (cnt > 0) {
        centroids[j * 3]     = sums[j * 4] / cnt;
        centroids[j * 3 + 1] = sums[j * 4 + 1] / cnt;
        centroids[j * 3 + 2] = sums[j * 4 + 2] / cnt;
      }
    }
  }

  const counts = new Float64Array(clampedK);
  for (let i = 0; i < n; i++) counts[assignments[i]]++;

  return Array.from({ length: clampedK }, (_, j) => {
    const r = Math.round(Math.max(0, Math.min(255, centroids[j * 3])));
    const g = Math.round(Math.max(0, Math.min(255, centroids[j * 3 + 1])));
    const b = Math.round(Math.max(0, Math.min(255, centroids[j * 3 + 2])));
    return {
      r, g, b,
      weight: counts[j] / n,
      hex: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
    };
  }).sort((a, b) => b.weight - a.weight);
}
