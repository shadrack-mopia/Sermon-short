"use client";

import { BookOpen, Flame, Layers, Sparkles } from "lucide-react";
import { cn } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Aspect, BrandKit, Language, Mode, Quality, SermonSettings, Template } from "@/lib/types";
import { Input, Label } from "./ui/input";
import { Select } from "./ui/select";

export const DEFAULT_SETTINGS: SermonSettings = {
  modes: ["all"],
  clip_lengths: [30, 60],
  min_s: null,
  max_s: null,
  max_clips: 0,
  aspect: "9:16",
  template_id: null,
  brand_kit_id: null,
  language: "auto",
  quality: "standard",
};

export function normalizeSettings(s: Partial<SermonSettings> | undefined): SermonSettings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

/** Client-side check mirroring the backend's SermonSettings model. */
export function settingsError(s: SermonSettings): string | null {
  if (!s.modes.length) return "Pick at least one clipping mode.";
  const custom = s.min_s !== null || s.max_s !== null;
  if (custom) {
    if (s.min_s === null || s.max_s === null) return "Enter both a minimum and maximum clip length.";
    if (s.min_s < 5 || s.max_s > 600) return "Custom lengths must be between 5 and 600 seconds.";
    if (s.min_s >= s.max_s) return "Minimum length must be shorter than the maximum.";
  } else if (!s.clip_lengths.length) return "Pick at least one clip length.";
  if (s.max_clips < 0 || s.max_clips > 30) return "Max clips must be between 1 and 30 (or automatic).";
  return null;
}

const MODES: { value: Mode; label: string; desc: string; icon: typeof Flame }[] = [
  { value: "viral", label: "Viral Moments", desc: "Strong hooks and quotable lines", icon: Flame },
  { value: "teaching", label: "Biblical Teaching", desc: "Clear scripture explanations", icon: BookOpen },
  { value: "inspirational", label: "Inspirational", desc: "Encouragement and hope", icon: Sparkles },
  { value: "all", label: "All-in-One", desc: "A balanced mix of everything", icon: Layers },
];

const LENGTHS = [15, 30, 45, 60, 90];
const ASPECTS: { value: Aspect; label: string; box: string }[] = [
  { value: "9:16", label: "Vertical 9:16", box: "h-7 w-4" },
  { value: "1:1", label: "Square 1:1", box: "h-5 w-5" },
  { value: "16:9", label: "Wide 16:9", box: "h-4 w-7" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
        active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
      )}
    >
      {children}
    </button>
  );
}

