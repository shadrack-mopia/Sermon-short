"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  Clapperboard,
  Download,
  FileText,
  Hash,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { CategoryBadge, SermonStatusBadge } from "@/components/badges";
import { ClipCard } from "@/components/clip-card";
import { normalizeSettings, SermonSettingsForm, settingsError } from "@/components/sermon-settings-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageLoader, Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import {
  cn,
  formatBytes,
  formatDate,
  formatDuration,
  formatTime,
  isProcessing,
  isRendering,
  LANGUAGES,
  STAGE_ORDER,
  stageLabel,
} from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Candidate, Clip, SermonDetail, SermonSettings, Transcript } from "@/lib/types";

export default function SermonPage() {
  const { id } = useParams<{ id: string }>();
  const sermon = useApi<SermonDetail>(`/api/sermons/${id}`, {
    poll: (d) => (!d || isProcessing(d.status) ? 3000 : d.clips_rendering > 0 ? 6000 : false),
  });
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  if (sermon.error && !sermon.data)
    return (
      <div className="mx-auto max-w-xl pt-10">
        <ErrorState message={sermon.status === 404 ? "This sermon doesn't exist or was deleted." : sermon.error} onRetry={sermon.reload} />
        <div className="mt-4 text-center">
          <Link href="/sermons" className="text-sm text-indigo-600">
            Back to My Sermons
          </Link>
        </div>
      </div>
    );
  if (!sermon.data) return <PageLoader label="Loading sermon…" />;
  const s = sermon.data;
  const ready = s.status === "ready";

  return (
    <div className="animate-fade-in">
      <Link href="/sermons" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> My Sermons
      </Link>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{s.title}</h1>
            <SermonStatusBadge status={s.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
            {s.speaker && <span>{s.speaker}</span>}
            {s.duration_s ? <span>{formatDuration(s.duration_s)}</span> : null}
            {s.language && <span>{LANGUAGES[s.language] ?? s.language.toUpperCase()}</span>}
            <span>{formatDate(s.created_at)}</span>
            {s.size_bytes ? <span>{formatBytes(s.size_bytes)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isProcessing(s.status) && (
            <>
              {ready && (s.clip_count ?? 0) > 0 && (
                <a href={`/api/clips/download-zip?sermon_id=${s.id}`} className={buttonClass("outline")}>
                  <Download className="h-4 w-4" /> Download all (ZIP)
                </a>
              )}
              <Button variant="outline" onClick={() => setReprocessOpen(true)}>
                <RefreshCw className="h-4 w-4" /> Reprocess
              </Button>
            </>
          )}
          <Button variant="outline" className="text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete sermon
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete “${s.title}”?`}
        description={
          <>
            This permanently deletes the sermon video, its transcript and{" "}
            {s.clip_count ? <strong>all {s.clip_count} of its clips</strong> : "all of its clips"} from this computer.
            {isProcessing(s.status) && " Processing will be stopped."} This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete sermon"
        danger
        onConfirm={async () => {
          await api.del(`/api/sermons/${s.id}`);
          toast.success("Sermon deleted");
          router.push("/sermons");
        }}
      />

      {isProcessing(s.status) ? (
        <ProcessingView sermon={s} />
      ) : s.status === "failed" ? (
        <Card className="border-rose-200">
          <CardBody className="flex flex-col items-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Processing failed</h2>
            <p className="mt-1 max-w-lg text-sm text-slate-600">
              {s.error || s.job?.error || "The worker reported an error while processing this sermon."}
            </p>
            {s.stage && s.stage !== "failed" && <p className="mt-1 text-xs text-slate-400">Stopped at: {stageLabel(s.stage)}</p>}
            <Button className="mt-5" onClick={() => setReprocessOpen(true)}>
              <RefreshCw className="h-4 w-4" /> Reprocess
            </Button>
          </CardBody>
        </Card>
      ) : ready ? (
        <ReadyView sermon={s} onReload={sermon.reload} />
      ) : (
        <EmptyState title="Upload not finished" description="This sermon's upload was not completed. Upload the video again." />
      )}

      {reprocessOpen && (
        <ReprocessDialog
          sermon={s}
          onClose={() => setReprocessOpen(false)}
          onDone={() => {
            setReprocessOpen(false);
            void sermon.reload();
          }}
        />
      )}
    </div>
  );
}

function ProcessingView({ sermon: s }: { sermon: SermonDetail }) {
  const stage = s.stage ?? s.job?.stage ?? "queued";
  const idx = STAGE_ORDER.findIndex((x) => stage.startsWith(x.slice(0, 5)));
  return (
    <Card className="overflow-hidden">
      <div className="bg-brand-gradient px-6 py-8 text-white sm:px-10">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <div>
            <div className="text-lg font-semibold">{s.status === "queued" ? "Waiting in the queue" : stageLabel(stage)}</div>
            <div className="text-sm text-white/80">
              {s.status === "queued" ? "Processing will start as soon as the worker is free." : `${Math.round(s.progress)}% complete`}
            </div>
          </div>
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${Math.max(3, s.progress)}%` }} />
        </div>
      </div>
      <CardBody className="space-y-5 sm:px-10">
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {STAGE_ORDER.map((st, i) => {
            const done = idx > i;
            const current = idx === i;
            return (
              <li
                key={st}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium",
                  done ? "bg-emerald-50 text-emerald-700" : current ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : "bg-slate-50 text-slate-400",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
                {stageLabel(st)}
              </li>
            );
          })}
        </ol>
        {s.job && s.job.attempts > 1 && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            Retrying (attempt {s.job.attempts}).{s.job.error ? ` Last error: ${s.job.error}` : ""}
          </div>
        )}
        <p className="text-sm text-slate-500">
          You can close this page — processing continues on the server and you&apos;ll get a notification when the clips are ready.
          A one-hour sermon usually takes 10–30 minutes depending on your computer.
        </p>
      </CardBody>
    </Card>
  );
}

