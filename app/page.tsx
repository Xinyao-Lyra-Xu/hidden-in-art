"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Upload } from "lucide-react";
import CanvasRenderer from "@/components/CanvasRenderer";
import { loadImageFromFile } from "@/lib/image/loadImage";
import { loadPaintingSource } from "@/lib/image/loadPainting";
import { mapPaintingColors } from "@/lib/image/paintingMap";
import { sampleImagePoints } from "@/lib/image/samplePoints";
import { buildTargetReconstruction } from "@/lib/image/targetReconstruction";
import { analyzeImage } from "@/lib/artwork/analyzeImage";
import { recommendArtworks } from "@/lib/artwork/matcher";
import type { ArtworkRecommendation } from "@/lib/artwork/matcher";
import type {
  ArtPoint,
  ArtworkMetadata,
  PaintingSource,
  RenderMode,
  RenderSettings,
  TransferTargetPoint,
} from "@/types/art";

const PRESETS = [
  { label: "Cat → Vermeer", source: "cat-source.jpg", target: "vermeer-target.jpg", style: "guided" as const },
  { label: "Flowers → Monet", source: "flowers-source.jpg", target: "monet-target.jpg", style: "guided" as const },
  { label: "City → Klimt", source: "city-source.jpg", target: "klimt-target.jpg", style: "guided" as const },
];

