"use client";

import { MATCH_METHODS } from "@/domain/matching/strategy";
import type { MatchMethod } from "@/domain/matching/strategy";

type Props = {
  value: MatchMethod;
  onChange: (m: MatchMethod) => void;
};

export default function MethodPicker({ value, onChange }: Props) {
  return (
    <div className="mb-5">
      <p className="museum-label mb-2 text-neutral-500">Matching Method</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {MATCH_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.description}
            onClick={() => onChange(m.id)}
            className={`rounded border px-2.5 py-1.5 text-left text-xs transition active:scale-[0.97] ${
              value === m.id
                ? "border-neutral-800 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white/70 text-neutral-600 hover:border-neutral-400 hover:bg-white"
            }`}
          >
            <span className="block font-semibold leading-tight">{m.label}</span>
            <span className="mt-0.5 block leading-snug opacity-70">{m.description.split("—")[0].trim()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
