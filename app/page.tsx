"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import CanvasRenderer from "@/components/CanvasRenderer";
import { loadImageFromFile } from "@/lib/image/loadImage";
import { loadLocalArtworks } from "@/lib/artwork/loadArtworks";
import { analyzeImage } from "@/lib/artwork/analyzeImage";
import { recommendArtworks } from "@/lib/artwork/matcher";
import type { ArtworkMetadata } from "@/types/art";
import type { ArtworkRecommendation } from "@/lib/artwork/matcher";

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

      // Auto-match against the loaded painting library
      if (artworks.length > 0) {
        const analysis = analyzeImage(img);
        const recs = recommendArtworks(analysis, artworks, 5);
        setRecommendations(recs);
        if (recs.length > 0) setSelectedArtwork(recs[0].artwork);
      }
    } catch {
      alert("Failed to load image.");
    } finally {
      setIsProcessing(false);
    }
  }

  const thumbnailSrc = (a: ArtworkMetadata) => {
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
                      onClick={() => setSelectedArtwork(artwork)}
                      className={`group relative flex flex-col overflow-hidden rounded border text-left transition focus:outline-none ${
                        isSelected
                          ? "border-neutral-700 ring-2 ring-neutral-700"
                          : "border-neutral-200 hover:border-neutral-400"
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailSrc(artwork)}
                          alt={artwork.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {/* Score badge */}
                        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                          {score}%
                        </span>
                      </div>
                      {/* Label */}
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
                    setSelectedArtwork(a);
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
        </div>

        <CanvasRenderer
          sourceImage={sourceImage}
          artwork={selectedArtwork}
          patchCount={patchCount}
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
