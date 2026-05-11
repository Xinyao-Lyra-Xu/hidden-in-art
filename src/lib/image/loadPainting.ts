import type { PaintingSource } from "@/types/art";

const PAINTING_PATHS: Record<Exclude<PaintingSource, "none">, string> = {
  "van-gogh": "/paintings/van-gogh.jpg",
  monet: "/paintings/monet.jpg",
  vermeer: "/paintings/vermeer.jpg",
  klimt: "/paintings/klimt.jpg",
};

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

    img.src = PAINTING_PATHS[source];
  });
}
