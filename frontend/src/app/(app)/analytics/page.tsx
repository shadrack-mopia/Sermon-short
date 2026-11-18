"use client";

import Link from "next/link";
import { BarChart3, Clock, Download, Trophy } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/states";
import { categoryLabel, cn, formatNumber, scoreTone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Analytics } from "@/lib/types";

const CAT_BAR: Record<string, string> = {
  powerful_statement: "bg-rose-500",
  biblical_teaching: "bg-sky-500",
  inspirational: "bg-amber-500",
  testimony_story: "bg-emerald-500",
  practical_advice: "bg-teal-500",
  engaging_question: "bg-fuchsia-500",
  custom: "bg-slate-400",
};

export default function AnalyticsPage() {
  const a = useApi<Analytics>("/api/analytics");

  return (
    <div className="animate-fade-in">
      <PageHeader title="Analytics" description="Processing, downloads and clip quality over the last 90 days." />
      {a.error && !a.data ? (
        <ErrorState message={a.error} onRetry={a.reload} />
      ) : !a.data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72 lg:col-span-2" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Clips by category" description="Count and average score" icon={<BarChart3 className="h-4 w-4" />} />
            <CardBody>
              {a.data.by_category.length === 0 ? (
                <EmptyState className="border-0 py-8" title="No clips yet" description="Categories appear once clips are generated." />
              ) : (
                <CategoryBars data={a.data.by_category} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Weekly activity" description="Minutes of sermon processed and clip downloads per week" icon={<Clock className="h-4 w-4" />} />
            <CardBody>
              {a.data.weekly.length === 0 ? (
                <EmptyState className="border-0 py-8" title="No activity in the last 90 days" />
              ) : (
                <div className="space-y-6">
                  <WeeklyBars data={a.data.weekly.map((w) => ({ week: w.week, value: w.processing_minutes ?? 0 }))} label="Minutes processed" color="#6366f1" unit="min" />
                  <WeeklyBars data={a.data.weekly.map((w) => ({ week: w.week, value: w.download ?? 0 }))} label="Downloads" color="#10b981" />
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Top clips" description="Most downloaded, then highest score" icon={<Trophy className="h-4 w-4" />} />
            <CardBody className="px-0 pb-2">
              {a.data.top_clips.length === 0 ? (
                <div className="px-5">
                  <EmptyState className="border-0 py-8" title="No clips yet" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                        <th className="px-5 py-2.5">#</th>
                        <th className="px-5 py-2.5">Clip</th>
                        <th className="px-5 py-2.5 text-right">Score</th>
                        <th className="px-5 py-2.5 text-right">Downloads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.data.top_clips.map((c, i) => (
                        <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-5 py-3 text-slate-400 tabular-nums">{i + 1}</td>
                          <td className="max-w-0 px-5 py-3">
                            <Link href={`/clips/${c.id}`} className="block truncate font-medium text-slate-800 hover:text-indigo-700">
                              {c.title || "Untitled clip"}
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", scoreTone(c.score))}>{c.score}</span>
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            <span className="inline-flex items-center gap-1 text-slate-700">
                              <Download className="h-3.5 w-3.5 text-slate-400" />
                              {formatNumber(c.downloads)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="px-5 pt-3 text-xs text-slate-400">Scores are a guide, not a guarantee of views. View counts on social platforms aren&apos;t tracked.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function CategoryBars({ data }: { data: Analytics["by_category"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const sorted = [...data].sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-3">
      {sorted.map((d) => (
        <div key={d.category ?? "none"}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-slate-700">{categoryLabel(d.category)}</span>
            <span className="text-xs text-slate-500 tabular-nums">
              {d.count} clip{d.count === 1 ? "" : "s"} · avg {d.avg_score}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full transition-[width] duration-700", CAT_BAR[d.category ?? ""] ?? "bg-indigo-500")} style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function weekLabel(w: string) {
  // backend groups by sqlite strftime('%Y-%W')
  const [, wk] = w.split("-");
  return wk ? `W${Number(wk)}` : w;
}

function WeeklyBars({ data, label, color, unit }: { data: { week: string; value: number }[]; label: string; color: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const H = 110;
  const barW = 100 / Math.max(1, data.length);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">
          {formatNumber(total, 1)}
          {unit ? ` ${unit}` : ""} total
        </span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label={label}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={100} y1={H * f} y2={H * f} stroke="#e2e8f0" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * (H - 4);
          return (
            <rect key={d.week} x={i * barW + barW * 0.18} y={H - h} width={barW * 0.64} height={Math.max(h, d.value > 0 ? 1 : 0)} rx={0.8} fill={color}>
              <title>
                {weekLabel(d.week)}: {formatNumber(d.value, 1)}
                {unit ? ` ${unit}` : ""}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-slate-400">
        {data.map((d, i) => (
          <span key={d.week} className="text-center" style={{ width: `${barW}%` }}>
            {data.length <= 8 || i % 2 === 0 ? weekLabel(d.week) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
