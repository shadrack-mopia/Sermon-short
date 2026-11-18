"use client";

import { useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { cn, formatDuration, isProcessing } from "@/lib/format";
import type { Sermon } from "@/lib/types";

/** 16:9 sermon thumbnail; the thumbnail only exists after the "audio" stage, so fall back gracefully. */
export function SermonThumb({ sermon, className }: { sermon: Sermon; className?: string }) {
  const [failed, setFailed] = useState(false);
  const processing = isProcessing(sermon.status);
  const showImg = !failed && !(processing && (sermon.progress ?? 0) < 10);
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-gradient-to-br from-navy-800 to-indigo-950", className)}>
      {showImg ? (
        <img src={sermon.thumbnail_url} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {processing ? <Loader2 className="h-6 w-6 animate-spin text-white/40" /> : <Film className="h-7 w-7 text-white/25" />}
        </div>
      )}
      {sermon.duration_s ? (
        <span className="absolute right-2 bottom-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(sermon.duration_s)}
        </span>
      ) : null}
    </div>
  );
}
