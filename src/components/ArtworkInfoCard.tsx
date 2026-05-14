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
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-base font-medium leading-tight text-neutral-900">
          {artwork.title}
        </h2>
        {artwork.year && (
          <span className="shrink-0 text-[11px] text-neutral-400">{artwork.year}</span>
        )}
      </div>

      {/* Artist + museum */}
      <p className="mt-0.5 text-xs text-neutral-500">
        {artwork.artist}
        <span className="mx-1.5 text-neutral-300">·</span>
        Metropolitan Museum of Art, New York
        {dimensions && (
          <>
            <span className="mx-1.5 text-neutral-300">·</span>
            {dimensions}
          </>
        )}
      </p>

      {/* One-liner background */}
      {description && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">{description}</p>
      )}

      {/* Brushwork note */}
      {strokeNote && (
        <div className="mt-2 border-t border-neutral-100 pt-2">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Brushwork
          </p>
          <p className="text-xs leading-relaxed text-neutral-600">{strokeNote}</p>
        </div>
      )}

      {/* Match reasons */}
      {reasons.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Why it matches your photo
          </p>
          <ul className="space-y-0.5">
            {reasons.slice(0, 2).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-600">
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
