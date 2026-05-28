"use client";

import type { CSSProperties } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};

export default function Slider({ label, value, min, max, step, onChange }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block text-sm text-neutral-700">
      <span className="block">
        {label}
      </span>
      <span className="museum-tabular mt-1 block font-medium">
        {value}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--slider-pct": `${pct}%` } as CSSProperties}
        className="touch-range mt-2 w-full"
      />
    </label>
  );
}
