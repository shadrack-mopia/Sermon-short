"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock,
  Cpu,
  Download,
  Film,
  HardDrive,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { SermonStatusBadge } from "@/components/badges";
import { SermonThumb } from "@/components/sermon-thumb";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/states";
import { cn, formatBytes, formatDate, formatNumber, isProcessing, stageLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Stats, SystemStatus } from "@/lib/types";

export default function DashboardPage() {
  const { me } = useAuth();
  const stats = useApi<Stats>("/api/stats", {
    poll: (d) => (d && (d.active_jobs > 0 || d.recent_sermons.some((s) => isProcessing(s.status))) ? 5000 : 30000),
  });
  const firstName = me?.user.name.split(" ")[0];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome back${firstName ? `, ${firstName}` : ""}`}
        description="Here's what's happening with your sermons and clips."
        action={
          <Link href="/sermons/upload" className={buttonClass("primary")}>
            <Upload className="h-4 w-4" /> Upload sermon
          </Link>
        }
      />

      {stats.error && !stats.data ? (
        <ErrorState message={stats.error} onRetry={stats.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard icon={Film} label="Sermons" value={stats.data && formatNumber(stats.data.sermons)} tone="violet" />
            <StatCard icon={Clapperboard} label="Clips generated" value={stats.data && formatNumber(stats.data.clips)} tone="indigo" />
            <StatCard
              icon={Clock}
              label="Minutes processed"
              value={stats.data && formatNumber(stats.data.processing_minutes, 1)}
              sub={stats.data && `${formatNumber(stats.data.processing_minutes_month, 1)} this month`}
              tone="sky"
            />
            <StatCard icon={Download} label="Downloads" value={stats.data && formatNumber(stats.data.downloads)} tone="emerald" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Recent sermons"
                description={stats.data?.active_jobs ? `${stats.data.active_jobs} job(s) running in the background` : undefined}
                action={
                  <Link href="/sermons" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
                    View all
                  </Link>
                }
              />
              <CardBody>
                {!stats.data ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-16" />
                    ))}
                  </div>
                ) : stats.data.recent_sermons.length === 0 ? (
                  <EmptyState
                    icon={<Film className="h-6 w-6" />}
                    title="No sermons yet"
                    description="Upload your first sermon video and we'll find the best moments for shorts."
                    action={
                      <Link href="/sermons/upload" className={buttonClass("primary")}>
                        <Upload className="h-4 w-4" /> Upload a sermon
                      </Link>
                    }
                  />
                ) : (
                  <ul className="-my-2 divide-y divide-slate-100">
                    {stats.data.recent_sermons.map((s) => (
                      <li key={s.id}>
                        <Link href={`/sermons/${s.id}`} className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-3 transition hover:bg-slate-50">
                          <SermonThumb sermon={s} className="w-28 shrink-0 rounded-lg" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium text-slate-900">{s.title}</span>
                              <SermonStatusBadge status={s.status} />
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {[s.speaker, formatDate(s.created_at)].filter(Boolean).join(" · ")}
                            </div>
                            {isProcessing(s.status) && (
                              <div className="mt-2 flex items-center gap-2">
                                <Progress value={s.progress} className="h-1.5" />
                                <span className="shrink-0 text-[11px] text-slate-500">
                                  {stageLabel(s.stage)} · {Math.round(s.progress)}%
                                </span>
                              </div>
                            )}
                            {s.status === "failed" && s.error && <div className="mt-1 line-clamp-1 text-xs text-rose-600">{s.error}</div>}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <div className="space-y-6">
              <SystemCard />
              <Card>
                <CardHeader title="Storage" icon={<HardDrive className="h-4 w-4" />} />
                <CardBody>
                  {!stats.data ? (
                    <Skeleton className="h-14" />
                  ) : (
                    <StorageBar used={stats.data.storage_bytes} free={stats.data.disk_free_bytes} total={stats.data.disk_total_bytes} />
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const TONES = {
  violet: "from-violet-500 to-purple-600",
  indigo: "from-indigo-500 to-blue-600",
  sky: "from-sky-500 to-cyan-600",
  emerald: "from-emerald-500 to-teal-600",
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Film;
  label: string;
  value: string | undefined;
  sub?: string;
  tone: keyof typeof TONES;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500 sm:text-sm">{label}</div>
          {value === undefined ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-3xl">{value}</div>
          )}
          {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:h-10 sm:w-10", TONES[tone])}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </Card>
  );
}

function StorageBar({ used, free, total }: { used: number; free: number; total: number }) {
  const usedDisk = total - free;
  const pctDisk = total ? (usedDisk / total) * 100 : 0;
  const pctOurs = total ? (used / total) * 100 : 0;
  const low = total > 0 && free / total < 0.1;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold text-slate-900">{formatBytes(used)}</span>
        <span className="text-xs text-slate-500">used by Sermon Shorts</span>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-brand-gradient h-full" style={{ width: `${pctOurs}%` }} />
        <div className="h-full bg-slate-300" style={{ width: `${Math.max(0, pctDisk - pctOurs)}%` }} />
      </div>
      <div className={cn("mt-2 text-xs", low ? "font-medium text-rose-600" : "text-slate-500")}>
        {formatBytes(free)} free of {formatBytes(total)}
        {low && " — the storage drive is nearly full"}
      </div>
    </div>
  );
}

function SystemCard() {
  const sys = useApi<SystemStatus>("/api/system", { poll: 30000 });
  const d = sys.data;
  const issues: { title: string; fix: React.ReactNode }[] = [];
  if (d) {
    if (!d.ollama.ok)
      issues.push({
        title: "Ollama isn't running",
        fix: (
          <>
            Start Ollama (open the Ollama app, or run <code>ollama serve</code>). Clip analysis and semantic search need it.
          </>
        ),
      });
    else {
      if (d.ollama.llm === false)
        issues.push({
          title: `AI model ${d.llm_model} is missing`,
          fix: (
            <>
              Run <code>ollama pull {d.llm_model}</code> once.
            </>
          ),
        });
      if (d.ollama.embed === false)
        issues.push({
          title: "Search embedding model is missing",
          fix: (
            <>
              Run <code>ollama pull nomic-embed-text</code>. Until then search falls back to keywords.
            </>
          ),
        });
    }
    if (!d.worker_alive)
      issues.push({
        title: "The processing worker isn't running",
        fix: <>Uploads will wait in the queue until the worker is started on the server computer.</>,
      });
  }

  return (
    <Card>
      <CardHeader
        title="System status"
        icon={<Cpu className="h-4 w-4" />}
        action={
          <Button variant="ghost" size="icon-sm" onClick={() => void sys.reload()} aria-label="Refresh status">
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {sys.error && !d ? (
          <p className="text-sm text-rose-600">{sys.error}</p>
        ) : !d ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <StatusRow ok={d.ollama.ok} label="Ollama (local AI)" />
            <StatusRow ok={d.ollama.ok && d.ollama.llm !== false} label={`Language model · ${d.llm_model}`} />
            <StatusRow ok={d.ollama.ok && d.ollama.embed !== false} label="Search embeddings" />
            <StatusRow ok={d.worker_alive} label="Processing worker" />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Activity className="h-3.5 w-3.5" /> Transcription: {d.whisper_model}
            </div>
            {issues.length > 0 ? (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                {issues.map((i) => (
                  <div key={i.title} className="text-xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" /> {i.title}
                    </div>
                    <div className="mt-0.5 pl-5 text-amber-800 [&_code]:rounded [&_code]:bg-amber-100 [&_code]:px-1 [&_code]:font-mono">
                      {i.fix}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                Everything is running.
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate text-slate-700">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4" /> OK
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
          <XCircle className="h-4 w-4" /> Down
        </span>
      )}
    </div>
  );
}