type RightTab = "overview" | "transcript";
type BottomTab = "clips" | "candidates";

function ReadyView({ sermon: s, onReload }: { sermon: SermonDetail; onReload: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [rightTab, setRightTab] = useState<RightTab>("overview");
  const [bottomTab, setBottomTab] = useState<BottomTab>("clips");
  const [videoError, setVideoError] = useState(false);
  const clips = useApi<Clip[]>(`/api/clips?sermon_id=${s.id}&sort=score`, {
    poll: (d) => (d?.some((c) => isRendering(c.status)) ? 5000 : false),
  });
  const [deletingClip, setDeletingClip] = useState<Clip | null>(null);
  const clipToast = useToast();

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
    v.play().catch(() => {});
    const r = v.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) v.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-2xl bg-black shadow-lg lg:sticky lg:top-20">
            <video
              ref={videoRef}
              src={s.video_url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black"
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onError={() => setVideoError(true)}
            />
            {videoError && <div className="bg-rose-600 px-4 py-2 text-sm text-white">The sermon video couldn&apos;t be loaded.</div>}
          </div>
        </div>
        <Card className="flex min-h-0 flex-col lg:col-span-5 lg:max-h-[calc(100vh-7rem)]">
          <div className="px-4 pt-3">
            <Tabs
              variant="underline"
              value={rightTab}
              onChange={setRightTab}
              items={[
                { value: "overview", label: "Overview", icon: <Sparkles className="h-4 w-4" /> },
                { value: "transcript", label: "Transcript", icon: <FileText className="h-4 w-4" /> },
              ]}
            />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
            {rightTab === "overview" ? <Overview sermon={s} onSeek={seek} /> : <TranscriptPanel sermonId={s.id} time={time} onSeek={seek} />}
          </div>
        </Card>
      </div>

      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={bottomTab}
            onChange={setBottomTab}
            items={[
              { value: "clips", label: `Clips${clips.data ? ` (${clips.data.length})` : ""}`, icon: <Clapperboard className="h-4 w-4" /> },
              { value: "candidates", label: "All candidates", icon: <ListChecks className="h-4 w-4" /> },
            ]}
          />
          {s.clips_rendering > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-indigo-700">
              <Loader2 className="h-4 w-4 animate-spin" /> {s.clips_rendering} clip(s) rendering
            </span>
          )}
        </div>
        {bottomTab === "clips" ? (
          clips.error && !clips.data ? (
            <ErrorState message={clips.error} onRetry={clips.reload} />
          ) : !clips.data ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="aspect-[9/16]" />
              ))}
            </div>
          ) : clips.data.length === 0 ? (
            <EmptyState
              icon={<Clapperboard className="h-6 w-6" />}
              title="No clips for this sermon"
              description="The AI didn't select any clips. Check “All candidates” to turn a moment into a clip, use Sermon Intelligence search, or reprocess with different settings."
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {clips.data.map((c) => (
                <ClipCard key={c.id} clip={c} showSermon={false} onDelete={() => setDeletingClip(c)} />
              ))}
              <ConfirmDialog
                open={!!deletingClip}
                onClose={() => setDeletingClip(null)}
                title={`Delete “${deletingClip?.title || "this clip"}”?`}
                description="The rendered video file is permanently removed from this computer. The sermon is kept, so you can make the clip again from All candidates. This can't be undone."
                confirmLabel="Delete clip"
                danger
                onConfirm={async () => {
                  if (!deletingClip) return;
                  await api.del(`/api/clips/${deletingClip.id}`);
                  await Promise.all([clips.reload(), onReload()]);
                  clipToast.success("Clip deleted");
                }}
              />
            </div>
          )
        ) : (
          <Candidates
            sermonId={s.id}
            onPreview={seek}
            onCreated={async () => {
              await Promise.all([clips.reload(), onReload()]);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Overview({ sermon: s, onSeek }: { sermon: SermonDetail; onSeek: (t: number) => void }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Summary</h3>
        {s.summary ? (
          <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{s.summary}</p>
        ) : (
          <p className="text-sm text-slate-400">No summary was generated.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <Hash className="h-3.5 w-3.5" /> Topics
        </h3>
        {s.topics.length ? (
          <div className="space-y-2">
            {s.topics.map((t) => (
              <div key={t.name} className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-sm font-medium text-slate-800">{t.name}</div>
                {t.description && <div className="mt-0.5 text-xs text-slate-500">{t.description}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No topics detected.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <BookOpen className="h-3.5 w-3.5" /> Bible references
        </h3>
        {s.bible_references.length ? (
          <ul className="space-y-1.5">
            {s.bible_references.map((r, i) => (
              <li key={`${r.reference}-${i}`}>
                <button
                  onClick={() => onSeek(r.start_s)}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-indigo-50"
                >
                  <span className="mt-0.5 rounded-md bg-indigo-100 px-1.5 py-0.5 font-mono text-[11px] text-indigo-700 tabular-nums">
                    {formatTime(r.start_s)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 group-hover:text-indigo-700">{r.reference}</span>
                    {r.context && <span className="line-clamp-2 block text-xs text-slate-500">{r.context}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No scripture references found.</p>
        )}
      </section>
    </div>
  );
}

function TranscriptPanel({ sermonId, time, onSeek }: { sermonId: string; time: number; onSeek: (t: number) => void }) {
  const t = useApi<Transcript>(`/api/sermons/${sermonId}/transcript`);
  const [follow, setFollow] = useState(true);
  const activeRef = useRef<HTMLButtonElement>(null);
  const segs = t.data?.segments ?? [];
  const activeIdx = segs.findIndex((g) => time >= g.start_s && time < g.end_s);

  useEffect(() => {
    if (follow && activeRef.current) activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx, follow]);

  if (t.error && !t.data) return <ErrorState message={t.error} onRetry={t.reload} />;
  if (!t.data)
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  if (!segs.length) return <p className="text-sm text-slate-400">No transcript available.</p>;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {t.data.word_count.toLocaleString()} words{t.data.language ? ` · ${LANGUAGES[t.data.language] ?? t.data.language}` : ""}
        </span>
        <label className="flex items-center gap-2">
          Follow video <Switch checked={follow} onChange={setFollow} />
        </label>
      </div>
      <div className="space-y-0.5">
        {segs.map((g, i) => (
          <button
            key={g.idx}
            ref={i === activeIdx ? activeRef : undefined}
            onClick={() => onSeek(g.start_s)}
            className={cn(
              "flex w-full cursor-pointer gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition",
              i === activeIdx ? "bg-indigo-50 text-slate-900 ring-1 ring-indigo-200" : "text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className={cn("mt-0.5 shrink-0 font-mono text-[11px] tabular-nums", i === activeIdx ? "text-indigo-600" : "text-slate-400")}>
              {formatTime(g.start_s)}
            </span>
            <span className="leading-relaxed">{g.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Candidates({ sermonId, onPreview, onCreated }: { sermonId: string; onPreview: (t: number) => void; onCreated: () => Promise<void> }) {
  const toast = useToast();
  const cands = useApi<Candidate[]>(`/api/sermons/${sermonId}/candidates`);
  const [creating, setCreating] = useState<string | null>(null);
  const [made, setMade] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "selected" | "rejected">("all");

  const create = async (c: Candidate) => {
    setCreating(c.id);
    try {
      await api.post<Clip>("/api/clips", { sermon_id: sermonId, start_s: c.start_s, end_s: c.end_s, title: c.title || "New clip" });
      setMade((m) => new Set(m).add(c.id));
      toast.success("Clip created", "It's rendering now and will appear in the Clips tab.");
      await onCreated();
    } catch (e) {
      toast.error("Couldn't create clip", errorMessage(e));
    } finally {
      setCreating(null);
    }
  };

  if (cands.error && !cands.data) return <ErrorState message={cands.error} onRetry={cands.reload} />;
  if (!cands.data)
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  if (!cands.data.length)
    return <EmptyState icon={<ListChecks className="h-6 w-6" />} title="No candidates" description="The analysis didn't produce any candidate moments." />;

  const list = cands.data.filter((c) => filter === "all" || (filter === "selected" ? c.status === "selected" : c.status !== "selected"));
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Every moment the AI considered, best first.</span>
        <Select wrapperClassName="ml-auto w-40" className="h-9" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All ({cands.data.length})</option>
          <option value="selected">Selected</option>
          <option value="rejected">Not selected</option>
        </Select>
      </div>
      <Card className="divide-y divide-slate-100">
        {list.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
            <div className="flex shrink-0 items-center gap-2 sm:w-36 sm:flex-col sm:items-start">
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {formatTime(c.start_s)}–{formatTime(c.end_s)}
              </span>
              <span className="text-xs text-slate-400">{formatDuration(c.end_s - c.start_s)}</span>
              <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">{c.score}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{c.title || "Untitled moment"}</span>
                <CategoryBadge category={c.category} />
                {c.status === "selected" ? (
                  <Badge tone="green">Selected</Badge>
                ) : c.status === "duplicate" ? (
                  <Badge tone="amber">Duplicate</Badge>
                ) : (
                  <Badge>Not selected</Badge>
                )}
              </div>
              {c.hook && <p className="mt-1 text-sm text-slate-700 italic">“{c.hook}”</p>}
              {c.reason && <p className="mt-1 text-xs text-slate-500">{c.reason}</p>}
              {c.reject_reason && <p className="mt-1 text-xs text-amber-700">Why not: {c.reject_reason}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => onPreview(c.start_s)}>
                <Play className="h-3.5 w-3.5" /> Preview
              </Button>
              {c.status !== "selected" &&
                (made.has(c.id) ? (
                  <Badge tone="green" className="h-8 px-3">
                    <Check className="h-3.5 w-3.5" /> Clip created
                  </Badge>
                ) : (
                  <Button size="sm" loading={creating === c.id} disabled={!!creating} onClick={() => void create(c)}>
                    <Plus className="h-3.5 w-3.5" /> Make clip
                  </Button>
                ))}
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nothing in this filter.</p>}
      </Card>
    </div>
  );
}

function ReprocessDialog({ sermon, onClose, onDone }: { sermon: SermonDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [settings, setSettings] = useState<SermonSettings>(() => normalizeSettings(sermon.settings));
  const [fromStage, setFromStage] = useState<"analyse" | "transcribe">(sermon.status === "failed" && !sermon.duration_s ? "transcribe" : "analyse");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const err = settingsError(settings);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/sermons/${sermon.id}/reprocess`, { settings, from_stage: fromStage });
      toast.success("Reprocessing started");
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Reprocess sermon"
      description="Find clips again with different settings. Existing clips may be replaced."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            <RefreshCw className="h-4 w-4" /> Start reprocessing
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <Label>Start from</Label>
          <Select value={fromStage} onChange={(e) => setFromStage(e.target.value as "analyse" | "transcribe")}>
            <option value="analyse">Analysis — reuse the transcript (fast)</option>
            <option value="transcribe">Transcription — redo everything (slow)</option>
          </Select>
        </div>
        <SermonSettingsForm value={settings} onChange={setSettings} />
        <InlineError>{error}</InlineError>
      </div>
    </Dialog>
  );
}
