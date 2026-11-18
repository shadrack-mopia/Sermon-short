"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, CloudUpload, FileVideo, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { DEFAULT_SETTINGS, SermonSettingsForm, settingsError } from "@/components/sermon-settings-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { InlineError, PageHeader } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { cn, formatBytes } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Folder, Sermon, SermonSettings } from "@/lib/types";
import { ALLOWED_EXT, extOf, startUpload, UploadCanceled, type UploadHandle } from "@/lib/uploader";

type Status = "waiting" | "uploading" | "uploaded" | "failed" | "canceled" | "submitting" | "submitted";

interface Item {
  key: string;
  file: File;
  title: string;
  status: Status;
  received: number;
  speed: number;
  retryNote: string | null;
  error: string | null;
  uploadId: string | null;
  sermonId: string | null;
}

let keySeq = 0;

function titleFromFilename(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export default function UploadPage() {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const folders = useApi<Folder[]>("/api/folders");
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  const pumping = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [speaker, setSpeaker] = useState("");
  const [speakerTouched, setSpeakerTouched] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [settings, setSettings] = useState<SermonSettings>(DEFAULT_SETTINGS);
  const [rights, setRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const speakerValue = speakerTouched ? speaker : (me?.org.speaker_name ?? "");

  const patch = useCallback((key: string, p: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...p } : i));
    setItems(itemsRef.current);
  }, []);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "waiting");
        if (!next) break;
        patch(next.key, { status: "uploading", error: null, received: 0, speed: 0 });
        const h = startUpload(
          next.file,
          (p) =>
            patch(next.key, {
              received: p.received,
              speed: p.speed,
              retryNote: p.retrying ? `Connection problem — retrying in ${p.retrying.inSeconds}s (attempt ${p.retrying.attempt})` : null,
            }),
          (id) => patch(next.key, { uploadId: id }),
        );
        handles.current.set(next.key, h);
        try {
          await h.promise;
          patch(next.key, { status: "uploaded", received: next.file.size, retryNote: null });
        } catch (e) {
          if (e instanceof UploadCanceled) patch(next.key, { status: "canceled", retryNote: null });
          else patch(next.key, { status: "failed", error: errorMessage(e), retryNote: null });
        } finally {
          handles.current.delete(next.key);
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [patch]);

  const addFiles = (files: FileList | File[]) => {
    const bad: string[] = [];
    const fresh: Item[] = [];
    for (const f of Array.from(files)) {
      if (!ALLOWED_EXT.includes(extOf(f.name))) {
        bad.push(f.name);
        continue;
      }
      fresh.push({
        key: `f${++keySeq}`,
        file: f,
        title: titleFromFilename(f.name) || "Untitled sermon",
        status: "waiting",
        received: 0,
        speed: 0,
        retryNote: null,
        error: null,
        uploadId: null,
        sermonId: null,
      });
    }
    setRejected(bad);
    if (fresh.length) {
      itemsRef.current = [...itemsRef.current, ...fresh];
      setItems(itemsRef.current);
      void pump();
    }
  };

  const cancel = async (it: Item) => {
    const h = handles.current.get(it.key);
    if (h) await h.cancel();
    else {
      if (it.uploadId && it.status !== "submitted") {
        try {
          await api.del(`/api/uploads/${it.uploadId}`);
        } catch {
          /* ignore */
        }
      }
      patch(it.key, { status: "canceled" });
    }
  };

  const remove = (it: Item) => {
    itemsRef.current = itemsRef.current.filter((i) => i.key !== it.key);
    setItems(itemsRef.current);
  };

  const retry = (it: Item) => {
    patch(it.key, { status: "waiting", error: null, uploadId: null });
    void pump();
  };

  // warn before leaving while bytes are in flight
  const busy = items.some((i) => i.status === "uploading" || i.status === "waiting" || i.status === "submitting");
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  // abort in-flight uploads if the user navigates away inside the app
  useEffect(() => {
    const map = handles.current;
    return () => {
      for (const h of map.values()) void h.cancel();
    };
  }, []);

  const active = items.filter((i) => i.status !== "canceled");
  const pendingUploads = active.filter((i) => i.status === "waiting" || i.status === "uploading").length;
  const ready = active.filter((i) => i.status === "uploaded");
  const failed = active.filter((i) => i.status === "failed");

  const submit = async () => {
    setFormError(null);
    const err = settingsError(settings);
    if (err) return setFormError(err);
    if (!rights) return setFormError("Please confirm you own or have permission to use these videos.");
    if (ready.some((i) => !i.title.trim())) return setFormError("Every sermon needs a title.");
    setSubmitting(true);
    const done: string[] = [];
    for (const it of ready) {
      patch(it.key, { status: "submitting", error: null });
      try {
        const s = await api.post<Sermon>(`/api/uploads/${it.uploadId}/complete`, {
          title: it.title.trim(),
          speaker: speakerValue.trim() || null,
          folder_id: folderId || null,
          settings,
          rights_confirmed: true,
        });
        patch(it.key, { status: "submitted", sermonId: s.id });
        done.push(s.id);
      } catch (e) {
        patch(it.key, { status: "uploaded", error: errorMessage(e) });
      }
    }
    setSubmitting(false);
    if (done.length && done.length === ready.length && pendingUploads === 0) {
      toast.success(done.length === 1 ? "Sermon queued for processing" : `${done.length} sermons queued for processing`);
      router.push(done.length === 1 ? `/sermons/${done[0]}` : "/sermons");
    } else if (done.length) {
      toast.success(`${done.length} sermon(s) queued`, "Fix the remaining items below.");
    }
  };

  return (
    <div className="animate-fade-in mx-auto max-w-4xl">
      <Link href="/sermons" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> My Sermons
      </Link>
      <PageHeader title="Upload sermons" description="Large files are uploaded in pieces and resume automatically if the connection drops." />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition",
          dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/30",
        )}
      >
        <div className="bg-brand-gradient mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-indigo-500/30">
          <CloudUpload className="h-7 w-7" />
        </div>
        <div className="text-base font-semibold text-slate-900">Drag &amp; drop sermon videos here</div>
        <div className="mt-1 text-sm text-slate-500">or click to choose files · MP4, MOV, MKV, WEBM, AVI and more</div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ALLOWED_EXT.join(",") + ",video/*"}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {rejected.length > 0 && (
        <div className="mt-3">
          <InlineError>Skipped unsupported file(s): {rejected.join(", ")}</InlineError>
        </div>
      )}

      {items.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Files" description={pendingUploads ? `${pendingUploads} uploading…` : "Uploads finished. Review titles below."} />
          <CardBody className="space-y-3">
            {items.map((it) => (
              <FileRow
                key={it.key}
                item={it}
                onTitle={(t) => patch(it.key, { title: t })}
                onCancel={() => void cancel(it)}
                onRemove={() => remove(it)}
                onRetry={() => retry(it)}
              />
            ))}
          </CardBody>
        </Card>
      )}

      {items.length > 0 && (
        <>
          <Card className="mt-6">
            <CardHeader title="Sermon details" description="Applied to every file in this upload." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Speaker">
                <Input
                  value={speakerValue}
                  onChange={(e) => {
                    setSpeakerTouched(true);
                    setSpeaker(e.target.value);
                  }}
                  placeholder="e.g. Pastor John"
                  maxLength={200}
                />
              </Field>
              <Field label="Folder">
                <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">No folder</option>
                  {folders.data?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader title="Clip settings" description="How the AI should find and format clips." />
            <CardBody>
              <SermonSettingsForm value={settings} onChange={setSettings} />
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardBody className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={rights} onChange={(e) => setRights(e.target.checked)} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-indigo-600" /> I own or have permission to use this video
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">Required. Only upload sermons your church or ministry has the rights to.</span>
                </span>
              </label>
              <InlineError>{formError}</InlineError>
              <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">
                  {pendingUploads > 0
                    ? "You can start processing once uploads finish. Keep this tab open until then."
                    : failed.length
                      ? `${failed.length} upload(s) failed — retry or remove them.`
                      : "Processing runs in the background — you can close the page after this."}
                </p>
                <Button size="lg" onClick={() => void submit()} loading={submitting} disabled={!ready.length || pendingUploads > 0 || !rights}>
                  {pendingUploads > 0 ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Waiting for uploads…
                    </>
                  ) : (
                    `Process ${ready.length || ""} sermon${ready.length === 1 ? "" : "s"}`
                  )}
                </Button>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function FileRow({
  item: it,
  onTitle,
  onCancel,
  onRemove,
  onRetry,
}: {
  item: Item;
  onTitle: (t: string) => void;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const pct = it.file.size ? (it.received / it.file.size) * 100 : 0;
  const eta = it.speed > 0 ? (it.file.size - it.received) / it.speed : null;
  const editable = it.status !== "submitted" && it.status !== "submitting" && it.status !== "canceled";
  return (
    <div className={cn("rounded-xl border p-3.5", it.status === "failed" ? "border-rose-200 bg-rose-50/40" : "border-slate-200")}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            it.status === "submitted" || it.status === "uploaded"
              ? "bg-emerald-50 text-emerald-600"
              : it.status === "failed"
                ? "bg-rose-100 text-rose-600"
                : "bg-indigo-50 text-indigo-600",
          )}
        >
          {it.status === "uploaded" || it.status === "submitted" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : it.status === "failed" ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <FileVideo className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Input
            value={it.title}
            onChange={(e) => onTitle(e.target.value)}
            disabled={!editable}
            className="h-9 font-medium"
            aria-label="Sermon title"
            maxLength={300}
          />
          <div className="mt-1.5 truncate text-xs text-slate-500">
            {it.file.name} · {formatBytes(it.file.size)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {it.status === "failed" && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
          {(it.status === "uploading" || it.status === "waiting" || it.status === "uploaded") && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {(it.status === "canceled" || it.status === "failed") && (
            <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3">
        {it.status === "uploading" || it.status === "waiting" ? (
          <>
            <Progress value={pct} indeterminate={it.status === "waiting"} />
            <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-slate-500">
              <span>
                {it.status === "waiting" ? "Waiting…" : `${formatBytes(it.received)} of ${formatBytes(it.file.size)} · ${Math.floor(pct)}%`}
              </span>
              {it.status === "uploading" && it.speed > 0 && (
                <span className="tabular-nums">
                  {formatBytes(it.speed)}/s{eta !== null && eta < 360000 ? ` · ${fmtEta(eta)} left` : ""}
                </span>
              )}
            </div>
            {it.retryNote && <div className="mt-1 text-xs text-amber-700">{it.retryNote}</div>}
          </>
        ) : it.status === "uploaded" ? (
          <div className="text-xs font-medium text-emerald-700">Uploaded — ready to process</div>
        ) : it.status === "submitting" ? (
          <div className="flex items-center gap-1.5 text-xs text-indigo-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queuing for processing…
          </div>
        ) : it.status === "submitted" ? (
          <div className="text-xs font-medium text-emerald-700">
            Queued.{" "}
            {it.sermonId && (
              <Link className="underline" href={`/sermons/${it.sermonId}`}>
                View progress
              </Link>
            )}
          </div>
        ) : it.status === "canceled" ? (
          <div className="text-xs text-slate-500">Canceled</div>
        ) : null}
        {it.error && <div className="mt-1 text-xs text-rose-600">{it.error}</div>}
      </div>
    </div>
  );
}

function fmtEta(s: number) {
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  return `${Math.floor(s / 3600)}h ${Math.ceil((s % 3600) / 60)}m`;
}
