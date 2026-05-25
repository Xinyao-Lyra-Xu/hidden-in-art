"use client";

import { History } from "lucide-react";
import type { ArtworkMetadata } from "@/domain/artwork/types";
import type { HistoryItem } from "@/application/history";

type Props = {
  items: HistoryItem[];
  selectedArtwork: ArtworkMetadata | null;
  onSelect: (item: HistoryItem) => void;
};

export default function HistoryGallery({ items, selectedArtwork, onSelect }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-neutral-500" />
        <h2 className="museum-label text-neutral-500">
          Personal Gallery
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1025px]:grid-cols-3">
        {items.map((item) => {
          const isSelected =
            selectedArtwork?.id === item.artworkId ||
            (selectedArtwork?.title === item.artworkTitle &&
              selectedArtwork?.artist === item.artworkArtist);
          return (
            <article
              key={item.key}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              title={`Use ${item.artworkTitle} as the reconstruction target`}
              onClick={() => onSelect(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(item);
                }
              }}
              className={`touch-manipulation overflow-hidden rounded border shadow-sm transition active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-neutral-700 ${
                isSelected
                  ? "cursor-pointer border-neutral-800 bg-white ring-2 ring-neutral-700"
                  : "cursor-pointer border-neutral-200 bg-white/70 hover:border-neutral-500 hover:bg-white"
              }`}
            >
              <div className="relative grid aspect-[4/3] grid-cols-2 bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.photoThumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.artworkImage}
                  alt={item.artworkTitle}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {isSelected && (
                  <span className="absolute left-2 top-2 rounded bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-800">
                    Target
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="museum-serif truncate text-base font-medium text-neutral-900">{item.artworkTitle}</p>
                <p className="truncate text-xs text-neutral-500">{item.artworkArtist}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
