"use client";

import type { ArtworkMetadata } from "@/types/art";
import type { ArtworkRecommendation } from "@/lib/artwork/matcher";
import {
  PAINTING_DESCRIPTIONS,
  PAINTING_DIMENSIONS,
  STROKE_DESCRIPTIONS,
} from "@/lib/artwork/paintingInfo";

type Props = {
  artwork:        ArtworkMetadata;
  recommendation: ArtworkRecommendation | null;
};

export default function ArtworkInfoCard({ artwork, recommendation }: Props) {
  const description  = PAINTING_DESCRIPTIONS[artwork.id];
  const dimensions   = PAINTING_DIMENSIONS[artwork.id];
  const strokeNote   = STROKE_DESCRIPTIONS[artwork.id];
  const reasons      = recommendation?.reasons ?? [];

  return (
    <div className="w-full rounded border border-neutral-200 bg-white/70 p-4 shadow-sm backdrop-blur">

      {/* Title row */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="museum-serif text-lg font-medium leading-tight text-neutral-900">
          {artwork.title}
        </h2>
        {artwork.year && (
          <span className="museum-tabular shrink-0 text-[11px] text-neutral-400">{artwork.year}</span>
        )}
      </div>

      {/* Artist + museum */}
      <p className="museum-tabular mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-neutral-500 sm:block">
        {artwork.artist}
        <span className="hidden text-neutral-300 sm:mx-1.5 sm:inline">·</span>
        Metropolitan Museum of Art, New York
        {dimensions && (
          <>
            <span className="hidden text-neutral-300 sm:mx-1.5 sm:inline">·</span>
            {dimensions}
          </>
        )}
      </p>

      {/* One-liner background */}
      {description && (
        <p className="museum-serif mt-2 max-w-[65ch] text-sm leading-[1.65] text-neutral-600">{description}</p>
      )}

      {/* Brushwork note */}
      {strokeNote && (
        <div className="mt-2 border-t border-neutral-100 pt-2">
          <p className="museum-label mb-0.5 text-neutral-400">
            Brushwork
          </p>
          <p className="museum-serif max-w-[65ch] text-sm leading-[1.65] text-neutral-600">{strokeNote}</p>
        </div>
      )}

      {/* Match reasons */}
      {reasons.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-2">
          <p className="museum-label mb-1 text-neutral-400">
            Why it matches your photo
          </p>
          <ul className="space-y-0.5">
            {reasons.slice(0, 2).map((r, i) => (
              <li key={i} className="museum-serif flex items-start gap-1.5 text-sm leading-[1.55] text-neutral-600">
                <span className="mt-px text-neutral-300 select-none">—</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
