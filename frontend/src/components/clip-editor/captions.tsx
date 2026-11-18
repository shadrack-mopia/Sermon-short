"use client";

import { useState } from "react";
import { Merge, RotateCcw, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn, formatTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { CaptionWord, Clip } from "@/lib/types";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/input";
import { Skeleton } from "../ui/spinner";
import { ErrorState } from "../ui/states";
import { useToast } from "../ui/toast";

interface CaptionsResponse {
  words: CaptionWord[];
  edited: boolean;
}

export function CaptionsPanel({ clip, dirtyTiming, onSaved }: { clip: Clip; dirtyTiming: boolean; onSaved: () => Promise<void> }) {
  const res = useApi<CaptionsResponse>(`/api/clips/${clip.id}/captions`);
  if (res.error && !res.data) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data)
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-14" />
        ))}
      </div>
    );
  return <WordEditor key={JSON.stringify(res.data.words).length} initial={res.data} clip={clip} dirtyTiming={dirtyTiming} onSaved={onSaved} reload={res.reload} />;
}

function WordEditor({
  initial,
  clip,
  dirtyTiming,
  onSaved,
  reload,
}: {
  initial: CaptionsResponse;
  clip: Clip;
  dirtyTiming: boolean;
  onSaved: () => Promise<void>;
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const [words, setWords] = useState<CaptionWord[]>(initial.words);
  const [sel, setSel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(words) !== JSON.stringify(initial.words);
  const dur = clip.end_s - clip.start_s;

  const setWord = (i: number, w: Partial<{ start: number; end: number; text: string }>) =>
    setWords((ws) => ws.map((x, j) => (j === i ? [w.start ?? x[0], w.end ?? x[1], w.text ?? x[2]] : x)));

  const mergeNext = (i: number) => {
    if (i >= words.length - 1) return;
    setWords((ws) => {
      const a = ws[i];
      const b = ws[i + 1];
      const merged: CaptionWord = [a[0], b[1], `${a[2]} ${b[2]}`.trim()];
      return [...ws.slice(0, i), merged, ...ws.slice(i + 2)];
    });
  };

  const remove = (i: number) => {
    setWords((ws) => ws.filter((_, j) => j !== i));
    setSel((s) => (s === null ? null : s >= words.length - 1 ? Math.max(0, words.length - 2) : s));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/clips/${clip.id}/captions`, { words });
      toast.success("Captions saved — re-rendering the clip");
      await Promise.all([reload(), onSaved()]);
    } catch (e) {
      toast.error("Couldn't save captions", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const w = sel !== null ? words[sel] : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Click a word to fix its spelling or timing. Times are seconds from the start of the clip.
        {initial.edited && " These captions have been edited by hand."}
      </p>
      {dirtyTiming && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          You have an unsaved trim. Saving the trim rebuilds captions from the transcript, so save the trim first, then edit captions.
        </div>
      )}
      {words.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No caption words for this clip.</p>
      ) : (
        <div className="scroll-thin flex max-h-72 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-slate-50 p-3">
          {words.map((x, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSel(i)}
              title={`${x[0].toFixed(2)}s – ${x[1].toFixed(2)}s`}
              className={cn(
                "cursor-pointer rounded-md px-1.5 py-0.5 text-sm transition",
                sel === i ? "bg-indigo-600 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200 hover:ring-indigo-300",
              )}
            >
              {x[2]}
            </button>
          ))}
        </div>
      )}

      {w && sel !== null && (
        <div className="animate-pop-in rounded-xl border border-slate-200 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_110px_110px]">
            <Field label="Text">
              <Input value={w[2]} onChange={(e) => setWord(sel, { text: e.target.value })} maxLength={60} autoFocus />
            </Field>
            <Field label="Start (s)">
              <Input
                type="number"
                step={0.05}
                min={0}
                max={dur}
                value={w[0]}
                onChange={(e) => setWord(sel, { start: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label="End (s)">
              <Input
                type="number"
                step={0.05}
                min={0}
                max={dur}
                value={w[1]}
                onChange={(e) => setWord(sel, { end: Math.min(dur, Number(e.target.value) || 0) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 tabular-nums">At {formatTime(clip.start_s + w[0], true)} in the sermon</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => mergeNext(sel)} disabled={sel >= words.length - 1}>
                <Merge className="h-3.5 w-3.5" /> Merge with next
              </Button>
              <Button variant="outline" size="sm" className="text-rose-600" onClick={() => remove(sel)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            setWords(initial.words);
            setSel(null);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Undo changes
        </Button>
        <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void save()}>
          Save captions & re-render
        </Button>
      </div>
    </div>
  );
}
