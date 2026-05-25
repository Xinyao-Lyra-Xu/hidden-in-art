"use client";

import { Shuffle, Upload } from "lucide-react";

type Props = {
  onTryPhoto: () => void;
  onTryArtwork: () => void;
  canTryArtwork: boolean;
};

export default function ActionStrip({ onTryPhoto, onTryArtwork, canTryArtwork }: Props) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-2 border-t border-neutral-200 pt-5 sm:grid-cols-2">
      <button
        type="button"
        onClick={onTryPhoto}
        className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition active:scale-[0.97] hover:bg-neutral-50 sm:min-h-0"
      >
        <Upload className="h-4 w-4" />
        Try another photo
      </button>
      <button
        type="button"
        onClick={onTryArtwork}
        disabled={!canTryArtwork}
        className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition active:scale-[0.97] hover:bg-neutral-50 disabled:opacity-40 sm:min-h-0"
      >
        <Shuffle className="h-4 w-4" />
        Try another painting
      </button>
    </div>
  );
}
