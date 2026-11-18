"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Info, Loader2, Upload } from "lucide-react";
import { categoryLabel, CATEGORY_COLORS, cn, humanize, scoreTone } from "@/lib/format";
import { Badge } from "./ui/badge";

export function SermonStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ready":
      return (
        <Badge tone="green">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </Badge>
      );
    case "processing":
      return (
        <Badge tone="indigo">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing
        </Badge>
      );
    case "queued":
      return (
        <Badge tone="amber">
          <Clock className="h-3 w-3" /> Queued
        </Badge>
      );
    case "uploading":
      return (
        <Badge tone="sky">
          <Upload className="h-3 w-3" /> Uploading
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="red">
          <AlertCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return <Badge>{humanize(status)}</Badge>;
  }
}

export function ClipStatusBadge({ status }: { status: string }) {
  if (status === "ready") return null;
  if (status === "failed")
    return (
      <Badge tone="red">
        <AlertCircle className="h-3 w-3" /> Render failed
      </Badge>
    );
  return (
    <Badge tone="indigo">
      <Loader2 className="h-3 w-3 animate-spin" /> {status === "queued" ? "Queued" : "Rendering"}
    </Badge>
  );
}

export function CategoryBadge({ category, className }: { category: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        CATEGORY_COLORS[category ?? ""] ?? "bg-slate-100 text-slate-700 ring-slate-200",
        className,
      )}
    >
      {categoryLabel(category)}
    </span>
  );
}

function fmtScorePart(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "—");
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 1.5 ? 2 : 1);
}

/** Score 0–100 with a hover/tap breakdown. Always reminds that it's a guide. */
export function ScoreBadge({
  score,
  breakdown,
  className,
  align = "left",
}: {
  score: number;
  breakdown?: Record<string, number>;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(breakdown ?? {});
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn("inline-flex cursor-help items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold shadow-sm", scoreTone(score))}
        aria-label={`Clip score ${score} out of 100`}
      >
        {score}
        <Info className="h-3 w-3 opacity-80" />
      </button>
      {open && (
        <span
          className={cn(
            "animate-pop-in absolute top-full z-30 mt-1.5 block w-60 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mb-2 block font-semibold text-slate-900">Clip score {score}/100</span>
          {entries.length > 0 ? (
            <span className="block space-y-1">
              {entries.map(([k, v]) => (
                <span key={k} className="flex justify-between gap-2">
                  <span>{humanize(k)}</span>
                  <span className="font-medium text-slate-900 tabular-nums">{fmtScorePart(v)}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="block">No breakdown available for this clip.</span>
          )}
          <span className="mt-2 block border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            A guide, not a guarantee of views.
          </span>
        </span>
      )}
    </span>
  );
}
