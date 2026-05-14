"use client";

import { useEffect, useRef, useState } from "react";
import { History, Shuffle, Upload } from "lucide-react";
import CanvasRenderer from "@/components/CanvasRenderer";
import ArtworkInfoCard from "@/components/ArtworkInfoCard";
import { loadImageFromFile } from "@/lib/image/loadImage";
import { loadLocalArtworks } from "@/lib/artwork/loadArtworks";
import { analyzeImage } from "@/lib/artwork/analyzeImage";
import { recommendArtworks } from "@/lib/artwork/matcher";
import type { ArtworkMetadata } from "@/types/art";
import type { ArtworkRecommendation } from "@/lib/artwork/matcher";

const HISTORY_KEY = "hidden-in-art-history-v1";

type HistoryItem = {
  key: string;
  photoThumb: string;
  artworkId?: string;
  artworkTitle: string;
  artworkArtist: string;
  artworkImage: string;
  artwork?: ArtworkMetadata;
  createdAt: number;
};

export default function Home() {
  const [artworks,        setArtworks]        = useState<ArtworkMetadata[]>([]);
  const [libraryError,    setLibraryError]    = useState<string | null>(null);

  const [sourceImage,     setSourceImage]     = useState<HTMLImageElement | null>(null);
  const [previewUrl,      setPreviewUrl]       = useState("");
  const [fileName,        setFileName]        = useState("");
  const [isProcessing,    setIsProcessing]    = useState(false);

  const [recommendations, setRecommendations] = useState<ArtworkRecommendation[]>([]);
  const [selectedArtwork, setSelectedArtwork] = useState<ArtworkMetadata | null>(null);
  const [patchCount,      setPatchCount]      = useState(2500);
  const [userColors,      setUserColors]      = useState<string[]>([]);
  const [photoThumb,      setPhotoThumb]      = useState("");
  const [photoKey,        setPhotoKey]        = useState("");
  const [history,         setHistory]         = useState<HistoryItem[]>([]);

  const prevBlobRef = useRef("");

  // Load the painting library once on mount
  useEffect(() => {
    loadLocalArtworks().then(({ artworks, error }) => {
      setArtworks(artworks);
      if (error) setLibraryError(error);
      if (artworks.length > 0 && !selectedArtwork) setSelectedArtwork(artworks[0]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke old blob URL when component unmounts
  useEffect(() => {
    const url = prevBlobRef.current;
    return () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw) as HistoryItem[]);
      } catch {
        setHistory([]);
      }
    });
  }, []);

  function rememberArtwork(
    artwork: ArtworkMetadata,
    nextPhotoThumb = photoThumb,
    nextPhotoKey = photoKey,
  ) {
    if (!nextPhotoThumb || !nextPhotoKey) return;

    const q = encodeURIComponent(
      artwork.query ?? `${artwork.title} ${artwork.artist}`,
    );
    const item: HistoryItem = {
      key: `${nextPhotoKey}-${artwork.id}`,
      photoThumb: nextPhotoThumb,
      artworkId: artwork.id,
      artworkTitle: artwork.title,
      artworkArtist: artwork.artist,
      artworkImage: artwork.image || `/api/met-painting?id=${artwork.metId ?? 0}&q=${q}`,
      artwork,
      createdAt: 0,
    };

    setHistory((prev) => {
      const next = [item, ...prev.filter((x) => x.key !== item.key)].slice(0, 12);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore private-mode or quota failures; the gallery is a nice-to-have.
      }
      return next;
    });
  }

  function selectArtworkAsTarget(artwork: ArtworkMetadata | null) {
    if (artwork) console.log("Selected artwork target:", artwork.title);
    setSelectedArtwork(artwork);
    if (artwork) rememberArtwork(artwork);
  }

  function artworkFromHistory(item: HistoryItem): ArtworkMetadata {
    const found = artworks.find((artwork) =>
      artwork.id === item.artworkId ||
      (artwork.title === item.artworkTitle && artwork.artist === item.artworkArtist)
    );
    if (found) return found;
    if (item.artwork) return item.artwork;
    return {
      id: item.artworkId ?? `history-${item.key}`,
      title: item.artworkTitle,
      artist: item.artworkArtist,
      image: item.artworkImage,
      tags: [],
      palette: [],
    };
  }

  function handleHistorySelect(item: HistoryItem) {
    selectArtworkAsTarget(artworkFromHistory(item));
  }

  async function handleFile(file: File) {
    setIsProcessing(true);
    try {
      if (prevBlobRef.current.startsWith("blob:")) URL.revokeObjectURL(prevBlobRef.current);
      const blob = URL.createObjectURL(file);
      prevBlobRef.current = blob;
      setPreviewUrl(blob);
      setFileName(file.name);

      const img = await loadImageFromFile(file);
      setSourceImage(img);
      const nextPhotoThumb = makePhotoThumb(img);
      const nextPhotoKey = `${file.name}-${file.size}-${file.lastModified}`;
      setPhotoThumb(nextPhotoThumb);
      setPhotoKey(nextPhotoKey);

      if (artworks.length > 0) {
        const analysis = analyzeImage(img);
        setUserColors(analysis.dominantColors);
        const recs = recommendArtworks(analysis, artworks, 5);
        setRecommendations(recs);
        if (recs.length > 0) {
          selectArtworkAsTarget(recs[0].artwork);
          rememberArtwork(recs[0].artwork, nextPhotoThumb, nextPhotoKey);
        } else if (selectedArtwork) {
          rememberArtwork(selectedArtwork, nextPhotoThumb, nextPhotoKey);
        }
      }
    } catch {
      alert("Failed to load image.");
    } finally {
      setIsProcessing(false);
    }
  }

  function selectRandomArtwork() {
    const pool = recommendations.length > 0
      ? recommendations.map((r) => r.artwork)
      : artworks;
    if (pool.length === 0) return;
    const available = pool.filter((a) => a.id !== selectedArtwork?.id);
    const choices = available.length > 0 ? available : pool;
    const currentIndex = choices.findIndex((a) => a.id === selectedArtwork?.id);
    const next = choices[(currentIndex + 1 + choices.length) % choices.length];
    selectArtworkAsTarget(next);
  }

  const thumbnailSrc = (a: ArtworkMetadata) => {
    if (a.thumbnail || a.image) return a.thumbnail ?? a.image ?? "";
    const q = encodeURIComponent(a.query ?? `${a.title} ${a.artist}`);
    return `/api/met-painting?id=${a.metId ?? 0}&q=${q}`;
  };

  return (
    <main className="min-h-screen bg-[#f8f5ee] text-neutral-900">
      <section className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">

        <header className="text-center">
          <h1 className="font-serif text-5xl tracking-tight md:text-7xl">
            Hidden in Art
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-neutral-600">
            Your photo becomes the brushwork of a famous painting.
          </p>
        </header>

        <div className="mx-auto w-full max-w-2xl rounded border border-neutral-200 bg-white/60 p-6 shadow-sm backdrop-blur">

          {/* Photo upload */}
          <div className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Your Photo
            </p>
            <UploadBox
              previewUrl={previewUrl}
              fileName={fileName}
              disabled={isProcessing}
              onFile={handleFile}
            />
          </div>

          {/* Matched paintings — shown after upload */}
          {recommendations.length > 0 && (
            <div className="mb-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Best Matches for Your Photo
              </p>
              <div className="grid grid-cols-5 gap-2">
                {recommendations.map(({ artwork, score }) => {
                  const isSelected = selectedArtwork?.id === artwork.id;
                  return (
                    <button
                      key={artwork.id}
                      type="button"
                      aria-pressed={isSelected}
                      title={`Use ${artwork.title} as the reconstruction target`}
                      onClick={() => selectArtworkAsTarget(artwork)}
                      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded border text-left transition focus:outline-none focus:ring-2 focus:ring-neutral-700 ${
                        isSelected
                          ? "border-neutral-800 bg-white ring-2 ring-neutral-700"
                          : "border-neutral-200 bg-white/70 hover:border-neutral-500 hover:bg-white"
                      }`}
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailSrc(artwork)}
                          alt={artwork.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                          {score}%
                        </span>
                        {isSelected && (
                          <span className="absolute left-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-800">
                            Target
                          </span>
                        )}
                      </div>
                      <div className="p-1.5">
                        <p className="truncate text-[11px] font-medium leading-tight text-neutral-800">
                          {artwork.title}
                        </p>
                        <p className="truncate text-[10px] leading-tight text-neutral-500">
                          {artwork.artist}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedArtwork && (
                <p className="mt-3 text-xs text-neutral-500">
                  Reconstructing with{" "}
                  <span className="font-medium text-neutral-700">{selectedArtwork.title}</span>.
                  Click another match to rerun with that artwork.
                </p>
              )}
            </div>
          )}

          {/* Fallback selector — shown before upload or when library is loading */}
          {recommendations.length === 0 && (
            <div className="mb-6">
              <label
                htmlFor="painting-select"
                className="mb-2 block text-xs font-semibold uppercase tracking-widest text-neutral-500"
              >
                Famous Painting
              </label>
              {libraryError ? (
                <p className="text-xs text-red-500">{libraryError}</p>
              ) : artworks.length === 0 ? (
                <p className="text-xs italic text-neutral-400">Loading painting library…</p>
              ) : (
                <select
                  id="painting-select"
                  value={selectedArtwork?.id ?? ""}
                  onChange={(e) => {
                    const a = artworks.find((x) => x.id === e.target.value) ?? null;
                    selectArtworkAsTarget(a);
                  }}
                  className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                >
                  {artworks.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} — {a.artist}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Patch count slider */}
          <Slider
            label="Patches / Threads"
            value={patchCount}
            min={1600}
            max={4096}
            step={100}
            onChange={setPatchCount}
          />

          {sourceImage && (
            <ActionStrip
              onTryPhoto={() => document.getElementById("photo-upload")?.click()}
              onTryArtwork={selectRandomArtwork}
              canTryArtwork={artworks.length > 1}
            />
          )}
        </div>

        {/* Scroll guide — appears after upload to direct attention downward */}
        {sourceImage && selectedArtwork && (
          <p className="text-center text-sm text-neutral-500">
            ↓ Scroll down to see how{" "}
            <span className="font-medium text-neutral-700">{selectedArtwork.artist}</span>{" "}
            would have painted with your pixels
          </p>
        )}

        {selectedArtwork && (
          <ArtworkInfoCard
            artwork={selectedArtwork}
            recommendation={
              recommendations.find((r) => r.artwork.id === selectedArtwork.id) ?? null
            }
          />
        )}

        {/* Color palette comparison — shown once user photo is available */}
        {sourceImage && selectedArtwork && userColors.length > 0 && (
          <PaletteCard
            artworkPalette={selectedArtwork.palette ?? []}
            userColors={userColors}
            artwork={selectedArtwork}
          />
        )}

        <CanvasRenderer
          sourceImage={sourceImage}
          artwork={selectedArtwork}
          patchCount={patchCount}
        />

        <HistoryGallery
          items={history}
          selectedArtwork={selectedArtwork}
          onSelect={handleHistorySelect}
        />

      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadBox({
  previewUrl,
  fileName,
  disabled,
  onFile,
}: {
  previewUrl: string;
  fileName: string;
  disabled: boolean;
  onFile: (f: File) => void;
}) {
  return (
    <label
      htmlFor="photo-upload"
      className={`flex cursor-pointer flex-col items-center justify-center rounded border border-dashed border-neutral-300 px-5 py-8 text-center transition hover:bg-white/70 ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <Upload className="mb-3 h-7 w-7 text-neutral-400" />
      <span className="text-sm text-neutral-600">
        {previewUrl ? "Change photo" : "Upload your photo"}
      </span>
      <span className="mt-1 text-xs text-neutral-400">JPG · PNG · WEBP</span>
      <input
        id="photo-upload"
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {previewUrl && (
        <div className="mt-4 overflow-hidden rounded border border-neutral-200 bg-neutral-50 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            className="max-h-28 w-auto object-contain"
          />
          <p className="truncate px-2 py-1 text-xs text-neutral-400">{fileName}</p>
        </div>
      )}
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm text-neutral-700">
      <span>
        {label}: <span className="font-medium">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-neutral-700"
      />
    </label>
  );
}

function ActionStrip({
  onTryPhoto,
  onTryArtwork,
  canTryArtwork,
}: {
  onTryPhoto: () => void;
  onTryArtwork: () => void;
  canTryArtwork: boolean;
}) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-2 border-t border-neutral-200 pt-5 sm:grid-cols-2">
      <button
        type="button"
        onClick={onTryPhoto}
        className="inline-flex items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
      >
        <Upload className="h-4 w-4" />
        Try another photo
      </button>
      <button
        type="button"
        onClick={onTryArtwork}
        disabled={!canTryArtwork}
        className="inline-flex items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
      >
        <Shuffle className="h-4 w-4" />
        Try another painting
      </button>
    </div>
  );
}

function HistoryGallery({
  items,
  selectedArtwork,
  onSelect,
}: {
  items: HistoryItem[];
  selectedArtwork: ArtworkMetadata | null;
  onSelect: (item: HistoryItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-neutral-500" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Personal Gallery
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              className={`overflow-hidden rounded border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-neutral-700 ${
                isSelected
                  ? "cursor-pointer border-neutral-800 bg-white ring-2 ring-neutral-700"
                  : "cursor-pointer border-neutral-200 bg-white/70 hover:border-neutral-500 hover:bg-white"
              }`}
            >
              <div className="relative grid aspect-[4/3] grid-cols-2 bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.photoThumb} alt="" className="h-full w-full object-cover" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.artworkImage}
                  alt={item.artworkTitle}
                  className="h-full w-full object-cover"
                />
                {isSelected && (
                  <span className="absolute left-2 top-2 rounded bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-800">
                    Target
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="truncate font-serif text-sm text-neutral-900">{item.artworkTitle}</p>
                <p className="truncate text-xs text-neutral-500">{item.artworkArtist}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function makePhotoThumb(img: HTMLImageElement): string {
  const maxSide = 360;
  const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function PaletteCard({
  artworkPalette,
  userColors,
  artwork,
}: {
  artworkPalette: string[];
  userColors:     string[];
  artwork:        ArtworkMetadata;
}) {
  const artSwatches  = artworkPalette.slice(0, 5);
  const userSwatches = userColors.slice(0, 5);

  if (artSwatches.length === 0 && userSwatches.length === 0) return null;

  return (
    <div className="w-full rounded border border-neutral-200 bg-white/70 p-4 shadow-sm backdrop-blur">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        Color Palette Match
      </p>
      <div className="flex gap-6">
        {artSwatches.length > 0 && (
          <div className="flex-1">
            <p className="mb-1.5 truncate text-[11px] text-neutral-400">{artwork.title}</p>
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
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
        The reconstruction maps each patch to the closest color in your photo, so similar tones
        transfer naturally while the painting&apos;s overall palette stays recognizable.
      </p>
    </div>
  );
}
