import { PAINTING_SOURCES, type PaintingSource } from "@/types/art";

const PAINTING_PATHS = Object.fromEntries(
  PAINTING_SOURCES.map((source) => [source, `/paintings/${source}.jpg`])
) as Record<Exclude<PaintingSource, "none">, string>;

export async function loadPaintingSource(
  source: PaintingSource
): Promise<HTMLImageElement | null> {
  if (source === "none") return null;

  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`Unable to load painting source: ${PAINTING_PATHS[source]}`);
      resolve(null);
    };

    img.decoding = "async";
    img.src = PAINTING_PATHS[source];
  });
}
