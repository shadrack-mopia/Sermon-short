"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Copy, Minus, Play, Plus } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { cn, formatDuration, formatTime } from "@/lib/format";
import type { ApiState } from "@/lib/hooks";
import type {
  Aspect,
  BrandKit,
  CaptionPosition,
  Clip,
  ClipOptions,
  Quality,
  Template,
  TemplateStyle,
} from "@/lib/types";
import { CaptionPreview } from "../caption-preview";
import { SegmentPlayer, type SegmentPlayerHandle } from "../segment-player";
import { Button } from "../ui/button";
import { Field, Input, Label, Textarea } from "../ui/input";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  IconPicker,
  PositionPicker,
  RangeField,
  WatermarkPreview,
  type WatermarkLook,
} from "../watermark";
import { parseHashtags, round, type Draft } from "./draft";

type Update = (p: Partial<Draft>) => void;
type UpdateOptions = (p: Partial<ClipOptions>) => void;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      disabled={!text}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {done ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function LabelRow({ label, copy }: { label: string; copy?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <Label className="mb-0">{label}</Label>
      {copy !== undefined && <CopyButton text={copy} />}
    </div>
  );
}

export function DetailsPanel({
  draft,
  update,
  clip,
}: {
  draft: Draft;
  update: Update;
  clip: Clip;
}) {
  const tags = parseHashtags(draft.hashtags);
  return (
    <div className="space-y-5">
      <div>
        <LabelRow label="Title" copy={draft.title} />
        <Input
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          maxLength={300}
        />
      </div>
      <div>
        <LabelRow label="Description" copy={draft.description} />
        <Textarea
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={3}
        />
      </div>
      <div>
        <LabelRow label="Social caption" copy={draft.caption} />
        <Textarea
          value={draft.caption}
          onChange={(e) => update({ caption: e.target.value })}
          rows={4}
          placeholder="Caption to paste into TikTok / Reels / Shorts"
        />
      </div>
      <div>
        <LabelRow label="Hashtags" copy={tags.join(" ")} />
        <Input
          value={draft.hashtags}
          onChange={(e) => update({ hashtags: e.target.value })}
          placeholder="#faith #sermon #jesus"
        />
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {(clip.reason || clip.transcript) && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          {clip.reason && (
            <div>
              <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Why the AI picked this
              </div>
              <p className="mt-1 text-sm text-slate-700">{clip.reason}</p>
            </div>
          )}
          {clip.transcript && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Transcript
                </span>
                <CopyButton text={clip.transcript} />
              </div>
              <p className="mt-1 max-h-40 overflow-y-auto text-sm leading-relaxed text-slate-700">
                {clip.transcript}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Nudge({
  value,
  onChange,
  label,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min: number;
  max: number;
}) {
  const set = (v: number) => onChange(round(Math.max(min, Math.min(max, v))));
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          onClick={() => set(value - 2)}
          aria-label={`${label} −2s`}
        >
          −2s
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => set(value - 0.5)}
          aria-label={`${label} −0.5s`}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          type="number"
          step={0.1}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set(n);
          }}
          className="h-8 w-24 text-center tabular-nums"
        />
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => set(value + 0.5)}
          aria-label={`${label} +0.5s`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          onClick={() => set(value + 2)}
          aria-label={`${label} +2s`}
        >
          +2s
        </Button>
      </div>
      <div className="mt-1 text-xs text-slate-500 tabular-nums">
        {formatTime(value, true)}
      </div>
    </div>
  );
}

export function TrimPanel({
  draft,
  update,
  clip,
  snap,
  setSnap,
}: {
  draft: Draft;
  update: Update;
  clip: Clip;
  snap: boolean;
  setSnap: (v: boolean) => void;
}) {
  const player = useRef<SegmentPlayerHandle>(null);
  const total =
    clip.sermon_duration_s ?? Math.max(draft.end_s + 60, clip.end_s + 60);
  const winStart = Math.max(0, Math.min(draft.start_s, clip.start_s) - 30);
  const winEnd = Math.min(total, Math.max(draft.end_s, clip.end_s) + 30);
  const span = Math.max(1, winEnd - winStart);
  const dur = draft.end_s - draft.start_s;
  const pct = (t: number) => ((t - winStart) / span) * 100;
  const changed = draft.start_s !== clip.start_s || draft.end_s !== clip.end_s;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Nudge
          label="Start"
          value={draft.start_s}
          min={0}
          max={draft.end_s - 1}
          onChange={(v) => update({ start_s: v })}
        />
        <Nudge
          label="End"
          value={draft.end_s}
          min={draft.start_s + 1}
          max={total}
          onChange={(v) => update({ end_s: v })}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>Whole sermon</span>
          <span>{formatDuration(total)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-100">
          <div
            className="absolute h-full rounded-full bg-indigo-500"
            style={{
              left: `${(draft.start_s / total) * 100}%`,
              width: `${Math.max(0.5, (dur / total) * 100)}%`,
            }}
          />
        </div>

        <div className="mt-5 mb-2 flex items-center justify-between text-xs text-slate-500">
          <span className="tabular-nums">{formatTime(winStart)}</span>
          <span>Zoomed timeline</span>
          <span className="tabular-nums">{formatTime(winEnd)}</span>
        </div>
        <div className="relative h-12 overflow-hidden rounded-xl bg-slate-100">
          {/* original range ghost */}
          <div
            className="absolute inset-y-0 border-x border-dashed border-slate-400/60"
            style={{
              left: `${pct(clip.start_s)}%`,
              width: `${pct(clip.end_s) - pct(clip.start_s)}%`,
            }}
          />
          <div
            className="bg-brand-gradient absolute inset-y-1 rounded-lg opacity-80 shadow"
            style={{
              left: `${pct(draft.start_s)}%`,
              width: `${Math.max(0.5, pct(draft.end_s) - pct(draft.start_s))}%`,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white mix-blend-luminosity">
            {formatDuration(dur)}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-500">
            Start
            <input
              type="range"
              className="w-full"
              min={winStart}
              max={winEnd}
              step={0.1}
              value={draft.start_s}
              onChange={(e) =>
                update({
                  start_s: round(
                    Math.min(Number(e.target.value), draft.end_s - 1),
                  ),
                })
              }
            />
          </label>
          <label className="text-xs text-slate-500">
            End
            <input
              type="range"
              className="w-full"
              min={winStart}
              max={winEnd}
              step={0.1}
              value={draft.end_s}
              onChange={(e) =>
                update({
                  end_s: round(
                    Math.max(Number(e.target.value), draft.start_s + 1),
                  ),
                })
              }
            />
          </label>
        </div>
        {(dur < 3 || dur > 600) && (
          <p className="mt-2 text-xs text-rose-600">
            Clips must be between 3 seconds and 10 minutes long.
          </p>
        )}
      </div>

      <Switch
        checked={snap}
        onChange={setSnap}
        label="Snap to sentences"
        description="Moves the edges to the nearest sentence start/end so the clip doesn't cut a word in half."
      />

      {clip.sermon_video_url && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Preview this range (original video)</Label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                player.current?.playRange(draft.start_s, draft.end_s)
              }
            >
              <Play className="h-3.5 w-3.5" /> Play range
            </Button>
          </div>
          <SegmentPlayer
            ref={player}
            src={clip.sermon_video_url}
            start={draft.start_s}
            end={draft.end_s}
          />
          {changed && (
            <p className="mt-2 text-xs text-slate-500">
              Changing the trim rebuilds the captions for the new range when you
              save.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const FONTS = [
  "Arial Black",
  "Arial",
  "Impact",
  "Segoe UI",
  "Segoe UI Semibold",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Montserrat",
  "Poppins",
];

function TriSelect({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  fallback?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
        value={value === null ? "" : value ? "on" : "off"}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "on")
        }
      >
        <option value="">
          Template default
          {fallback !== undefined ? ` (${fallback ? "on" : "off"})` : ""}
        </option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </Select>
    </Field>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback?: string;
  onChange: (v: string | null) => void;
}) {
  const shown = value ?? fallback ?? "#ffffff";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={shown}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
          aria-label={label}
        />
        <Input
          value={shown.toUpperCase()}
          readOnly
          className="w-28 font-mono text-xs"
        />
        {value !== null && (
          <button
            className="cursor-pointer text-xs text-slate-500 hover:text-slate-800"
            onClick={() => onChange(null)}
          >
            Reset
          </button>
        )}
      </div>
    </Field>
  );
}

export function StylePanel({
  draft,
  update,
  updateOptions,
  templates,
  advanced,
}: {
  draft: Draft;
  update: Update;
  updateOptions: UpdateOptions;
  templates: ApiState<Template[]>;
  advanced: boolean;
}) {
  const o = draft.options;
  const list = templates.data ?? [];
  const tpl = list.find((t) => t.id === draft.template_id) ?? list[0];
  const base: Partial<TemplateStyle> = tpl?.style ?? {};
  const effective: Partial<TemplateStyle> = {
    ...base,
    font: o.font ?? base.font,
    font_size: o.font_size ?? base.font_size,
    primary_color: o.primary_color ?? base.primary_color,
    highlight_color: o.highlight_color ?? base.highlight_color,
    position: o.caption_position ?? base.position,
    uppercase: o.uppercase ?? base.uppercase,
    bg_box: o.bg_box ?? base.bg_box,
  };

  return (
    <div className="space-y-6">
      <Switch
        checked={o.captions}
        onChange={(v) => updateOptions({ captions: v })}
        label="Burn in captions"
        description="Animated word-by-word subtitles on the video."
      />

      <div
        className={cn(
          "space-y-6",
          !o.captions && "pointer-events-none opacity-40",
        )}
      >
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Caption template</Label>
            <Link
              href="/templates"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Manage templates
            </Link>
          </div>
          {templates.error && !templates.data ? (
            <p className="text-sm text-rose-600">{templates.error}</p>
          ) : !templates.data ? (
            <div className="flex gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 w-24" />
              ))}
            </div>
          ) : (
            <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
              {list.map((t) => {
                const active = (draft.template_id ?? list[0]?.id) === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => update({ template_id: t.id })}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-xl p-1 text-left transition",
                      active
                        ? "bg-indigo-50 ring-2 ring-indigo-500"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <CaptionPreview style={t.style} width={92} />
                    <div className="mt-1 w-[92px] truncate px-0.5 text-[11px] font-medium text-slate-700">
                      {t.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {draft.template_id === null && list.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Using the brand kit / default template.
            </p>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Font">
              <Input
                list="font-list"
                value={o.font ?? ""}
                placeholder={base.font ?? "Template default"}
                onChange={(e) =>
                  updateOptions({ font: e.target.value || null })
                }
              />
              <datalist id="font-list">
                {FONTS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field
              label={`Font size ${o.font_size ?? `(default ${base.font_size ?? "—"})`}`}
            >
              <div className="flex h-10 items-center gap-2">
                <input
                  type="range"
                  min={24}
                  max={160}
                  value={o.font_size ?? base.font_size ?? 64}
                  onChange={(e) =>
                    updateOptions({ font_size: Number(e.target.value) })
                  }
                  className="flex-1"
                />
                {o.font_size !== null && (
                  <button
                    className="cursor-pointer text-xs text-slate-500 hover:text-slate-800"
                    onClick={() => updateOptions({ font_size: null })}
                  >
                    Reset
                  </button>
                )}
              </div>
            </Field>
            <ColorField
              label="Text colour"
              value={o.primary_color}
              fallback={base.primary_color}
              onChange={(v) => updateOptions({ primary_color: v })}
            />
            <ColorField
              label="Highlight colour"
              value={o.highlight_color}
              fallback={base.highlight_color}
              onChange={(v) => updateOptions({ highlight_color: v })}
            />
            <Field label="Position">
              <Select
                value={o.caption_position ?? ""}
                onChange={(e) =>
                  updateOptions({
                    caption_position: (e.target.value ||
                      null) as CaptionPosition | null,
                  })
                }
              >
                <option value="">
                  Template default{base.position ? ` (${base.position})` : ""}
                </option>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="lower">Lower third</option>
                <option value="bottom">Bottom</option>
              </Select>
            </Field>
            <TriSelect
              label="Uppercase"
              value={o.uppercase}
              onChange={(v) => updateOptions({ uppercase: v })}
              fallback={base.uppercase}
            />
            {advanced && (
              <TriSelect
                label="Background box"
                value={o.bg_box}
                onChange={(v) => updateOptions({ bg_box: v })}
                fallback={base.bg_box}
              />
            )}
          </div>
          <div className="flex flex-col items-center">
            <Label>Preview</Label>
            <CaptionPreview style={effective} width={170} />
            <p className="mt-2 max-w-[170px] text-center text-[11px] text-slate-400">
              Approximate — the rendered clip is the final word.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandingPanel({
  draft,
  update,
  updateOptions,
  kits,
  clip,
  advanced,
}: {
  draft: Draft;
  update: Update;
  updateOptions: UpdateOptions;
  kits: ApiState<BrandKit[]>;
  clip: Clip;
  advanced: boolean;
}) {
  const kit = kits.data?.find((k) => k.id === draft.brand_kit_id);
  const o = draft.options;
  const hasWatermark =
    !!kit && (!!kit.watermark_text?.trim() || kit.social_icons.length > 0);
  const overridden =
    o.wm_position !== null ||
    o.wm_size !== null ||
    o.wm_opacity !== null ||
    o.wm_icons !== null;
  const look: WatermarkLook | null = kit
    ? {
        text: kit.watermark_text ?? "",
        icons: o.wm_icons ?? kit.social_icons,
        position: o.wm_position ?? kit.watermark_position,
        size: o.wm_size ?? kit.watermark_size,
        opacity: o.wm_opacity ?? kit.watermark_opacity,
        font: kit.font,
      }
    : null;
  return (
    <div className="space-y-6">
      <Field label="Brand kit">
        <Select
          value={draft.brand_kit_id ?? ""}
          onChange={(e) => update({ brand_kit_id: e.target.value || null })}
          disabled={!kits.data}
        >
          <option value="">None</option>
          {kits.data?.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.is_default ? " (default)" : ""}
            </option>
          ))}
        </Select>
        {kits.error && (
          <p className="mt-1 text-xs text-rose-600">{kits.error}</p>
        )}
      </Field>
      {kit && (
        <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {kit.logo_url ? (
              <img
                src={kit.logo_url}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[10px] text-slate-400">No logo</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">{kit.name}</div>
            <div className="mt-1 flex gap-1.5">
              {Object.values(kit.colors).map((c, i) => (
                <span
                  key={i}
                  className="h-5 w-5 rounded-full ring-1 ring-black/10"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        className={cn(
          "space-y-4",
          !draft.brand_kit_id && "pointer-events-none opacity-40",
        )}
      >
        <Switch
          checked={o.logo}
          onChange={(v) => updateOptions({ logo: v })}
          label="Show logo"
          description={
            kit && !kit.logo_url
              ? "This brand kit has no logo uploaded yet."
              : "Placed in the corner set by the brand kit."
          }
        />
        <Switch
          checked={o.watermark}
          onChange={(v) => updateOptions({ watermark: v })}
          label="Show watermark"
          description={
            kit && !hasWatermark
              ? "This brand kit has no watermark text or social icons yet."
              : "Social icons and text from the brand kit."
          }
        />
      </div>

      {kit && hasWatermark && o.watermark && look && (
        <div className="@container rounded-xl border border-slate-200 p-4">
          <div className="flex flex-col gap-5 @lg:flex-row">
            <div className="min-w-0 flex-1 space-y-4">
              {advanced ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      Watermark for this clip
                    </div>
                    {overridden && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateOptions({
                            wm_position: null,
                            wm_size: null,
                            wm_opacity: null,
                            wm_icons: null,
                          })
                        }
                      >
                        Use brand kit settings
                      </Button>
                    )}
                  </div>
                  <div>
                    <Label>Social media icons</Label>
                    <IconPicker
                      value={look.icons}
                      onChange={(v) => updateOptions({ wm_icons: v })}
                    />
                  </div>
                  <div className="flex flex-wrap items-start gap-5">
                    <div>
                      <Label>Position</Label>
                      <PositionPicker
                        label="Watermark position"
                        value={look.position}
                        onChange={(p) => updateOptions({ wm_position: p })}
                        other={
                          o.logo && kit.logo_url ? kit.logo_position : null
                        }
                        otherLabel="Logo"
                      />
                    </div>
                    <div className="min-w-[150px] flex-1 space-y-3">
                      <RangeField
                        label="Size"
                        value={look.size}
                        min={50}
                        max={300}
                        step={10}
                        onChange={(v) => updateOptions({ wm_size: v })}
                      />
                      <RangeField
                        label="Opacity"
                        value={look.opacity}
                        min={10}
                        max={100}
                        onChange={(v) => updateOptions({ wm_opacity: v })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    {overridden
                      ? "This clip uses its own watermark settings."
                      : "Using the brand kit's settings. Changes here apply to this clip only."}{" "}
                    The text comes from the brand kit.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Switch to <strong>Advanced</strong> to change the
                  watermark&apos;s position, size and social icons for this
                  clip.
                </p>
              )}
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <Label>Preview</Label>
              <WatermarkPreview
                look={look}
                aspect={draft.aspect}
                width={draft.aspect === "16:9" ? 240 : 150}
                logoUrl={o.logo ? kit.logo_url : null}
                logoPosition={kit.logo_position}
                backgroundUrl={clip.thumbnail_url}
              />
            </div>
          </div>
        </div>
      )}
      <Link
        href="/brand"
        className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        Edit brand kits →
      </Link>
    </div>
  );
}

const QUALITY_HINTS: Record<Quality, string> = {
  standard: "Visually close to the original at phone sizes. Smallest files.",
  high: "Finer detail in faces and text. Files are about 1.5× larger.",
  max: "Near-lossless, for archiving or re-editing. Files are about 2.5× larger and render slower.",
};

const ASPECTS: { value: Aspect; label: string; box: string; ratio: number }[] =
  [
    {
      value: "9:16",
      label: "9:16 Vertical",
      box: "h-8 w-[18px]",
      ratio: 9 / 16,
    },
    { value: "1:1", label: "1:1 Square", box: "h-6 w-6", ratio: 1 },
    { value: "16:9", label: "16:9 Wide", box: "h-[18px] w-8", ratio: 16 / 9 },
  ];

export function FormatPanel({
  draft,
  update,
  updateOptions,
  clip,
  advanced,
}: {
  draft: Draft;
  update: Update;
  updateOptions: UpdateOptions;
  clip: Clip;
  advanced: boolean;
}) {
  const [thumbOk, setThumbOk] = useState(true);
  const o = draft.options;
  const ratio = ASPECTS.find((a) => a.value === draft.aspect)?.ratio ?? 9 / 16;
  const cropW = Math.min(1, ratio / (16 / 9)); // assumes a 16:9 source
  return (
    <div className="space-y-6">
      <div>
        <Label>Aspect ratio</Label>
        <div className="grid grid-cols-3 gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => update({ aspect: a.value })}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition",
                draft.aspect === a.value
                  ? "border-indigo-500 bg-indigo-50/60 text-indigo-700 ring-1 ring-indigo-500"
                  : "border-slate-200 text-slate-600 hover:border-slate-300",
              )}
            >
              <span className="flex h-9 items-center">
                <span
                  className={cn(
                    "rounded-[3px] border-2",
                    a.box,
                    draft.aspect === a.value
                      ? "border-indigo-500"
                      : "border-slate-400",
                  )}
                />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="Export quality"
        hint={QUALITY_HINTS[o.quality ?? "standard"]}
      >
        <Select
          value={o.quality ?? "standard"}
          onChange={(e) =>
            updateOptions({ quality: e.target.value as Quality })
          }
        >
          <option value="standard">Standard: great for social media</option>
          <option value="high">High: sharper detail, larger file</option>
          <option value="max">Maximum: archive quality, largest file</option>
        </Select>
      </Field>

      {advanced && (
        <>
          <Field label="Resolution">
            <Select
              value={String(o.resolution)}
              onChange={(e) =>
                updateOptions({
                  resolution: Number(e.target.value) as 720 | 1080,
                })
              }
            >
              <option value="1080">1080p (best quality)</option>
              <option value="720">720p (smaller, faster to render)</option>
            </Select>
          </Field>

          {draft.aspect !== "16:9" && (
            <div className="space-y-3">
              <Switch
                checked={o.crop_x === null}
                onChange={(v) => updateOptions({ crop_x: v ? null : 0.5 })}
                label="Automatic framing"
                description="Follows the speaker's face. Turn off to position the frame yourself."
              />
              <div
                className={cn("space-y-2", o.crop_x === null && "opacity-50")}
              >
                <div className="relative aspect-video overflow-hidden rounded-xl bg-navy-900">
                  {thumbOk && (
                    <img
                      src={`/api/sermons/${clip.sermon_id}/thumbnail`}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-80"
                      onError={() => setThumbOk(false)}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40" />
                  <div
                    className="absolute inset-y-0 border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                    style={{
                      width: `${cropW * 100}%`,
                      left: `${(o.crop_x ?? 0.5) * (1 - cropW) * 100}%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={o.crop_x === null}
                  value={o.crop_x ?? 0.5}
                  onChange={(e) =>
                    updateOptions({ crop_x: Number(e.target.value) })
                  }
                  className="w-full"
                  aria-label="Horizontal framing"
                />
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Left</span>
                  <span>Centre</span>
                  <span>Right</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {!advanced && (
        <p className="text-xs text-slate-500">
          Switch to Advanced for resolution and manual framing.
        </p>
      )}
    </div>
  );
}
