"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import CanvasRenderer from "@/components/CanvasRenderer";
import { loadImageFromFile } from "@/lib/image/loadImage";
import { sampleImagePoints } from "@/lib/image/samplePoints";
import type { ArtPoint, RenderMode, RenderSettings } from "@/types/art";

export default function Home() {
  const [points, setPoints] = useState<ArtPoint[]>([]);
  const [fileName, setFileName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const [settings, setSettings] = useState<RenderSettings>({
    mode: "thread-memory",
    pointDensity: 1200,
    abstraction: 55,
    paletteSize: 24,
    showThreads: true,
  });

  async function handleFile(file: File) {
    try {
      setIsProcessing(true);
      setFileName(file.name);

      const image = await loadImageFromFile(file);
      const sampled = sampleImagePoints(image, settings);

      setPoints(sampled);
    } catch (error) {
      console.error(error);
      alert("Failed to process image.");
    } finally {
      setIsProcessing(false);
    }
  }

  function regenerate() {
    const input = document.getElementById(
      "image-input"
    ) as HTMLInputElement | null;

    const file = input?.files?.[0];

    if (file) {
      handleFile(file);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f5ee] text-neutral-900">
      <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.35em] text-neutral-500">
            Machine Memory Study
          </p>

          <h1 className="font-serif text-5xl tracking-tight md:text-7xl">
            Hidden in Art
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-neutral-600">
            Upload a photograph. Lose the details. Keep the memory.
          </p>
        </header>

        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-neutral-200 bg-white/60 p-6 shadow-sm backdrop-blur">
          <label
            htmlFor="image-input"
            className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 px-6 py-10 text-center transition hover:bg-white/70"
          >
            <Upload className="mb-4 h-8 w-8 text-neutral-500" />

            <span className="text-sm text-neutral-700">
              Drop or select an image
            </span>

            <span className="mt-2 text-xs text-neutral-400">
              JPG, PNG, WEBP
            </span>

            <input
              id="image-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>

          {fileName && (
            <p className="mt-4 text-center text-xs text-neutral-500">
              Loaded: {fileName}
            </p>
          )}

          {isProcessing && (
            <p className="mt-3 text-center text-sm text-neutral-600">
              Reconstructing memory...
            </p>
          )}

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="text-sm">
              <span className="text-neutral-700">Mode</span>

              <select
                value={settings.mode}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    mode: e.target.value as RenderMode,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2"
              >
                <option value="thread-memory">Thread Memory</option>
                <option value="museum-dust">Museum Dust</option>
                <option value="point-memory">Point Memory</option>
                <option value="lost-portrait">Lost Portrait</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="text-neutral-700">
                Point Density: {settings.pointDensity}
              </span>

              <input
                type="range"
                min="300"
                max="3000"
                step="100"
                value={settings.pointDensity}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    pointDensity: Number(e.target.value),
                  }))
                }
                className="mt-3 w-full"
              />
            </label>

            <label className="text-sm">
              <span className="text-neutral-700">
                Abstraction: {settings.abstraction}
              </span>

              <input
                type="range"
                min="0"
                max="100"
                value={settings.abstraction}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    abstraction: Number(e.target.value),
                  }))
                }
                className="mt-3 w-full"
              />
            </label>

            <label className="flex items-center gap-3 pt-6 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={settings.showThreads}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    showThreads: e.target.checked,
                  }))
                }
              />

              Show thread lines
            </label>
          </div>

          <button
            onClick={regenerate}
            className="mt-6 w-full rounded-full bg-neutral-900 px-5 py-3 text-sm text-white transition hover:bg-neutral-700"
          >
            Reconstruct Memory
          </button>
        </div>

        <CanvasRenderer points={points} settings={settings} />
      </section>
    </main>
  );
}