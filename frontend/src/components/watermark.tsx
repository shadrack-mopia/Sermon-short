"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import type {
  Aspect,
  GridPosition,
  LogoPosition,
  SocialIcon,
  WatermarkPosition,
} from "@/lib/types";

export const SOCIAL_ICONS: { value: SocialIcon; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
  { value: "whatsapp", label: "WhatsApp" },
];

/** 6 rows × 3 columns, matching the renderer's placement grid. */
export const GRID_ROWS = 6;
export const GRID_COLS = 3;
export const GRID_POSITIONS: GridPosition[] = Array.from(
  { length: GRID_ROWS * GRID_COLS },
  (_, i) => `r${Math.floor(i / GRID_COLS)}c${i % GRID_COLS}` as GridPosition,
);

const COL_LABEL = ["left", "centre", "right"];

export function gridCell(p: GridPosition): [number, number] {
  return [Number(p[1]), Number(p[3])];
}

/** "Row 1, left" — row counted from the top. */
export function positionLabel(p: GridPosition): string {
  const [r, c] = gridCell(p);
  return `Row ${r + 1}, ${COL_LABEL[c]}`;
}

/**
 * Pixel offset of an item of size (w, h) in a frame (W, H) — the same formula the renderer uses:
 * columns at left / centre / right, rows spread evenly between the top and bottom margins.
 */
function placeInGrid(
  p: GridPosition,
  W: number,
  H: number,
  w: number,
  h: number,
  margin: number,
) {
  const [r, c] = gridCell(p);
  return {
    left: margin + ((W - 2 * margin - w) * c) / (GRID_COLS - 1),
    top: margin + ((H - 2 * margin - h) * r) / (GRID_ROWS - 1),
  };
}

export interface WatermarkLook {
  text: string;
  icons: SocialIcon[];
  position: WatermarkPosition;
  size: number;
  opacity: number;
  font?: string | null;
}

