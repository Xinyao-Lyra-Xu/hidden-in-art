"use client";

import { Upload } from "lucide-react";

type Props = {
  previewUrl: string;
  fileName: string;
  disabled: boolean;
  onFile: (f: File) => void;
};

export default function UploadBox({ previewUrl, fileName, disabled, onFile }: Props) {
  return (
    <label
      htmlFor="photo-upload"
      className={`flex cursor-pointer touch-manipulation flex-col items-center justify-center rounded border border-dashed border-neutral-300 px-3 py-4 text-center transition hover:bg-white/70 sm:px-5 sm:py-8 ${
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
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
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
