"use client";

import { Camera, Loader2, Upload } from "lucide-react";

type Props = {
  previewUrl: string;
  fileName: string;
  disabled: boolean;
  isProcessing?: boolean;
  onFile: (f: File) => void;
};

export default function UploadBox({ previewUrl, fileName, disabled, isProcessing = false, onFile }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    // Reset so the same file can be selected again
    e.target.value = "";
  }

  return (
    <>
      {/*
        ── Desktop (≥ 640 px) ─────────────────────────────────────────────────
        Original full-box label: clicking anywhere in the dashed area opens the
        system file-picker. No capture attribute → allows photo library access.
      */}
      <label
        htmlFor="photo-upload"
        className={`hidden cursor-pointer touch-manipulation flex-col items-center justify-center rounded border border-dashed border-neutral-300 px-3 py-4 text-center transition hover:bg-white/70 sm:flex sm:px-5 sm:py-8 ${
          disabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mb-2 h-6 w-6 animate-spin text-neutral-400" aria-hidden="true" />
            <span className="text-sm text-neutral-500">Analysing photo…</span>
          </>
        ) : (
          <>
            <Upload className="mb-3 h-7 w-7 text-neutral-400" aria-hidden="true" />
            <span className="text-sm text-neutral-600">
              {previewUrl ? "Change photo" : "Upload your photo"}
            </span>
            <span className="mt-1 text-xs text-neutral-400">JPG · PNG · WEBP</span>
          </>
        )}
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

      {/*
        ── Mobile (< 640 px) ──────────────────────────────────────────────────
        Two distinct buttons so the user can choose between:
          • Photo library  → #photo-upload input  (no capture attribute)
          • Camera         → #photo-camera input  (capture="environment")

        Both inputs are display:none. Labels with htmlFor trigger them — this is
        standard HTML and works on iOS Safari and Android Chrome.
      */}
      <div
        className={`flex flex-col items-center gap-3 rounded border border-dashed border-neutral-300 px-3 py-4 sm:hidden ${
          disabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {isProcessing ? (
          <div className="flex w-full items-center justify-center gap-2 py-1 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Analysing photo…
          </div>
        ) : (
          <>
            <div className="flex w-full gap-3">
              <label
                htmlFor="photo-upload"
                className="flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:bg-white/70 active:scale-[0.97]"
              >
                <Upload className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                {previewUrl ? "Change" : "From library"}
              </label>
              <label
                htmlFor="photo-camera"
                className="flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:bg-white/70 active:scale-[0.97]"
              >
                <Camera className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                Take photo
              </label>
            </div>
            <span className="text-xs text-neutral-400">JPG · PNG · WEBP</span>
          </>
        )}

        {previewUrl && (
          <div className="w-full overflow-hidden rounded border border-neutral-200 bg-neutral-50 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="mx-auto max-h-28 w-auto object-contain"
            />
            <p className="truncate px-2 py-1 text-xs text-neutral-400">{fileName}</p>
          </div>
        )}
      </div>

      {/*
        Shared hidden inputs — display:none is intentional.
        Labels trigger them via htmlFor/for, which works with display:none in all
        modern browsers. ActionStrip also calls #photo-upload.click() programmatically;
        this works inside a user-gesture handler (button click) on iOS and Android.
      */}
      <input
        id="photo-upload"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={handleChange}
      />
      <input
        id="photo-camera"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={handleChange}
      />
    </>
  );
}
