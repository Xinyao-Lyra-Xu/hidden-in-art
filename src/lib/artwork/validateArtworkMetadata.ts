import type { ArtworkMetadata } from "@/types/art";

export type ValidationResult = {
  valid: ArtworkMetadata[];
  warnings: string[];
};

const REQUIRED_STRINGS = ["id", "title", "artist"] as const;
const OPTIONAL_NUMBERS = ["complexity", "brightness", "saturation", "warmth", "edgeDensity", "reconstructability"] as const;

export function validateArtworkMetadata(raw: unknown): ValidationResult {
  const warnings: string[] = [];

  if (!Array.isArray(raw)) {
    warnings.push("Metadata root is not a valid array.");
    return { valid: [], warnings };
  }

  const valid: ArtworkMetadata[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      warnings.push(`Entry ${i}: not an object, skipped.`);
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : `#${i}`;
    const ref = `Entry ${i} (${id})`;
    let skip = false;

    for (const field of REQUIRED_STRINGS) {
      if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
        warnings.push(`${ref}: field "${field}" must be a non-empty string, skipped.`);
        skip = true;
        break;
      }
    }
    if (skip) continue;

    for (const field of OPTIONAL_NUMBERS) {
      const v = obj[field];
      if (v !== undefined && v !== null && (typeof v !== "number" || !isFinite(v) || v < 0 || v > 1)) {
        warnings.push(`${ref}: field "${field}" must be a number in [0, 1] if provided.`);
      }
    }

    // palette must be an array if present; default to [] if missing
    if (obj.palette !== undefined && !Array.isArray(obj.palette)) {
      warnings.push(`${ref}: "palette" must be an array if provided, defaulting to [].`);
      obj.palette = [];
    }
    if (!Array.isArray(obj.palette)) obj.palette = [];

    // tags must be an array if present; default to [] if missing
    if (obj.tags !== undefined && !Array.isArray(obj.tags)) {
      warnings.push(`${ref}: "tags" must be an array if provided, defaulting to [].`);
      obj.tags = [];
    }
    if (!Array.isArray(obj.tags)) obj.tags = [];

    valid.push(obj as ArtworkMetadata);
  }

  return { valid, warnings };
}
