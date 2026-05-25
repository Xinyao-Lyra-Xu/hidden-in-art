"use client";

import type { ArtworkMetadata } from "@/domain/artwork/types";

type Props = {
  artworkPalette: string[];
  userColors: string[];
  artwork: ArtworkMetadata;
};

export default function PaletteCard({ artworkPalette, userColors, artwork }: Props) {
  const artSwatches  = artworkPalette.slice(0, 5);
  const userSwatches = userColors.slice(0, 5);

  if (artSwatches.length === 0 && userSwatches.length === 0) return null;

  return (
    <div className="w-full rounded border border-neutral-200 bg-white/70 p-4 shadow-sm backdrop-blur">
      <p className="museum-label mb-3 text-neutral-500">
        Color Palette Match
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        {artSwatches.length > 0 && (
          <div className="flex-1">
            <p className="museum-caption mb-1.5 truncate text-[11px] text-neutral-400">{artwork.title}</p>
            <div className="flex gap-1">
              {artSwatches.map((hex, i) => (
                <div
                  key={i}
                  className="h-8 flex-1 rounded"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
          </div>
        )}
        {userSwatches.length > 0 && (
          <div className="flex-1">
            <p className="mb-1.5 text-[11px] text-neutral-400">Your Photo</p>
            <div className="flex gap-1">
              {userSwatches.map((hex, i) => (
                <div
                  key={i}
                  className="h-8 flex-1 rounded"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="museum-caption mt-2 text-[11px] text-neutral-400">
        The reconstruction maps each patch to the closest color in your photo, so similar tones
        transfer naturally while the painting&apos;s overall palette stays recognizable.
      </p>
    </div>
  );
}
