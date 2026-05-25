"use client";

import { useEffect, useRef, useState } from "react";
import CanvasRenderer from "@/components/CanvasRenderer";
import ArtworkInfoCard from "@/components/ArtworkInfoCard";
import UploadBox from "@/components/UploadBox";
import Slider from "@/components/Slider";
import ActionStrip from "@/components/ActionStrip";
import HistoryGallery from "@/components/HistoryGallery";
import PaletteCard from "@/components/PaletteCard";
import { loadImageFromFile } from "@/infrastructure/image/loader";
import { loadLocalArtworks } from "@/infrastructure/artwork/loader";
import { analyzeImage } from "@/domain/image/analysis";
import { recommendArtworks } from "@/domain/artwork/matcher";
import { getArtworkThumbnailUrl } from "@/lib/artworkUrl";
import { makePhotoThumb } from "@/lib/canvas";
import {
  buildHistoryItem,
  addToHistory,
  resolveArtworkFromHistory,
  loadHistoryFromStorage,
  saveHistoryToStorage,
} from "@/application/history";
import type { ArtworkMetadata } from "@/domain/artwork/types";
import type { ArtworkRecommendation } from "@/domain/artwork/matcher";
import type { HistoryItem } from "@/application/history";

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
  const patchTouchedRef = useRef(false);

  useEffect(() => {
    loadLocalArtworks().then(({ artworks, error }) => {
      setArtworks(artworks);
      if (error) setLibraryError(error);
      if (artworks.length > 0 && !selectedArtwork) setSelectedArtwork(artworks[0]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = prevBlobRef.current;
    return () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setHistory(loadHistoryFromStorage());
    });
  }, []);

  useEffect(() => {
    if (!patchTouchedRef.current && window.matchMedia("(max-width: 639px)").matches) {
      setPatchCount(2000);
    }
  }, []);

  function rememberArtwork(
    artwork: ArtworkMetadata,
    nextPhotoThumb = photoThumb,
    nextPhotoKey = photoKey,
  ) {
    if (!nextPhotoThumb || !nextPhotoKey) return;
    const item = buildHistoryItem(artwork, nextPhotoThumb, nextPhotoKey);
    setHistory((prev) => {
      const next = addToHistory(prev, item);
      saveHistoryToStorage(next);
      return next;
    });
  }

  function selectArtworkAsTarget(artwork: ArtworkMetadata | null) {
    if (artwork) console.log("Selected artwork target:", artwork.title);
    setSelectedArtwork(artwork);
    if (artwork) rememberArtwork(artwork);
  }

  function handleHistorySelect(item: HistoryItem) {
    selectArtworkAsTarget(resolveArtworkFromHistory(item, artworks));
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

  return (
    <main className="min-h-screen bg-[#f8f5ee] text-neutral-900">
      <section className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">

        <header className="text-center">
          <h1 className="museum-display text-[3.4rem] leading-none md:text-[5.15rem]">
            Hidden in Art
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-neutral-600">
            Your photo becomes the brushwork of a famous painting.
          </p>
        </header>

        <div className="mx-auto w-full max-w-2xl rounded border border-neutral-200 bg-white/60 p-3 shadow-sm backdrop-blur sm:max-w-[720px] sm:p-6 min-[1025px]:max-w-2xl">

          <div className="mb-6">
            <p className="museum-label mb-2 text-neutral-500">
              Your Photo
            </p>
            <UploadBox
              previewUrl={previewUrl}
              fileName={fileName}
              disabled={isProcessing}
              onFile={handleFile}
            />
          </div>

          {recommendations.length > 0 && (
            <div className="mb-6">
              <p className="museum-label mb-3 text-neutral-500">
                Best Matches for Your Photo
              </p>
              <div className="best-match-scroll -mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0">
                {recommendations.map(({ artwork, score }) => {
                  const isSelected = selectedArtwork?.id === artwork.id;
                  return (
                    <button
                      key={artwork.id}
                      type="button"
                      aria-pressed={isSelected}
                      title={`Use ${artwork.title} as the reconstruction target`}
                      onClick={() => selectArtworkAsTarget(artwork)}
                      className={`group relative flex min-w-[calc((100%_-_1rem)/2.3)] snap-start cursor-pointer touch-manipulation flex-col overflow-hidden rounded border text-left transition active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-neutral-700 sm:min-w-[110px] ${
                        isSelected
                          ? "border-neutral-800 bg-white ring-2 ring-neutral-700"
                          : "border-neutral-200 bg-white/70 hover:border-neutral-500 hover:bg-white"
                      }`}
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getArtworkThumbnailUrl(artwork)}
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
                        <p className="museum-serif truncate text-sm font-medium leading-tight text-neutral-800">
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
                <p className="museum-caption mt-3 text-xs text-neutral-500">
                  Reconstructing with{" "}
                  <span className="font-medium text-neutral-700">{selectedArtwork.title}</span>.
                  Click another match to rerun with that artwork.
                </p>
              )}
            </div>
          )}

          {recommendations.length === 0 && (
            <div className="mb-6">
              <label
                htmlFor="painting-select"
                className="museum-label mb-2 block text-neutral-500"
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

          <Slider
            label="Patches / Threads"
            value={patchCount}
            min={1600}
            max={4096}
            step={100}
            onChange={(value) => {
              patchTouchedRef.current = true;
              setPatchCount(value);
            }}
          />

          {sourceImage && (
            <ActionStrip
              onTryPhoto={() => document.getElementById("photo-upload")?.click()}
              onTryArtwork={selectRandomArtwork}
              canTryArtwork={artworks.length > 1}
            />
          )}
        </div>

        {sourceImage && selectedArtwork && (
          <p className="museum-caption text-center text-sm text-neutral-500">
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