/** URL of the exact watermark image the renderer burns into clips (sized for a 1080-wide frame). */
export function watermarkPreviewUrl(
  w: Pick<WatermarkLook, "text" | "icons" | "size" | "opacity" | "font">,
): string | null {
  if (!w.text.trim() && !w.icons.length) return null;
  const p = new URLSearchParams({
    text: w.text.trim(),
    icons: w.icons.join(","),
    size: String(w.size),
    opacity: String(w.opacity),
  });
  if (w.font) p.set("font", w.font);
  return `/api/watermark/preview?${p}`;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const OUTPUT: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

/**
 * A scaled-down clip frame showing where the watermark (and logo) will land.
 * Uses the same image, sizes and margins as the renderer, so it matches the final clip.
 */
export function WatermarkPreview({
  look,
  aspect = "9:16",
  width = 180,
  logoUrl,
  logoPosition,
  backgroundUrl,
  className,
}: {
  look: WatermarkLook;
  aspect?: Aspect;
  width?: number;
  logoUrl?: string | null;
  logoPosition?: LogoPosition;
  backgroundUrl?: string | null;
  className?: string;
}) {
  const [ow, oh] = OUTPUT[aspect];
  const scale = width / ow;
  const height = oh * scale;
  const margin = Math.min(ow, oh) * 0.04 * scale;
  const logoW = Math.min(ow, oh) * 0.16 * scale;
  const src = useDebounced(watermarkPreviewUrl(look));
  const [natural, setNatural] = useState<{
    src: string;
    w: number;
    h: number;
  } | null>(null);
  const [logoRatio, setLogoRatio] = useState(1);
  const [bgOk, setBgOk] = useState(true);
  const size =
    natural && natural.src === src
      ? { w: natural.w * scale, h: natural.h * scale }
      : null;
  const logoH = logoW * logoRatio;
  const showLogo = !!(logoUrl && logoPosition);

  // same placement as the renderer (overlay_xy / avoid_overlap_dy in backend/app/pipeline/watermark.py)
  let wmStyle: React.CSSProperties = { position: "absolute" };
  if (size) {
    const { left, top } = placeInGrid(
      look.position,
      width,
      height,
      size.w,
      size.h,
      margin,
    );
    let dy = 0;
    if (showLogo && look.position === logoPosition) {
      const shift = logoH + margin / 2;
      dy = gridCell(look.position)[0] < GRID_ROWS / 2 ? shift : -shift; // step off the logo
    }
    wmStyle = { position: "absolute", left, top: top + dy };
  }
  const logoStyle: React.CSSProperties = {
    position: "absolute",
    width: logoW,
    opacity: 0.92,
  };
  if (logoPosition)
    Object.assign(
      logoStyle,
      placeInGrid(logoPosition, width, height, logoW, logoH, margin),
    );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-gradient-to-b from-slate-600 via-slate-700 to-navy-900 shadow-inner ring-1 ring-black/10",
        className,
      )}
      style={{ width, height }}
    >
      {backgroundUrl && bgOk && (
        <img
          src={backgroundUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBgOk(false)}
        />
      )}
      {logoUrl && logoPosition && (
        <img
          src={logoUrl}
          alt=""
          style={logoStyle}
          onLoad={(e) =>
            setLogoRatio(
              e.currentTarget.naturalHeight /
                Math.max(1, e.currentTarget.naturalWidth),
            )
          }
        />
      )}
      {src && (
        <img
          key={src}
          src={src}
          alt="Watermark preview"
          style={{
            ...wmStyle,
            width: size?.w,
            height: size?.h,
            visibility: size ? "visible" : "hidden",
          }}
          onLoad={(e) =>
            setNatural({
              src,
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
        />
      )}
      {!src && (
        <div className="absolute inset-x-2 bottom-2 rounded bg-black/40 px-1.5 py-1 text-center text-[10px] text-white/80">
          Add text or an icon to see the watermark
        </div>
      )}
    </div>
  );
}

/**
 * 3 columns × 6 rows picker shaped like a phone screen.
 * `other` marks where something else sits (e.g. the logo) so the two can be arranged together.
 */
export function PositionPicker({
  value,
  onChange,
  disabled,
  label = "Position",
  other,
  otherLabel,
}: {
  value: GridPosition;
  onChange: (p: GridPosition) => void;
  disabled?: boolean;
  label?: string;
  other?: GridPosition | null;
  otherLabel?: string;
}) {
  return (
    <div
      className={cn("w-[112px]", disabled && "pointer-events-none opacity-50")}
    >
      <div
        className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1.5"
        role="radiogroup"
        aria-label={label}
      >
        {GRID_POSITIONS.map((p) => {
          const on = value === p;
          const isOther = !on && other === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${positionLabel(p)}${isOther && otherLabel ? ` (${otherLabel})` : ""}`}
              title={`${positionLabel(p)}${isOther && otherLabel ? ` — ${otherLabel}` : ""}`}
              onClick={() => onChange(p)}
              className={cn(
                "flex h-7 cursor-pointer items-center justify-center rounded-md text-[9px] font-semibold transition",
                on
                  ? "bg-indigo-600 shadow-sm"
                  : isOther
                    ? "bg-amber-100 text-amber-700 hover:bg-indigo-50"
                    : "bg-white hover:bg-indigo-50",
              )}
            >
              {isOther && otherLabel ? (
                otherLabel[0]
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    on ? "bg-white" : "bg-slate-300",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-center text-[11px] text-slate-500">
        {positionLabel(value)}
      </div>
    </div>
  );
}

export function IconPicker({
  value,
  onChange,
  disabled,
}: {
  value: SocialIcon[];
  onChange: (icons: SocialIcon[]) => void;
  disabled?: boolean;
}) {
  const toggle = (i: SocialIcon) =>
    onChange(
      value.includes(i)
        ? value.filter((x) => x !== i)
        : SOCIAL_ICONS.map((s) => s.value).filter(
            (s) => s === i || value.includes(s),
          ),
    );
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {SOCIAL_ICONS.map(({ value: icon, label }) => {
        const on = value.includes(icon);
        return (
          <button
            key={icon}
            type="button"
            onClick={() => toggle(icon)}
            aria-pressed={on}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition",
              on
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300",
            )}
          >
            <img
              src={`/api/watermark/preview?icons=${icon}&size=60&opacity=100`}
              alt=""
              className={cn("h-4 w-auto", !on && "opacity-50 grayscale")}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 5,
  suffix = "%",
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("block", disabled && "opacity-50")}>
      <span className="mb-1 flex justify-between text-sm font-medium text-slate-700">
        {label}
        <span className="font-normal text-slate-500 tabular-nums">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </label>
  );
}
