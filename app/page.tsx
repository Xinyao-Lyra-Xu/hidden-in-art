"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import CanvasRenderer from "@/components/CanvasRenderer";
import { loadImageFromFile } from "@/lib/image/loadImage";
import { MOSAIC_PAINTINGS } from "@/types/art";
import type { RenderSettings } from "@/types/art";

export default function Home() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const prevBlobRef = useRef("");

  const [settings, setSettings] = useState<RenderSettings>({
    patchCount: 100,
    targetPainting: MOSAIC_PAINTINGS[0].id,
  });

  // Revoke the preview blob URL on unmount
  useEffect(() => {
    const url = prevBlobRef.current;
    return () => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, []);

  async function handleFile(file: File) {
    setIsProcessing(true);
    try {
      // Create a fresh blob URL for the preview thumbnail
      if (prevBlobRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(prevBlobRef.current);
      }
      const blob = URL.createObjectURL(file);
      prevBlobRef.current = blob;
      setPreviewUrl(blob);
      setFileName(file.name);

      const img = await loadImageFromFile(file);
      setSourceImage(img);
    } catch {
      alert("Failed to load image.");
    } finally {
      setIsProcessing(false);
    }
  }

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

          {/* Painting selector */}
          <div className="mb-6">
            <label
              htmlFor="painting-select"
              className="mb-2 block text-xs font-semibold uppercase tracking-widest text-neutral-500"
            >
              Famous Painting
            </label>
            <select
              id="painting-select"
              value={settings.targetPainting}
              onChange={(e) =>
                setSettings((s) => ({ ...s, targetPainting: e.target.value }))
              }
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            >
              {MOSAIC_PAINTINGS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} — {p.artist}
                </option>
              ))}
            </select>
          </div>

          {/* Controls */}
          <div className="space-y-5">
            <Slider
              label="Patches / Threads"
              value={settings.patchCount}
              unit=""
              min={40}
              max={200}
              step={10}
              onChange={(v) => setSettings((s) => ({ ...s, patchCount: v }))}
            />
          </div>
        </div>

        <CanvasRenderer sourceImage={sourceImage} settings={settings} />

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
          <p className="truncate px-2 py-1 text-xs text-neutral-400">
            {fileName}
          </p>
        </div>
      )}
    </label>
  );
}

function Slider({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm text-neutral-700">
      <span>
        {label}: <span className="font-medium">{value}{unit}</span>
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
