import type { CSSProperties } from "react";
import { cn } from "@/lib/format";
import type { TemplateStyle } from "@/lib/types";

const SAMPLE = "Faith does not remove the storm it carries you through it";

const POS: Record<string, string> = { top: "14%", middle: "50%", lower: "70%", bottom: "86%" };

/**
 * A CSS approximation of how the burned-in ASS captions look: one caption "line" of
 * `words_per_line` words over a dark 9:16 frame, with one word in the highlight colour.
 * Sizes are scaled from the 1080x1920 render canvas to the preview width.
 */
export function CaptionPreview({
  style,
  width = 200,
  text = SAMPLE,
  className,
  background,
}: {
  style: Partial<TemplateStyle>;
  width?: number;
  text?: string;
  className?: string;
  background?: string;
}) {
  const scale = width / 1080;
  const words = text.split(/\s+/).filter(Boolean);
  const per = Math.max(1, Math.min(8, style.words_per_line ?? 3));
  const line = words.slice(2, 2 + per);
  const hiIdx = style.animation === "none" ? -1 : Math.min(1, line.length - 1);
  const fontPx = Math.max(8, (style.font_size ?? 64) * scale * 1.15);
  const outline = Math.max(0, (style.outline ?? 0) * scale * 1.6);
  const oc = style.outline_color ?? "#000000";
  const shadow = Math.max(0, (style.shadow ?? 0) * scale * 2.5);
  const shadows: string[] = [];
  if (outline > 0) {
    for (const [x, y] of [
      [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
    ])
      shadows.push(`${x * outline}px ${y * outline}px 0 ${oc}`);
  }
  if (shadow > 0) shadows.push(`${shadow}px ${shadow}px ${shadow}px rgba(0,0,0,0.75)`);

  const textStyle: CSSProperties = {
    fontFamily: `"${style.font ?? "Arial"}", "Segoe UI", Arial, sans-serif`,
    fontSize: fontPx,
    fontWeight: 800,
    lineHeight: 1.15,
    color: style.primary_color ?? "#FFFFFF",
    textTransform: style.uppercase ? "uppercase" : "none",
    textShadow: shadows.join(", ") || undefined,
    backgroundColor: style.bg_box ? `${style.bg_color ?? "#000000"}cc` : undefined,
    padding: style.bg_box ? `${fontPx * 0.18}px ${fontPx * 0.35}px` : undefined,
    borderRadius: style.bg_box ? fontPx * 0.2 : undefined,
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };

  return (
    <div
      className={cn("relative aspect-[9/16] overflow-hidden rounded-xl", className)}
      style={{
        width,
        background: background ?? "radial-gradient(120% 80% at 50% 30%, #2a3358 0%, #121833 55%, #070b1a 100%)",
      }}
    >
      {/* silhouette of a speaker, to judge legibility over a subject */}
      <div className="absolute top-[22%] left-1/2 h-[18%] w-[26%] -translate-x-1/2 rounded-full bg-white/10" />
      <div className="absolute top-[38%] left-1/2 h-[50%] w-[58%] -translate-x-1/2 rounded-t-[45%] bg-white/[0.07]" />
      <div className="absolute inset-x-0 px-[6%] text-center" style={{ top: POS[style.position ?? "lower"], transform: "translateY(-50%)" }}>
        <span style={textStyle}>
          {line.map((w, i) => (
            <span
              key={i}
              style={
                i === hiIdx
                  ? {
                      color: style.highlight_color ?? "#FFD400",
                      display: style.animation === "pop" ? "inline-block" : undefined,
                      transform: style.animation === "pop" ? "scale(1.12)" : undefined,
                    }
                  : undefined
              }
            >
              {w}
              {i < line.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