export function SermonSettingsForm({ value, onChange }: { value: SermonSettings; onChange: (v: SermonSettings) => void }) {
  const templates = useApi<Template[]>("/api/templates");
  const kits = useApi<BrandKit[]>("/api/brand-kits");
  const set = <K extends keyof SermonSettings>(k: K, v: SermonSettings[K]) => onChange({ ...value, [k]: v });
  const custom = value.min_s !== null || value.max_s !== null;

  const toggleMode = (m: Mode) => {
    const has = value.modes.includes(m);
    let modes: Mode[];
    if (m === "all") modes = has ? [] : ["all"];
    else modes = has ? value.modes.filter((x) => x !== m) : [...value.modes.filter((x) => x !== "all"), m];
    set("modes", modes);
  };

  const toggleLength = (n: number) => {
    const has = value.clip_lengths.includes(n);
    onChange({
      ...value,
      min_s: null,
      max_s: null,
      clip_lengths: has ? value.clip_lengths.filter((x) => x !== n) : [...value.clip_lengths, n].sort((a, b) => a - b),
    });
  };

  const num = (s: string): number | null => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))));

  return (
    <div className="space-y-6">
      <div>
        <Label>Clipping mode</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map(({ value: m, label, desc, icon: Icon }) => {
            const active = value.modes.includes(m);
            return (
              <button
                type="button"
                key={m}
                onClick={() => toggleMode(m)}
                aria-pressed={active}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition",
                  active ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500" : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-brand-gradient text-white" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Clip lengths</Label>
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((n) => (
            <Chip key={n} active={!custom && value.clip_lengths.includes(n)} onClick={() => toggleLength(n)}>
              {n}s
            </Chip>
          ))}
          <Chip
            active={custom}
            onClick={() => (custom ? onChange({ ...value, min_s: null, max_s: null }) : onChange({ ...value, min_s: 20, max_s: 75 }))}
          >
            Custom range
          </Chip>
        </div>
        {custom && (
          <div className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={600}
              className="w-24"
              value={value.min_s ?? ""}
              onChange={(e) => set("min_s", num(e.target.value))}
              aria-label="Minimum seconds"
            />
            <span className="text-sm text-slate-500">to</span>
            <Input
              type="number"
              min={5}
              max={600}
              className="w-24"
              value={value.max_s ?? ""}
              onChange={(e) => set("max_s", num(e.target.value))}
              aria-label="Maximum seconds"
            />
            <span className="text-sm text-slate-500">seconds</span>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Number of clips</Label>
          <div className="flex items-center gap-2">
            <Select
              wrapperClassName="flex-1"
              value={value.max_clips === 0 ? "auto" : "custom"}
              onChange={(e) => set("max_clips", e.target.value === "auto" ? 0 : 8)}
            >
              <option value="auto">Automatic (about 1 per 5 min)</option>
              <option value="custom">Up to…</option>
            </Select>
            {value.max_clips > 0 && (
              <Input
                type="number"
                min={1}
                max={30}
                className="w-20"
                value={value.max_clips}
                onChange={(e) => set("max_clips", Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                aria-label="Maximum clips"
              />
            )}
          </div>
        </div>
        <div>
          <Label>Sermon language</Label>
          <Select value={value.language} onChange={(e) => set("language", e.target.value as Language)}>
            <option value="auto">Auto-detect (handles English/Swahili mix)</option>
            <option value="en">English</option>
            <option value="sw">Swahili</option>
          </Select>
        </div>
        <div>
          <Label>Export quality</Label>
          <Select value={value.quality} onChange={(e) => set("quality", e.target.value as Quality)}>
            <option value="standard">Standard: great for social media</option>
            <option value="high">High: sharper detail, larger files</option>
            <option value="max">Maximum: archive quality, largest files</option>
          </Select>
        </div>
      </div>

      <div>
        <Label>Format</Label>
        <div className="grid grid-cols-3 gap-2">
          {ASPECTS.map((a) => (
            <button
              type="button"
              key={a.value}
              onClick={() => set("aspect", a.value)}
              aria-pressed={value.aspect === a.value}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition",
                value.aspect === a.value
                  ? "border-indigo-500 bg-indigo-50/60 text-indigo-700 ring-1 ring-indigo-500"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              <span className="flex h-8 items-center">
                <span className={cn("rounded-[3px] border-2", a.box, value.aspect === a.value ? "border-indigo-500" : "border-slate-400")} />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Caption style</Label>
          <Select value={value.template_id ?? ""} onChange={(e) => set("template_id", e.target.value || null)} disabled={templates.loading}>
            <option value="">Brand kit default</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.builtin ? "" : " (custom)"}
              </option>
            ))}
          </Select>
          {templates.error && <p className="mt-1 text-xs text-rose-600">{templates.error}</p>}
        </div>
        <div>
          <Label>Brand kit</Label>
          <Select value={value.brand_kit_id ?? ""} onChange={(e) => set("brand_kit_id", e.target.value || null)} disabled={kits.loading}>
            <option value="">Default brand kit</option>
            {kits.data?.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {k.is_default ? " (default)" : ""}
              </option>
            ))}
          </Select>
          {kits.error && <p className="mt-1 text-xs text-rose-600">{kits.error}</p>}
        </div>
      </div>
    </div>
  );
}
