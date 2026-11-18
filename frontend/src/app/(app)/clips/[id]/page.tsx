"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { CategoryBadge, ClipStatusBadge, ScoreBadge } from "@/components/badges";
import { ClipEditor } from "@/components/clip-editor/editor";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PageLoader } from "@/components/ui/spinner";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { aspectClass, cn, formatDuration, formatTime, isRendering } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Clip } from "@/lib/types";

export default function ClipPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const clip = useApi<Clip>(`/api/clips/${id}`, { poll: (d) => (d && isRendering(d.status) ? 3000 : false) });
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // keep the sermon-only fields (not returned by PATCH) when merging updates
  const { setData } = clip;
  const merge = useCallback(
    (next: Clip) =>
      setData((prev) => ({
        ...next,
        sermon_title: next.sermon_title ?? prev?.sermon_title ?? null,
        sermon_duration_s: next.sermon_duration_s ?? prev?.sermon_duration_s,
        sermon_video_url: next.sermon_video_url ?? prev?.sermon_video_url,
      })),
    [setData],
  );

  if (clip.error && !clip.data)
    return (
      <div className="mx-auto max-w-xl pt-10">
        <ErrorState message={clip.status === 404 ? "This clip doesn't exist or was deleted." : clip.error} onRetry={clip.reload} />
      </div>
    );
  if (!clip.data) return <PageLoader label="Loading clip…" />;
  const c = clip.data;
  const rendering = isRendering(c.status);

  const retryRender = async () => {
    setRetrying(true);
    try {
      merge(await api.post<Clip>(`/api/clips/${c.id}/render`));
      toast.success("Render queued");
    } catch (e) {
      toast.error("Couldn't queue render", errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-3 flex items-center gap-3 text-sm text-slate-500">
        <Link href="/clips" className="inline-flex items-center gap-1 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> AI Clips
        </Link>
        {c.sermon_title && (
          <>
            <span>/</span>
            <Link href={`/sermons/${c.sermon_id}`} className="truncate hover:text-slate-800">
              {c.sermon_title}
            </Link>
          </>
        )}
      </div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.title || "Untitled clip"}</h1>
            <ScoreBadge score={c.score} breakdown={c.score_breakdown} />
            <CategoryBadge category={c.category} />
            <ClipStatusBadge status={c.status} />
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {formatTime(c.start_s)}–{formatTime(c.end_s)} in the sermon · {formatDuration(c.duration_s)} · {c.aspect} · {c.downloads} download
            {c.downloads === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.download_url && !rendering ? (
            <a href={c.download_url} className={buttonClass("primary")}>
              <Download className="h-4 w-4" /> Download MP4
            </a>
          ) : (
            <Button disabled>
              <Download className="h-4 w-4" /> Download MP4
            </Button>
          )}
          <Button variant="outline" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,380px)_1fr]">
        <div>
          <div className="lg:sticky lg:top-20">
            <div className={cn("relative mx-auto max-h-[75vh] overflow-hidden rounded-2xl bg-navy-900 shadow-xl", aspectClass(c.aspect), c.aspect === "16:9" ? "w-full" : "max-w-[380px]")}>
              {c.video_url ? (
                <video
                  key={c.video_url}
                  src={c.video_url}
                  poster={c.thumbnail_url ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                />
              ) : null}
              {rendering && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-900/80 text-center text-white backdrop-blur-sm">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="font-medium">{c.status === "queued" ? "Waiting to render…" : "Re-rendering…"}</div>
                  <div className="max-w-[16rem] text-xs text-white/70">Your changes are saved. The new video will appear here automatically.</div>
                </div>
              )}
              {c.status === "failed" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-rose-950/85 p-6 text-center text-white">
                  <AlertTriangle className="h-8 w-8" />
                  <div className="font-medium">Render failed</div>
                  {c.error && <div className="max-h-24 overflow-auto text-xs text-white/80">{c.error}</div>}
                  <Button variant="outline" size="sm" loading={retrying} onClick={() => void retryRender()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry render
                  </Button>
                </div>
              )}
              {!c.video_url && !rendering && c.status !== "failed" && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">No video yet</div>
              )}
            </div>
          </div>
        </div>
        <ClipEditor clip={c} onUpdated={merge} onReload={clip.reload} />
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this clip?"
        description="The rendered video is removed from this computer. The sermon and its other clips are not affected."
        confirmLabel="Delete clip"
        danger
        onConfirm={async () => {
          await api.del(`/api/clips/${c.id}`);
          toast.success("Clip deleted");
          router.push(`/sermons/${c.sermon_id}`);
        }}
      />
    </div>
  );
}
