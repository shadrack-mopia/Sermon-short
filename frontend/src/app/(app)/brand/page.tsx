"use client";

import { useRef, useState } from "react";
import { ImagePlus, Palette, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { ColorInput } from "@/components/color-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError, PageHeader } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { cn, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { BrandKit, LogoPosition, Template } from "@/lib/types";

export default function BrandPage() {
  const toast = useToast();
  const kits = useApi<BrandKit[]>("/api/brand-kits");
  const templates = useApi<Template[]>("/api/templates");
  const [editing, setEditing] = useState<BrandKit | "new" | null>(null);
  const [deleting, setDeleting] = useState<BrandKit | null>(null);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Brand Kit"
        description="Logos, colours and watermarks applied to your clips."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New brand kit
          </Button>
        }
      />
      {kits.error && !kits.data ? (
        <ErrorState message={kits.error} onRetry={kits.reload} />
      ) : !kits.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : kits.data.length === 0 ? (
        <EmptyState
          icon={<Palette className="h-6 w-6" />}
          title="No brand kits"
          description="Create a brand kit with your church logo and colours to stamp every clip."
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Create brand kit
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kits.data.map((k) => (
            <Card key={k.id} className="overflow-hidden">
              <div className="relative flex h-32 items-center justify-center" style={{ background: `linear-gradient(135deg, ${k.colors.primary ?? "#6D28D9"}, ${k.colors.secondary ?? "#0F172A"})` }}>
                {k.logo_url ? (
                  <img src={k.logo_url} alt={`${k.name} logo`} className="max-h-20 max-w-[60%] object-contain drop-shadow" />
                ) : (
                  <span className="text-sm text-white/70">No logo yet</span>
                )}
                {k.watermark_text && <span className="absolute right-3 bottom-2 text-[11px] text-white/70">{k.watermark_text}</span>}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{k.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {k.is_default && (
                        <Badge tone="violet">
                          <Star className="h-3 w-3" /> Default
                        </Badge>
                      )}
                      {k.auto_apply && <Badge tone="green">Auto-apply</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(k)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(k)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(["primary", "secondary", "accent"] as const).map((c) => (
                    <span key={c} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: k.colors[c] }} />
                      {k.colors[c]}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-slate-500">
                  {k.font ? `Font: ${k.font} · ` : ""}Logo: {humanize(k.logo_position)}
                  {k.default_template_id && templates.data ? ` · Captions: ${templates.data.find((t) => t.id === k.default_template_id)?.name ?? "—"}` : ""}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <KitDialog
          kit={editing === "new" ? null : editing}
          templates={templates.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await kits.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Clips that used this kit keep their current render; future renders won't use it."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.del(`/api/brand-kits/${deleting.id}`);
          await kits.reload();
          toast.success("Brand kit deleted");
        }}
      />
    </div>
  );
}

const POSITIONS: LogoPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

function KitDialog({ kit, templates, onClose, onSaved }: { kit: BrandKit | null; templates: Template[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: kit?.name ?? "",
    primary: kit?.colors.primary ?? "#6D28D9",
    secondary: kit?.colors.secondary ?? "#0F172A",
    accent: kit?.colors.accent ?? "#FFD400",
    font: kit?.font ?? "",
    watermark_text: kit?.watermark_text ?? "",
    logo_position: kit?.logo_position ?? ("top-right" as LogoPosition),
    default_template_id: kit?.default_template_id ?? "",
    is_default: kit?.is_default ?? false,
    auto_apply: kit?.auto_apply ?? true,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(kit?.logo_url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const hex = /^#[0-9A-Fa-f]{6}$/;
  const submit = async () => {
    if (!form.name.trim()) return setError("Give the brand kit a name.");
    if (![form.primary, form.secondary, form.accent].every((c) => hex.test(c))) return setError("Colours must be hex values like #6D28D9.");
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      colors: { primary: form.primary, secondary: form.secondary, accent: form.accent },
      font: form.font.trim() || null,
      watermark_text: form.watermark_text.trim() || null,
      logo_position: form.logo_position,
      default_template_id: form.default_template_id || null,
      is_default: form.is_default,
      auto_apply: form.auto_apply,
    };
    try {
      const saved = kit ? await api.patch<BrandKit>(`/api/brand-kits/${kit.id}`, body) : await api.post<BrandKit>("/api/brand-kits", body);
      if (logo) {
        const fd = new FormData();
        fd.append("file", logo);
        try {
          await api.post(`/api/brand-kits/${saved.id}/logo`, fd);
        } catch (e) {
          await onSaved();
          setError(`Saved, but the logo upload failed: ${errorMessage(e)}`);
          setBusy(false);
          return;
        }
      }
      await onSaved();
      toast.success(kit ? "Brand kit updated" : "Brand kit created");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const removeLogo = async () => {
    if (!kit) {
      setLogo(null);
      setLogoPreview(null);
      return;
    }
    try {
      await api.del(`/api/brand-kits/${kit.id}/logo`);
      setLogo(null);
      setLogoPreview(null);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={kit ? "Edit brand kit" : "New brand kit"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} placeholder="e.g. Grace Church main" autoFocus />
        </Field>
        <div>
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
              {logoPreview ? <img src={logoPreview} alt="Logo preview" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {logoPreview ? "Replace" : "Upload logo"}
                </Button>
                {logoPreview && (
                  <Button variant="ghost" size="sm" onClick={() => void removeLogo()}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">PNG with transparency works best. PNG, JPG or WEBP up to 5 MB.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) return setError("Logo must be under 5 MB.");
                setLogo(f);
                setLogoPreview(URL.createObjectURL(f));
              }}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput label="Primary" value={form.primary} onChange={(v) => set("primary", v)} />
          <ColorInput label="Secondary" value={form.secondary} onChange={(v) => set("secondary", v)} />
          <ColorInput label="Accent" value={form.accent} onChange={(v) => set("accent", v)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Font" hint="Must be installed on the server computer.">
            <Input value={form.font} onChange={(e) => set("font", e.target.value)} placeholder="e.g. Montserrat" maxLength={100} />
          </Field>
          <Field label="Watermark text">
            <Input value={form.watermark_text} onChange={(e) => set("watermark_text", e.target.value)} placeholder="e.g. @gracechurch" maxLength={200} />
          </Field>
          <Field label="Logo position">
            <div className="grid grid-cols-2 gap-1.5">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set("logo_position", p)}
                  className={cn(
                    "cursor-pointer rounded-lg border px-2 py-1.5 text-xs font-medium transition",
                    form.logo_position === p ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
                  )}
                >
                  {humanize(p)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Default caption template">
            <Select value={form.default_template_id} onChange={(e) => set("default_template_id", e.target.value)}>
              <option value="">System default</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="space-y-4 rounded-xl bg-slate-50 p-4">
          <Switch checked={form.is_default} onChange={(v) => set("is_default", v)} label="Default brand kit" description="Used for new sermons unless you pick another." />
          <Switch checked={form.auto_apply} onChange={(v) => set("auto_apply", v)} label="Auto-apply to new clips" description="Stamp the logo/watermark on clips automatically." />
        </div>
        <InlineError>{error}</InlineError>
      </div>
    </Dialog>
  );
}
