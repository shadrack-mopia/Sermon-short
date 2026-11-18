"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Check, Info, Plus, Search, Sparkles } from "lucide-react";
import { SegmentPlayer } from "@/components/segment-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, qs } from "@/lib/api";
import { formatDuration, formatTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Clip, SearchHit, SearchResponse, Sermon } from "@/lib/types";

const EXAMPLES = ["prayer", "faith", "forgiveness", "Psalm 23", "marriage", "financial stewardship", "overcoming fear"];

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [sermonId, setSermonId] = useState("");
  const sermons = useApi<Sermon[]>("/api/sermons?status=ready");
  const results = useApi<SearchResponse>(query.length >= 2 ? `/api/search${qs({ q: query, sermon_id: sermonId, limit: 20 })}` : null);

  const run = (q: string) => {
    const t = q.trim();
    setInput(t);
    setQuery(t);
  };

  return (
    <div className="animate-fade-in">
      <div className="relative mb-8 overflow-hidden rounded-3xl bg-navy-900 px-5 py-10 text-center sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="relative">
          <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <Sparkles className="h-3.5 w-3.5" /> Sermon Intelligence
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Find any moment you&apos;ve ever preached</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">Search by meaning, topic or scripture across every transcribed sermon — then turn it into a clip.</p>
          <form
            className="mx-auto mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              run(input);
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. where does the pastor talk about trusting God in hard times?"
                className="h-12 w-full rounded-2xl border-0 bg-white pr-4 pl-12 text-sm text-slate-900 shadow-xl placeholder:text-slate-400 focus:ring-4 focus:ring-indigo-500/30 focus:outline-none"
                maxLength={300}
              />
            </div>
            <Button type="submit" size="lg" className="h-12" disabled={input.trim().length < 2}>
              Search
            </Button>
          </form>
          <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => run(ex)}
                className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200 transition hover:bg-white/20"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          {results.data && query ? (
            <>
              {results.data.results.length} result{results.data.results.length === 1 ? "" : "s"} for <span className="font-medium text-slate-800">“{results.data.query}”</span>
              {results.data.reference && <> · scripture {results.data.reference}</>}
            </>
          ) : (
            "Search across all your ready sermons."
          )}
        </div>
        <Select wrapperClassName="sm:w-64" value={sermonId} onChange={(e) => setSermonId(e.target.value)} aria-label="Limit to sermon">
          <option value="">All sermons</option>
          {sermons.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
      </div>

      {results.data && !results.data.semantic && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Keyword search was used because the embedding model is unavailable. Start Ollama and pull <code className="font-mono">nomic-embed-text</code> for search by meaning.
          </span>
        </div>
      )}

      {!query ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="Ask a question or try an example"
          description="Results show the exact part of the sermon, with a player that plays just that segment."
        />
      ) : results.error && !results.data ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : results.loading || !results.data ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : results.data.results.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No matching moments"
          description={
            sermons.data && sermons.data.length === 0 ? "You don't have any processed sermons yet." : "Try different words, a broader topic, or a Bible book and chapter."
          }
        />
      ) : (
        <div className="space-y-4">
          {results.data.results.map((h) => (
            <ResultCard key={`${h.sermon_id}-${h.start_s}`} hit={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ hit }: { hit: SearchHit }) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Clip | null>(null);
  const isBible = hit.match.startsWith("Bible");
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="bg-black p-0 md:p-3">
          <SegmentPlayer src={hit.video_url} start={hit.start_s} end={hit.end_s} className="rounded-none md:rounded-xl" />
        </div>
        <div className="flex min-w-0 flex-col p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/sermons/${hit.sermon_id}`} className="font-medium text-slate-900 hover:text-indigo-700">
              {hit.sermon_title ?? "Sermon"}
            </Link>
            <Badge tone={isBible ? "sky" : hit.match === "meaning" ? "violet" : "slate"}>
              {isBible && <BookOpen className="h-3 w-3" />}
              {hit.match === "meaning" ? "Matched by meaning" : hit.match === "keyword" ? "Keyword match" : hit.match}
            </Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
            {formatTime(hit.start_s)} – {formatTime(hit.end_s)} · {formatDuration(hit.end_s - hit.start_s)}
          </div>
          {hit.excerpt && <p className="mt-3 line-clamp-5 text-sm leading-relaxed text-slate-700">{hit.excerpt}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
            {created ? (
              <Link href={`/clips/${created.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" /> Clip created — open editor
              </Link>
            ) : (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> Create clip
              </Button>
            )}
          </div>
        </div>
      </div>
      {creating && <CreateClipDialog hit={hit} onClose={() => setCreating(false)} onCreated={setCreated} />}
    </Card>
  );
}

function suggestTitle(excerpt: string | null) {
  if (!excerpt) return "New clip";
  const first = excerpt.split(/(?<=[.!?])\s+/)[0] ?? excerpt;
  return first.length > 80 ? `${first.slice(0, 77).trim()}…` : first;
}

function CreateClipDialog({ hit, onClose, onCreated }: { hit: SearchHit; onClose: () => void; onCreated: (c: Clip) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(() => suggestTitle(hit.excerpt));
  const [start, setStart] = useState(Math.round(hit.start_s * 10) / 10);
  const [end, setEnd] = useState(Math.round(hit.end_s * 10) / 10);
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (end - start < 3) return setError("A clip must be at least 3 seconds long.");
    setBusy(true);
    setError(null);
    try {
      const c = await api.post<Clip>("/api/clips", { sermon_id: hit.sermon_id, start_s: start, end_s: end, title: title.trim() || "New clip", snap });
      onCreated(c);
      toast.success("Clip created", "It's rendering now.");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create a clip from this moment"
      description={hit.sermon_title ?? undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Create clip
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (seconds)" hint={formatTime(start)}>
            <Input type="number" step={0.5} min={0} value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} />
          </Field>
          <Field label="End (seconds)" hint={`${formatTime(end)} · ${formatDuration(end - start)}`}>
            <Input type="number" step={0.5} min={0} value={end} onChange={(e) => setEnd(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <Switch checked={snap} onChange={setSnap} label="Snap to sentences" description="Adjust the edges so no sentence is cut off." />
        <InlineError>{error}</InlineError>
      </div>
    </Dialog>
  );
}
