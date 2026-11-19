"use client";

import { useState } from "react";
import { Crop, Palette, Scissors, Subtitles, Type, FileText, Stamp } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { BrandKit, Clip, Template } from "@/lib/types";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Tabs } from "../ui/tabs";
import { useToast } from "../ui/toast";
import { CaptionsPanel } from "./captions";
import { diffDraft, draftFromClip, type Draft } from "./draft";
import { BrandingPanel, DetailsPanel, FormatPanel, StylePanel, TrimPanel } from "./panels";

type Tab = "details" | "trim" | "captions" | "style" | "branding" | "format";

export function ClipEditor({ clip, onUpdated, onReload }: { clip: Clip; onUpdated: (c: Clip) => void; onReload: () => Promise<void> }) {
  const toast = useToast();
  const [base, setBase] = useState<Draft>(() => draftFromClip(clip));
  const [draft, setDraft] = useState<Draft>(base);
  const [tab, setTab] = useState<Tab>("details");
  const [advanced, setAdvanced] = useState(false);
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const templates = useApi<Template[]>("/api/templates");
  const kits = useApi<BrandKit[]>("/api/brand-kits");

  const { body, rerender, empty } = diffDraft(base, draft, snap);
  const update = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const updateOptions = (p: Partial<Draft["options"]>) => setDraft((d) => ({ ...d, options: { ...d.options, ...p } }));

  const save = async () => {
    const dur = draft.end_s - draft.start_s;
    if (dur < 3) return toast.error("Clip too short", "A clip must be at least 3 seconds.");
    if (dur > 600) return toast.error("Clip too long", "A clip can be at most 10 minutes.");
    setSaving(true);
    try {
      const next = await api.patch<Clip>(`/api/clips/${clip.id}`, body);
      onUpdated(next);
      const d = draftFromClip(next);
      setBase(d);
      setDraft(d);
      toast.success(rerender ? "Saved — re-rendering the clip" : "Saved");
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const activeTab = !advanced && tab === "captions" ? "details" : tab;

  return (
    <div className="min-w-0">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            variant="underline"
            className="border-0"
            value={activeTab}
            onChange={setTab}
            items={[
              { value: "details", label: "Details", icon: <FileText className="h-4 w-4" /> },
              { value: "trim", label: "Trim", icon: <Scissors className="h-4 w-4" /> },
              { value: "captions", label: "Captions", icon: <Subtitles className="h-4 w-4" />, hidden: !advanced },
              { value: "style", label: "Style", icon: <Type className="h-4 w-4" /> },
              { value: "branding", label: "Branding", icon: <Stamp className="h-4 w-4" /> },
              { value: "format", label: "Format", icon: <Crop className="h-4 w-4" /> },
            ]}
          />
          <div className="mb-2 inline-flex shrink-0 self-start rounded-lg bg-slate-100 p-0.5 text-xs font-medium sm:self-auto">
            {(["simple", "advanced"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setAdvanced(m === "advanced")}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 capitalize transition",
                  advanced === (m === "advanced") ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {activeTab === "details" && <DetailsPanel draft={draft} update={update} clip={clip} />}
          {activeTab === "trim" && <TrimPanel draft={draft} update={update} clip={clip} snap={snap} setSnap={setSnap} />}
          {activeTab === "captions" && <CaptionsPanel clip={clip} dirtyTiming={draft.start_s !== base.start_s || draft.end_s !== base.end_s} onSaved={onReload} />}
          {activeTab === "style" && <StylePanel draft={draft} update={update} updateOptions={updateOptions} templates={templates} advanced={advanced} />}
          {activeTab === "branding" && <BrandingPanel draft={draft} update={update} updateOptions={updateOptions} kits={kits} clip={clip} advanced={advanced} />}
          {activeTab === "format" && <FormatPanel draft={draft} update={update} updateOptions={updateOptions} clip={clip} advanced={advanced} />}
        </div>
      </Card>

      <div
        className={cn(
          "sticky bottom-4 z-20 mt-4 transition-all duration-200",
          empty ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100",
        )}
      >
        <div className="flex flex-col gap-3 rounded-2xl bg-navy-900 px-4 py-3 text-sm text-white shadow-2xl sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-indigo-300" />
            {rerender ? "Unsaved changes — saving will re-render the clip." : "Unsaved changes."}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setDraft(base)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" loading={saving} onClick={() => void save()}>
              {rerender ? "Save & re-render" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
