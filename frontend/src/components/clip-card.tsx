"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertCircle, Check, Download, Film, Loader2, Play, Trash2 } from "lucide-react";
import { cn, formatDuration, isRendering } from "@/lib/format";
import type { Clip } from "@/lib/types";
import { CategoryBadge, ScoreBadge } from "./badges";

/** Vertical thumbnail card. Hovering plays the rendered clip muted. */
export function ClipCard({
  clip,
  selected,
  onToggleSelect,
  onDelete,
  showSermon = true,
}: {
  clip: Clip;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Shows a delete button; the parent is responsible for confirming. */
  onDelete?: () => void;
  showSermon?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const rendering = isRendering(clip.status);

  const start = () => {
    const v = videoRef.current;
    if (!v || !clip.video_url) return;
    v.currentTime = 0;
    v.play()
      .then(() => setPlaying(true))
      .catch(() => {});
  };
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
        selected ? "border-indigo-400 ring-2 ring-indigo-400/50" : "border-slate-200/70",
      )}
    >
      <Link href={`/clips/${clip.id}`} className="block" onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop}>
        <div className="relative aspect-[9/16] overflow-hidden bg-navy-900">
          {clip.thumbnail_url && !thumbFailed ? (
            <img
              src={clip.thumbnail_url}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
              className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", playing && "opacity-0")}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy-800 to-indigo-950">
              <Film className="h-8 w-8 text-white/20" />
            </div>
          )}
          {clip.video_url && (
            <video
              ref={videoRef}
              src={clip.video_url}
              muted
              loop
              playsInline
              preload="none"
              className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", playing ? "opacity-100" : "opacity-0")}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
          {rendering && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-navy-900/70 text-xs font-medium text-white backdrop-blur-[1px]">
              <Loader2 className="h-6 w-6 animate-spin" />
              {clip.status === "queued" ? "Queued for rendering" : "Rendering…"}
            </div>
          )}
          {clip.status === "failed" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/70 px-3 text-center text-xs font-medium text-white">
              <AlertCircle className="h-6 w-6" />
              Render failed
            </div>
          )}
          {!rendering && clip.status === "ready" && !playing && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
              </div>
            </div>
          )}
          <span className="absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {formatDuration(clip.duration_s)}
          </span>
        </div>
      </Link>
      <div className="absolute top-2 left-2 z-10">
        <ScoreBadge score={clip.score} breakdown={clip.score_breakdown} />
      </div>
      {onToggleSelect && (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-label={selected ? "Deselect clip" : "Select clip"}
          className={cn(
            "absolute top-2 right-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-2 transition",
            selected ? "border-indigo-500 bg-indigo-500 text-white" : "border-white/80 bg-black/20 text-transparent hover:bg-black/40",
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="space-y-1.5 p-3">
        <Link href={`/clips/${clip.id}`} className="line-clamp-2 text-sm leading-snug font-medium text-slate-900 hover:text-indigo-700">
          {clip.title || "Untitled clip"}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <CategoryBadge category={clip.category} />
          <div className="flex items-center gap-0.5">
            {clip.download_url && (
              <a
                href={clip.download_url}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Download clip"
                title="Download MP4"
              >
                <Download className="h-4 w-4" />
              </a>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="cursor-pointer rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label="Delete clip"
                title="Delete clip"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {showSermon && clip.sermon_title && <div className="truncate text-xs text-slate-500">{clip.sermon_title}</div>}
      </div>
    </div>
  );
}
