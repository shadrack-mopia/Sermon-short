import type { Aspect, Clip, ClipOptions } from "@/lib/types";

export interface Draft {
  title: string;
  description: string;
  caption: string;
  hashtags: string;
  start_s: number;
  end_s: number;
  aspect: Aspect;
  template_id: string | null;
  brand_kit_id: string | null;
  options: ClipOptions;
}

export const DEFAULT_OPTIONS: ClipOptions = {
  captions: true,
  logo: true,
  watermark: false,
  caption_position: null,
  font_size: null,
  font: null,
  primary_color: null,
  highlight_color: null,
  bg_box: null,
  uppercase: null,
  crop_x: null,
  resolution: 1080,
  quality: "standard",
  wm_position: null,
  wm_size: null,
  wm_opacity: null,
  wm_icons: null,
};

export function draftFromClip(c: Clip): Draft {
  return {
    title: c.title ?? "",
    description: c.description ?? "",
    caption: c.caption ?? "",
    hashtags: (c.hashtags ?? []).join(" "),
    start_s: c.start_s,
    end_s: c.end_s,
    aspect: c.aspect,
    template_id: c.template_id,
    brand_kit_id: c.brand_kit_id,
    options: { ...DEFAULT_OPTIONS, ...(c.options ?? {}) } as ClipOptions,
  };
}

export function parseHashtags(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Builds the PATCH body with only changed fields; `rerender` says whether the backend will re-render. */
export function diffDraft(base: Draft, d: Draft, snap: boolean): { body: Record<string, unknown>; rerender: boolean; empty: boolean } {
  const body: Record<string, unknown> = {};
  let rerender = false;
  if (d.title !== base.title) body.title = d.title.trim() || "Untitled clip";
  if (d.description !== base.description) body.description = d.description;
  if (d.caption !== base.caption) body.caption = d.caption;
  if (!same(parseHashtags(d.hashtags), parseHashtags(base.hashtags))) body.hashtags = parseHashtags(d.hashtags);
  if (d.start_s !== base.start_s || d.end_s !== base.end_s) {
    body.start_s = round(d.start_s);
    body.end_s = round(d.end_s);
    body.snap = snap;
    rerender = true;
  }
  if (d.aspect !== base.aspect) {
    body.aspect = d.aspect;
    rerender = true;
  }
  if (d.template_id !== base.template_id) {
    body.template_id = d.template_id;
    rerender = true;
  }
  if (d.brand_kit_id !== base.brand_kit_id) {
    if (d.brand_kit_id === null) body.clear_brand_kit = true;
    else body.brand_kit_id = d.brand_kit_id;
    rerender = true;
  }
  if (!same(d.options, base.options)) {
    body.options = d.options;
    rerender = true;
  }
  return { body, rerender, empty: Object.keys(body).length === 0 };
}

export const round = (n: number) => Math.round(n * 100) / 100;
