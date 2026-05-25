/**
 * Expands the painting library from The Met Open Access API.
 *
 * Usage:
 *   npm run build:paintings
 *
 * Requires `sharp` for image analysis:
 *   npm install sharp @types/sharp --save-dev
 *
 * Without sharp, paintings are saved without visual metadata
 * (palette, brightness, etc.) and will still appear in the UI
 * but won't influence colour-based matching.
 */

import * as fs from "fs";
import * as path from "path";
import { importMetArtworks } from "../src/infrastructure/artwork/metApi";
import type { ArtworkMetadata } from "../src/domain/artwork/types";

const OUT_PATH = path.join(process.cwd(), "public", "artworks", "met.metadata.json");

// Diverse queries so the library covers many styles and subjects
const QUERIES = [
  "impressionism painting",
  "portrait woman oil painting",
  "landscape nature painting",
  "still life flowers painting",
  "seascape ocean waves painting",
  "japanese woodblock print",
  "dutch golden age painting",
  "american landscape 19th century",
  "baroque portrait painting",
  "religious scene renaissance painting",
];

const LIMIT_PER_QUERY = 20;

// ── Optional sharp-based visual metadata ─────────────────────────────────────

type VisualMeta = {
  palette: string[];
  brightness: number;
  saturation: number;
  warmth: number;
  complexity: number;
  edgeDensity: number;
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

async function computeVisualMeta(imageUrl: string): Promise<VisualMeta | null> {
  let sharp: typeof import("sharp") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharp = require("sharp");
  } catch {
    return null;
  }

  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "hidden-in-art-builder/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());

    const { data, info } = await sharp!(buf)
      .resize(80, 80, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = info.width * info.height;
    const buckets = new Map<string, number>();
    let totalBrightness = 0, totalSat = 0, totalWarmth = 0;

    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [, s, l] = rgbToHsl(r, g, b);
      totalBrightness += l;
      totalSat += s;
      totalWarmth += (r - b) / 255;
      const br = Math.floor(r / 32) * 32;
      const bg = Math.floor(g / 32) * 32;
      const bb = Math.floor(b / 32) * 32;
      const key = `${br},${bg},${bb}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const palette = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key]) => {
        const [r, g, b] = key.split(",").map(Number);
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      });

    // Simple edge density: average |diff| between adjacent pixels
    let edgeSum = 0;
    const W = info.width, H = info.height;
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const i = (y * W + x) * 3;
        const ir = i + 3;
        const ib = i + W * 3;
        const dr = (Math.abs(data[i] - data[ir]) + Math.abs(data[i + 1] - data[ir + 1]) + Math.abs(data[i + 2] - data[ir + 2])) / (3 * 255);
        const db = (Math.abs(data[i] - data[ib]) + Math.abs(data[i + 1] - data[ib + 1]) + Math.abs(data[i + 2] - data[ib + 2])) / (3 * 255);
        edgeSum += (dr + db) / 2;
      }
    }
    const edgeDensity = Math.min(1, edgeSum / ((W - 1) * (H - 1)) / 0.12);

    return {
      palette,
      brightness: Math.round((totalBrightness / pixels) * 100) / 100,
      saturation: Math.round((totalSat / pixels) * 100) / 100,
      warmth:     Math.round(Math.max(0, Math.min(1, (totalWarmth / pixels + 1) / 2)) * 100) / 100,
      complexity: Math.round(edgeDensity * 100) / 100,
      edgeDensity: Math.round(edgeDensity * 100) / 100,
    };
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readExisting(): ArtworkMetadata[] {
  if (!fs.existsSync(OUT_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8")) as unknown;
    return Array.isArray(raw) ? (raw as ArtworkMetadata[]) : [];
  } catch {
    return [];
  }
}

function writeFile(entries: ArtworkMetadata[]): void {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const tmp = OUT_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf-8");
  fs.renameSync(tmp, OUT_PATH);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let sharpAvailable = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("sharp");
    sharpAvailable = true;
    console.log("[build] sharp detected — will compute visual metadata (palette, brightness, etc.)");
  } catch {
    console.warn("[build] sharp not found — paintings will be saved without visual metadata.");
    console.warn("[build] Run: npm install sharp @types/sharp --save-dev");
  }

  const existing = readExisting();
  const accumulated = new Map<string, ArtworkMetadata>(existing.map((e) => [e.id, e]));
  let totalNew = 0;

  for (const query of QUERIES) {
    console.log(`\n[build] Query "${query}" — importing up to ${LIMIT_PER_QUERY} paintings...`);
    let imported: ArtworkMetadata[] = [];
    try {
      imported = await importMetArtworks(query, LIMIT_PER_QUERY, (fetched: number, accepted: number, total: number) => {
        process.stdout.write(`\r  ${fetched}/${total} fetched, ${accepted} accepted   `);
      });
      process.stdout.write("\n");
    } catch (err) {
      console.error(`[build] Query "${query}" failed: ${(err as Error).message} — skipping.`);
      continue;
    }

    let newForQuery = 0;
    for (const artwork of imported) {
      if (accumulated.has(artwork.id)) continue;

      // Optionally enrich with visual metadata from the image
      if (sharpAvailable && artwork.thumbnail) {
        process.stdout.write(`  Analysing ${artwork.id}...`);
        const visual = await computeVisualMeta(artwork.thumbnail);
        if (visual) {
          artwork.palette         = visual.palette;
          artwork.brightness      = visual.brightness;
          artwork.saturation      = visual.saturation;
          artwork.warmth          = visual.warmth;
          artwork.complexity      = visual.complexity;
          artwork.edgeDensity     = visual.edgeDensity;
          artwork.reconstructability = 0.6;
        }
        process.stdout.write(" done\n");
        await sleep(100); // be gentle
      }

      accumulated.set(artwork.id, artwork);
      newForQuery++;
    }

    console.log(`[build] "${query}": ${imported.length} valid, ${newForQuery} new.`);
    totalNew += newForQuery;

    // Write incrementally so progress is not lost on error
    if (newForQuery > 0) writeFile([...accumulated.values()]);
  }

  const merged = [...accumulated.values()];
  writeFile(merged);
  console.log(`\n[build] Done. ${merged.length} total (${totalNew} new) → ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error("[build] Fatal:", err);
  process.exit(1);
});
