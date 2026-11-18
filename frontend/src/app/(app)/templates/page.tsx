"use client";

import { useState } from "react";
import { Copy, Lock, Pencil, Plus, Trash2, Type } from "lucide-react";
import { CaptionPreview } from "@/components/caption-preview";
import { ColorInput } from "@/components/color-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError, PageHeader } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { CaptionPosition, Template, TemplateStyle } from "@/lib/types";

const FALLBACK_STYLE: TemplateStyle = {
  font: "Arial Black",
  font_size: 72,
  primary_color: "#FFFFFF",
  highlight_color: "#FFD400",
  outline_color: "#000000",
  outline: 5,
  shadow: 2,
  bg_box: false,
  bg_color: "#000000",
  uppercase: true,
  words_per_line: 3,
  position: "lower",
  animation: "highlight",
};

type Editing = { mode: "create"; name: string; style: TemplateStyle } | { mode: "edit"; template: Template };

export default function TemplatesPage() {
  const toast = useToast();
  const templates = useApi<Template[]>("/api/templates");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const builtins = templates.data?.filter((t) => t.builtin) ?? [];
  const custom = templates.data?.filter((t) => !t.builtin) ?? [];

  const duplicate = (t: Template) => setEditing({ mode: "create", name: `${t.name} copy`, style: { ...FALLBACK_STYLE, ...t.style } });

  const grid = (list: Template[]) => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {list.map((t) => (
        <Card key={t.id} className="overflow-hidden p-3">
          <CaptionPreview style={t.style} width={150} className="mx-auto" />
          <div className="mt-3 flex items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{t.name}</div>
              <div className="truncate text-xs text-slate-500">
                {t.style.font} · {t.style.words_per_line} words/line
              </div>
            </div>
            {t.builtin && (
              <Badge className="shrink-0">
                <Lock className="h-3 w-3" /> Built-in
              </Badge>
            )}
          </div>
          <div className="mt-2 flex gap-1">
            <Button variant="outline" size="sm" onClick={() => duplicate(t)}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
            {!t.builtin && (
              <>
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ mode: "edit", template: t })} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(t)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Caption templates"
        description="How burned-in captions look on your clips. Previews are approximate."
        action={
          <Button onClick={() => setEditing({ mode: "create", name: "My template", style: { ...FALLBACK_STYLE, ...(builtins[0]?.style ?? {}) } })}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      />
      {templates.error && !templates.data ? (
        <ErrorState message={templates.error} onRetry={templates.reload} />
      ) : !templates.data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="aspect-[9/19]" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Your templates</h2>
            {custom.length ? (
              grid(custom)
            ) : (
              <EmptyState
                icon={<Type className="h-6 w-6" />}
                title="No custom templates yet"
                description="Duplicate a built-in template to tweak fonts, colours and position."
              />
            )}
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Built-in</h2>
            {builtins.length ? grid(builtins) : <p className="text-sm text-slate-500">No built-in templates were returned by the server.</p>}
          </section>
        </div>
      )}

      {editing && (
        <TemplateDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            await templates.reload();
            toast.success(msg);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Clips already rendered with it keep their look."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.del(`/api/templates/${deleting.id}`);
          await templates.reload();
          toast.success("Template deleted");
        }}
      />
    </div>
  );
}

function TemplateDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const [name, setName] = useState(editing.mode === "edit" ? editing.template.name : editing.name);
  const [style, setStyle] = useState<TemplateStyle>(editing.mode === "edit" ? { ...FALLBACK_STYLE, ...editing.template.style } : editing.style);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TemplateStyle>(k: K, v: TemplateStyle[K]) => setStyle((s) => ({ ...s, [k]: v }));
  const hex = /^#[0-9A-Fa-f]{6}$/;

  const submit = async () => {
    if (!name.trim()) return setError("Give the template a name.");
    if (![style.primary_color, style.highlight_color, style.outline_color, style.bg_color].every((c) => hex.test(c))) return setError("Colours must be hex values like #FFD400.");
    setBusy(true);
    setError(null);
    try {
      if (editing.mode === "edit") await api.patch(`/api/templates/${editing.template.id}`, { name: name.trim(), style });
      else await api.post("/api/templates", { name: name.trim(), style });
      await onSaved(editing.mode === "edit" ? "Template updated" : "Template created");
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
      size="xl"
      title={editing.mode === "edit" ? "Edit template" : "New template"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Font" hint="Must be installed on the server computer.">
              <Input value={style.font} onChange={(e) => set("font", e.target.value)} maxLength={100} />
            </Field>
            <Field label={`Font size · ${style.font_size}`}>
              <input type="range" min={24} max={160} value={style.font_size} onChange={(e) => set("font_size", Number(e.target.value))} className="mt-3 w-full" />
            </Field>
            <ColorInput label="Text colour" value={style.primary_color} onChange={(v) => set("primary_color", v)} />
            <ColorInput label="Highlight colour" value={style.highlight_color} onChange={(v) => set("highlight_color", v)} />
            <ColorInput label="Outline colour" value={style.outline_color} onChange={(v) => set("outline_color", v)} />
            <Field label={`Outline · ${style.outline}`}>
              <input type="range" min={0} max={10} value={style.outline} onChange={(e) => set("outline", Number(e.target.value))} className="mt-3 w-full" />
            </Field>
            <Field label={`Shadow · ${style.shadow}`}>
              <input type="range" min={0} max={8} value={style.shadow} onChange={(e) => set("shadow", Number(e.target.value))} className="mt-3 w-full" />
            </Field>
            <Field label={`Words per line · ${style.words_per_line}`}>
              <input type="range" min={1} max={8} value={style.words_per_line} onChange={(e) => set("words_per_line", Number(e.target.value))} className="mt-3 w-full" />
            </Field>
            <Field label="Position">
              <Select value={style.position} onChange={(e) => set("position", e.target.value as CaptionPosition)}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="lower">Lower third</option>
                <option value="bottom">Bottom</option>
              </Select>
            </Field>
            <Field label="Animation">
              <Select value={style.animation} onChange={(e) => set("animation", e.target.value as TemplateStyle["animation"])}>
                <option value="highlight">Highlight spoken word</option>
                <option value="pop">Pop (scale up spoken word)</option>
                <option value="none">None</option>
              </Select>
            </Field>
          </div>
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <Switch checked={style.uppercase} onChange={(v) => set("uppercase", v)} label="UPPERCASE text" />
            <Switch checked={style.bg_box} onChange={(v) => set("bg_box", v)} label="Background box behind text" />
            {style.bg_box && <ColorInput label="Box colour" value={style.bg_color} onChange={(v) => set("bg_color", v)} />}
          </div>
          <InlineError>{error}</InlineError>
        </div>
        <div className="flex flex-col items-center md:sticky md:top-0 md:self-start">
          <CaptionPreview style={style} width={220} />
          <p className="mt-2 text-center text-[11px] text-slate-400">Live preview (approximate)</p>
        </div>
      </div>
    </Dialog>
  );
}
