"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckSquare, Clapperboard, Download, Info, Square, Upload, X } from "lucide-react";
import { ClipCard } from "@/components/clip-card";
import { Button, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/states";
import { qs } from "@/lib/api";
import { CATEGORIES, isRendering } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Clip, Sermon } from "@/lib/types";

type Sort = "score" | "duration" | "newest" | "category" | "topic";

export default function ClipsPage() {
  const [category, setCategory] = useState("");
  const [sermonId, setSermonId] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sermons = useApi<Sermon[]>("/api/sermons");
  const clips = useApi<Clip[]>(`/api/clips${qs({ category, sermon_id: sermonId, sort })}`, {
    poll: (d) => (d?.some((c) => isRendering(c.status)) ? 5000 : false),
  });

  const readyIds = useMemo(() => new Set((clips.data ?? []).filter((c) => c.status === "ready").map((c) => c.id)), [clips.data]);
  const sel = [...selected].filter((id) => readyIds.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = readyIds.size > 0 && sel.length === readyIds.size;
  const filtered = !!(category || sermonId);
  const rendering = clips.data?.filter((c) => isRendering(c.status)).length ?? 0;

  return (
    <div className="animate-fade-in pb-20">
      <PageHeader
        title="AI Clips"
        description={
          <span className="inline-flex items-center gap-1">
            Every clip generated from your sermons. <Info className="h-3.5 w-3.5" /> Scores are a guide, not a guarantee of views.
          </span>
        }
      />

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select wrapperClassName="sm:w-52" value={sermonId} onChange={(e) => setSermonId(e.target.value)} aria-label="Filter by sermon">
          <option value="">All sermons</option>
          {sermons.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
        <Select wrapperClassName="sm:w-52" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select wrapperClassName="sm:w-48" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="score">Highest score</option>
          <option value="newest">Newest</option>
          <option value="duration">Shortest first</option>
          <option value="category">Category</option>
          <option value="topic">Title (A–Z)</option>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory("");
              setSermonId("");
            }}
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
        <div className="flex items-center gap-3 sm:ml-auto">
          {rendering > 0 && <span className="text-xs text-indigo-700">{rendering} rendering…</span>}
          {readyIds.size > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(readyIds))}>
              {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
          )}
        </div>
      </div>

      {clips.error && !clips.data ? (
        <ErrorState message={clips.error} onRetry={clips.reload} />
      ) : !clips.data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[9/16]" />
          ))}
        </div>
      ) : clips.data.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Clapperboard className="h-6 w-6" />} title="No clips match these filters" />
        ) : (
          <EmptyState
            icon={<Clapperboard className="h-6 w-6" />}
            title="No clips yet"
            description="Clips appear here once a sermon finishes processing."
            action={
              <Link href="/sermons/upload" className={buttonClass("primary")}>
                <Upload className="h-4 w-4" /> Upload a sermon
              </Link>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {clips.data.map((c) => (
            <ClipCard key={c.id} clip={c} selected={selected.has(c.id)} onToggleSelect={c.status === "ready" ? () => toggle(c.id) : undefined} />
          ))}
        </div>
      )}

      {sel.length > 0 && (
        <div className="animate-pop-in fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 lg:pl-64">
          <div className="flex items-center gap-3 rounded-2xl bg-navy-900 py-2 pr-2 pl-4 text-sm text-white shadow-2xl">
            <span>
              {sel.length} clip{sel.length === 1 ? "" : "s"} selected
            </span>
            <a href={`/api/clips/download-zip${qs({ ids: sel.join(",") })}`} className={buttonClass("primary", "sm")}>
              <Download className="h-3.5 w-3.5" /> Download ZIP
            </a>
            <button onClick={() => setSelected(new Set())} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Clear selection">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
