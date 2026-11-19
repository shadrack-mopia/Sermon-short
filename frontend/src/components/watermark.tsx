"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import type { Aspect, LogoPosition, SocialIcon, WatermarkPosition } from "@/lib/types";

export const SOCIAL_ICONS: { value: SocialIcon; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
  { value: "whatsapp", label: "WhatsApp" },
];

export const WM_POSITIONS: WatermarkPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const POSITION_LABEL: Record<WatermarkPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "middle-left": "Middle left",
  center: "Centre",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

export interface WatermarkLook {
  text: string;
  icons: SocialIcon[];
  position: WatermarkPosition;
  size: number;
  opacity: number;
  font?: string | null;
}

/** URL of the exact watermark image the renderer burns into clips (sized for a 1080-wide frame). */
export function watermarkPreviewUrl(w: Pick<WatermarkLook, "text" | "icons" | "size" | "opacity" | "font">): string | null {
  if (!w.text.trim() && !w.icons.length) return null;
  const p = new URLSearchParams({ text: w.text.trim(), icons: w.icons.join(","), size: String(w.size), opacity: String(w.opacity) });
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

const OUTPUT: Record<Aspect, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };

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
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [logoRatio, setLogoRatio] = useState(1);
  const [bgOk, setBgOk] = useState(true);
  const size = natural && natural.src === src ? { w: natural.w * scale, h: natural.h * scale } : null;

  // CSS placement for each of the 9 positions (mirrors overlay_xy in the backend)
  const [row, col] = look.position === "center" ? ["middle", "center"] : (look.position.split("-") as [string, string]);
  const wmStyle: React.CSSProperties = { position: "absolute" };
  if (col === "left") wmStyle.left = margin;
  else if (col === "right") wmStyle.right = margin;
  else {
    wmStyle.left = "50%";
    wmStyle.transform = "translateX(-50%)";
  }
  let yOffset = margin;
  if (logoUrl && logoPosition && look.position === logoPosition) yOffset = margin + logoW * logoRatio + margin / 2;
  if (row === "top") wmStyle.top = yOffset;
  else if (row === "bottom") wmStyle.bottom = yOffset;
  else {
    wmStyle.top = "50%";
    wmStyle.transform = `${wmStyle.transform ?? ""} translateY(-50%)`.trim();
  }

  const logoStyle: React.CSSProperties = { position: "absolute", width: logoW, opacity: 0.92 };
  if (logoPosition) {
    if (logoPosition.startsWith("top")) logoStyle.top = margin;
    else logoStyle.bottom = margin;
    if (logoPosition.endsWith("left")) logoStyle.left = margin;
    else logoStyle.right = margin;
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-xl bg-gradient-to-b from-slate-600 via-slate-700 to-navy-900 shadow-inner ring-1 ring-black/10", className)}
      style={{ width, height }}
    >
      {backgroundUrl && bgOk && (
        <img src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setBgOk(false)} />
      )}
      {logoUrl && logoPosition && (
        <img
          src={logoUrl}
          alt=""
          style={logoStyle}
          onLoad={(e) => setLogoRatio(e.currentTarget.naturalHeight / Math.max(1, e.currentTarget.naturalWidth))}
        />
      )}
      {src && (
        <img
          key={src}
          src={src}
          alt="Watermark preview"
          style={{ ...wmStyle, width: size?.w, height: size?.h, visibility: size ? "visible" : "hidden" }}
          onLoad={(e) => setNatural({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
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

export function PositionPicker({
  value,
  onChange,
  disabled,
}: {
  value: WatermarkPosition;
  onChange: (p: WatermarkPosition) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("grid w-[132px] grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1.5", disabled && "pointer-events-none opacity-50")} role="radiogroup" aria-label="Watermark position">
      {WM_POSITIONS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          aria-label={POSITION_LABEL[p]}
          title={POSITION_LABEL[p]}
          onClick={() => onChange(p)}
          className={cn(
            "flex h-9 cursor-pointer items-center justify-center rounded-lg transition",
            value === p ? "bg-indigo-600 shadow-sm" : "bg-white hover:bg-indigo-50",
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", value === p ? "bg-white" : "bg-slate-300")} />
        </button>
      ))}
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
    onChange(value.includes(i) ? value.filter((x) => x !== i) : SOCIAL_ICONS.map((s) => s.value).filter((s) => s === i || value.includes(s)));
  return (
    <div className={cn("flex flex-wrap gap-1.5", disabled && "pointer-events-none opacity-50")}>
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
              on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300",
            )}
          >
            <img src={`/api/watermark/preview?icons=${icon}&size=60&opacity=100`} alt="" className={cn("h-4 w-auto", !on && "opacity-50 grayscale")} />
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