async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load: ${url}`));
    img.src = url;
  });
}

export default function Home() {
  const [points, setPoints] = useState<ArtPoint[]>([]);
  const [sourcePoints, setSourcePoints] = useState<ArtPoint[]>([]);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [targetImage, setTargetImage] = useState<HTMLImageElement | null>(null);
  const [activeTargetImage, setActiveTargetImage] = useState<HTMLImageElement | null>(null);
  const [transferTargets, setTransferTargets] = useState<TransferTargetPoint[]>([]);
  const [sourceFileName, setSourceFileName] = useState("");
  const [targetFileName, setTargetFileName] = useState("");
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [targetPreviewUrl, setTargetPreviewUrl] = useState("");
  const [targetStatus, setTargetStatus] = useState("No target image selected");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [presetMessage, setPresetMessage] = useState("Add example images to public/examples/ to enable presets");
  const [reconstructionStyle, setReconstructionStyle] = useState<"pure" | "guided">("guided");
  const [matchResults, setMatchResults] = useState<ArtworkRecommendation[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [showMatchPanel, setShowMatchPanel] = useState(false);

  const [settings, setSettings] = useState<RenderSettings>({
    mode: "extracted-painting-transfer",
    pointDensity: 1000,
    abstraction: 50,
    paletteSize: 24,
    showThreads: true,
    memoryDecay: 15,
    paintingSource: "none",
    colorBlend: 68,
    usePaintingFragment: false,
    markerSize: 16,
    topReconstructionScale: 80,
    preserveSourceImage: true,
    reconstructionOpacity: 92,
  });

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      colorBlend: reconstructionStyle === "guided" ? 68 : 12,
      reconstructionOpacity: reconstructionStyle === "guided" ? 92 : 85,
    }));
  }, [reconstructionStyle]);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  useEffect(() => {
    return () => {
      if (targetPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(targetPreviewUrl);
    };
  }, [targetPreviewUrl]);

  useEffect(() => {
    let isCurrent = true;

    async function rebuildTransferTargets() {
      const fallbackPainting = targetImage
        ? null
        : await loadPaintingSource(settings.paintingSource);
      if (!isCurrent) return;
      const activeTarget = targetImage ?? fallbackPainting;

      setActiveTargetImage(activeTarget);
      setTargetStatus(getTargetStatus(activeTarget, settings, Boolean(targetImage)));

      if (sourcePoints.length > 0) {
        setPoints(mapPaintingColors(sourcePoints, activeTarget, settings));
        setTransferTargets(buildTargetReconstruction(activeTarget, sourcePoints, settings));
      }
    }

    rebuildTransferTargets();

    return () => {
      isCurrent = false;
    };
  }, [sourcePoints, targetImage, settings]);

  async function handleSourceFile(file: File) {
    try {
      setIsProcessing(true);
      setSourceFileName(file.name);
      setSourcePreviewUrl((currentUrl) => {
        if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl);
        return URL.createObjectURL(file);
      });

      const image = await loadImageFromFile(file);
      const sampled = sampleImagePoints(image, settings);
      const fallbackPainting = targetImage
        ? null
        : await loadPaintingSource(settings.paintingSource);
      const activeTarget = targetImage ?? fallbackPainting;
      const mapped = mapPaintingColors(sampled, activeTarget, settings);
      const targets = buildTargetReconstruction(activeTarget, sampled, settings);

      setActiveTargetImage(activeTarget);
      setTargetStatus(getTargetStatus(activeTarget, settings, Boolean(targetImage)));
      setSourceImage(image);
      setSourcePoints(sampled);
      setPoints(mapped);
      setTransferTargets(targets);
    } catch (error) {
      console.error(error);
      alert("Failed to process image.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleTargetFile(file: File) {
    try {
      setIsProcessing(true);
      setTargetFileName(file.name);
      setTargetPreviewUrl((currentUrl) => {
        if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl);
        return URL.createObjectURL(file);
      });

      const image = await loadImageFromFile(file);
      const targets = buildTargetReconstruction(image, sourcePoints, settings);

      setTargetImage(image);
      setActiveTargetImage(image);
      setTargetStatus("Target image loaded");
      setTransferTargets(targets);

      if (sourcePoints.length > 0) {
        setPoints(mapPaintingColors(sourcePoints, image, settings));
      }
    } catch (error) {
      console.error(error);
      alert("Failed to process target image.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePreset(sourceFile: string, targetFile: string, style: "pure" | "guided") {
    setPresetMessage("");
    setReconstructionStyle(style);

    const presetSettings: RenderSettings = {
      ...settings,
      colorBlend: style === "guided" ? 68 : 12,
      reconstructionOpacity: style === "guided" ? 92 : 85,
    };

    try {
      setIsProcessing(true);
      const sourceUrl = `/examples/${sourceFile}`;
      const targetUrl = `/examples/${targetFile}`;

      const [sourceImg, targetImg] = await Promise.all([
        loadImageFromUrl(sourceUrl),
        loadImageFromUrl(targetUrl),
      ]);

      setSourcePreviewUrl(sourceUrl);
      setTargetPreviewUrl(targetUrl);
      setSourceFileName(sourceFile);
      setTargetFileName(targetFile);

      const sampled = sampleImagePoints(sourceImg, presetSettings);
      const targets = buildTargetReconstruction(targetImg, sampled, presetSettings);
      const mapped = mapPaintingColors(sampled, targetImg, presetSettings);

      setSourceImage(sourceImg);
      setTargetImage(targetImg);
      setActiveTargetImage(targetImg);
      setSourcePoints(sampled);
      setPoints(mapped);
      setTransferTargets(targets);
      setTargetStatus("Target image loaded");
      setPresetMessage("Add example images to public/examples/ to enable presets");
    } catch {
      setPresetMessage("Add example images to public/examples/ to enable presets");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleTargetFromUrl(url: string, name: string) {
    try {
      setIsProcessing(true);
      const image = await loadImageFromUrl(url);
      const targets = buildTargetReconstruction(image, sourcePoints, settings);

      setTargetImage(image);
      setActiveTargetImage(image);
      setTargetFileName(name);
      setTargetPreviewUrl(url);
      setTargetStatus("Target image loaded");
      setTransferTargets(targets);
      setShowMatchPanel(false);

      if (sourcePoints.length > 0) {
        setPoints(mapPaintingColors(sourcePoints, image, settings));
      }
    } catch (error) {
      console.error(error);
      alert("Failed to load artwork.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleAutoMatch() {
    if (!sourceImage) {
      alert("Please upload a source image first.");
      return;
    }
    setIsMatching(true);
    try {
      const analysis = analyzeImage(sourceImage);
      const res = await fetch("/artworks/metadata.json");
      const artworks: ArtworkMetadata[] = await res.json();
      const results = recommendArtworks(analysis, artworks);
      setMatchResults(results);
      setShowMatchPanel(true);
    } catch (error) {
      console.error(error);
      alert("Auto-match failed.");
    } finally {
      setIsMatching(false);
    }
  }

  function regenerate() {
    const input = document.getElementById("source-image-input") as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (file) {
      setIsAnimating(true);
      handleSourceFile(file);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f5ee] text-neutral-900">
      <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="text-center">
          <h1 className="font-serif text-5xl tracking-tight md:text-7xl">
            Hidden in Art
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            Use one image as material and another as memory.
          </p>
        </header>

        <div className="mx-auto w-full max-w-2xl rounded border border-neutral-200 bg-white/60 p-6 shadow-sm backdrop-blur">
          <div className="mb-6 border-b border-neutral-200 pb-4">
            <label className="mb-3 block text-sm font-semibold text-neutral-700">
              Reconstruction Style
            </label>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="style"
                  value="pure"
                  checked={reconstructionStyle === "pure"}
                  onChange={() => setReconstructionStyle("pure")}
                  className="h-4 w-4"
                />
                <span className="text-sm text-neutral-700">
                  Pure Transfer
                  <span className="ml-1 text-xs text-neutral-500">(experimental)</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="style"
                  value="guided"
                  checked={reconstructionStyle === "guided"}
                  onChange={() => setReconstructionStyle("guided")}
                  className="h-4 w-4"
                />
                <span className="text-sm text-neutral-700">
                  Guided Reconstruction
                  <span className="ml-1 text-xs text-neutral-500">(with target hint)</span>
                </span>
              </label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
                Material
              </p>
              <ImageUploadBox
                id="source-image-input"
                label="Upload Image"
                helper="Provides visual material"
                previewUrl={sourcePreviewUrl}
                fileName={sourceFileName}
                onFile={handleSourceFile}
              />
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
                Memory
              </p>
              <ImageUploadBox
                id="target-image-input"
                label="Upload Image"
                helper="Provides structure & memory"
                previewUrl={targetPreviewUrl}
                fileName={targetFileName}
                onFile={handleTargetFile}
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleAutoMatch}
              disabled={isProcessing || isMatching || !sourceImage}
              className="w-full rounded-full border border-neutral-400 bg-white/80 px-5 py-2.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
            >
              {isMatching ? "Analyzing image..." : "Auto Match Target"}
            </button>
          </div>

          {showMatchPanel && matchResults.length > 0 && (
            <div className="mt-3 rounded border border-neutral-200 bg-white/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                  Recommended Artworks
                </p>
                <button
                  onClick={() => setShowMatchPanel(false)}
                  className="text-xs text-neutral-400 hover:text-neutral-600"
                >
                  Close
                </button>
              </div>
              <div className="space-y-2">
                {matchResults.map((result) => (
                  <button
                    key={result.artwork.id}
                    onClick={() =>
                      handleTargetFromUrl(
                        result.artwork.image,
                        `${result.artwork.title} — ${result.artwork.artist}`
                      )
                    }
                    disabled={isProcessing}
                    className="flex w-full items-start gap-3 rounded border border-neutral-200 bg-white p-3 text-left transition hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <img
                      src={result.artwork.image}
                      alt={result.artwork.title}
                      className="h-14 w-14 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-neutral-800">
                          {result.artwork.title}
                        </p>
                        <span className="shrink-0 text-xs font-semibold text-neutral-500">
                          {Math.round(result.score * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500">{result.artwork.artist}</p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {result.reasons.join(" · ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {isProcessing && (
            <p className="mt-4 text-center text-sm text-neutral-600">
              Reconstructing memory...
            </p>
          )}

          <p className="mt-3 text-center text-xs text-neutral-500">
            {targetStatus}
          </p>

          <div className="mt-6 space-y-4">
            <label className="text-sm">
              <span className="text-neutral-700">
                Sample Points: {settings.pointDensity}
              </span>
              <input
                type="range"
                min="300"
                max="3000"
                step="100"
                value={settings.pointDensity}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, pointDensity: Number(e.target.value) }))
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
                  setSettings((prev) => ({ ...prev, abstraction: Number(e.target.value) }))
                }
                className="mt-3 w-full"
              />
            </label>

            <label className="text-sm">
              <span className="text-neutral-700">
                Detail Decay: {settings.memoryDecay}
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.memoryDecay}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, memoryDecay: Number(e.target.value) }))
                }
                className="mt-3 w-full"
              />
            </label>

            <label className="flex items-center gap-3 pt-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={settings.showThreads}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, showThreads: e.target.checked }))
                }
              />
              Show connection lines
            </label>

            {reconstructionStyle === "guided" && (
              <label className="text-sm">
                <span className="text-neutral-700">
                  Target Guidance: {settings.colorBlend}
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.colorBlend}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, colorBlend: Number(e.target.value) }))
                  }
                  className="mt-3 w-full"
                />
              </label>
            )}

            <label className="text-sm">
              <span className="text-neutral-700">
                Top Scale: {settings.topReconstructionScale}
              </span>
              <input
                type="range"
                min="45"
                max="100"
                value={settings.topReconstructionScale}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, topReconstructionScale: Number(e.target.value) }))
                }
                className="mt-3 w-full"
              />
            </label>
          </div>

          <button
            onClick={regenerate}
            disabled={isProcessing}
            className="mt-6 w-full rounded-full bg-neutral-900 px-5 py-3 text-sm text-white transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {isAnimating ? "Animate Reconstruction" : "Reconstruct Memory"}
          </button>
        </div>

        <div className="mx-auto w-full max-w-2xl text-center">
          <p className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
            Try Examples
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePreset(preset.source, preset.target, preset.style)}
                disabled={isProcessing}
                className="rounded-full border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {presetMessage}
          </p>
        </div>

        <CanvasRenderer
          points={points}
          settings={settings}
          sourceImage={sourceImage}
          targetImage={activeTargetImage}
          transferTargets={transferTargets}
          isAnimating={isAnimating}
          onAnimationComplete={() => setIsAnimating(false)}
        />
      </section>
    </main>
  );
}

function ImageUploadBox({
  id,
  label,
  helper,
  previewUrl,
  fileName,
  onFile,
}: {
  id: string;
  label: string;
  helper?: string;
  previewUrl: string;
  fileName: string;
  onFile: (file: File) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer flex-col items-center justify-center rounded border border-dashed border-neutral-300 px-5 py-7 text-center transition hover:bg-white/70"
    >
      <Upload className="mb-3 h-7 w-7 text-neutral-500" />
      <span className="text-sm text-neutral-700">{label}</span>
      {helper && (
        <span className="mt-2 text-xs text-neutral-400">{helper}</span>
      )}
      <span className="mt-2 text-xs text-neutral-400">JPG, PNG, WEBP</span>
      <input
        id={id}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      {previewUrl && (
        <figure className="mt-4 flex max-w-[180px] flex-col items-center gap-2">
          <div className="overflow-hidden rounded border border-neutral-200 bg-[#f6f1e8] p-1 shadow-sm">
            <Image
              src={previewUrl}
              alt=""
              width={180}
              height={112}
              unoptimized
              className="max-h-28 w-auto object-contain grayscale-[12%]"
            />
          </div>
          <figcaption className="max-w-full truncate text-center text-xs text-neutral-500">
            {fileName}
          </figcaption>
        </figure>
      )}
    </label>
  );
}

function getTargetStatus(
  target: HTMLImageElement | null,
  settings: RenderSettings,
  hasUploadedTarget: boolean
) {
  if (hasUploadedTarget && target) return "Target image loaded";
  if (target && settings.paintingSource !== "none") return "Using built-in target";
  return "No target image selected";
}
