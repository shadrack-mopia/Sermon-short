"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn, formatTime } from "@/lib/format";

export interface SegmentPlayerHandle {
  playRange: (start: number, end: number) => void;
}

/**
 * Plays [start, end] of a long (Range-streamed) sermon video: seeks to `start`
 * and pauses at `end`. Video metadata is only fetched when the user presses play.
 */
export const SegmentPlayer = forwardRef<
  SegmentPlayerHandle,
  { src: string; start: number; end: number; className?: string; aspect?: "video" | "auto"; autoLoad?: boolean }
>(function SegmentPlayer({ src, start, end, className, autoLoad = false }, ref) {
  const v = useRef<HTMLVideoElement>(null);
  const range = useRef({ start, end });
  const [loaded, setLoaded] = useState(autoLoad);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    range.current = { start, end };
  }, [start, end]);

  const playRange = useCallback((s: number, e: number) => {
    range.current = { start: s, end: e };
    setLoaded(true);
    const el = v.current;
    if (!el) return;
    const go = () => {
      el.currentTime = s;
      el.play().catch(() => {});
    };
    if (el.readyState >= 1) go();
    else el.addEventListener("loadedmetadata", go, { once: true });
  }, []);

  useImperativeHandle(ref, () => ({ playRange }), [playRange]);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (playing) el.pause();
    else if (el.currentTime < range.current.start - 0.5 || el.currentTime >= range.current.end - 0.1) playRange(range.current.start, range.current.end);
    else el.play().catch(() => {});
  };

  const dur = Math.max(0.1, end - start);
  const pct = Math.max(0, Math.min(100, ((t - start) / dur) * 100));

  return (
    <div className={cn("overflow-hidden rounded-xl bg-black", className)}>
      <div className="relative aspect-video">
        <video
          ref={v}
          src={loaded ? src : undefined}
          preload="metadata"
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setErr("This video couldn't be loaded.")}
          onTimeUpdate={(e) => {
            const ct = e.currentTarget.currentTime;
            setT(ct);
            if (ct >= range.current.end) e.currentTarget.pause();
          }}
        />
        {!playing && (
          <button
            type="button"
            onClick={toggle}
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/30 transition hover:bg-black/20"
            aria-label="Play segment"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
              <Play className="ml-0.5 h-5 w-5 fill-slate-900 text-slate-900" />
            </span>
          </button>
        )}
        {err && <div className="absolute inset-x-0 bottom-0 bg-rose-600/90 px-3 py-1.5 text-xs text-white">{err}</div>}
      </div>
      <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 text-xs text-slate-300">
        <button type="button" onClick={toggle} className="cursor-pointer text-white" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => playRange(start, end)} className="cursor-pointer text-slate-400 hover:text-white" aria-label="Restart">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-indigo-400" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums">
          {formatTime(start)}–{formatTime(end)}
        </span>
      </div>
    </div>
  );
});
