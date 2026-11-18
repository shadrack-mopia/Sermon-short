"use client";

import { Field, Input } from "./ui/input";

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
  return (
    <Field label={label} error={valid ? undefined : "Use a hex colour like #6D28D9"}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
          aria-label={label}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value.trim())} className="font-mono text-xs" maxLength={7} />
      </div>
    </Field>
  );
}
