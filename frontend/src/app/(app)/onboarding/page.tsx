"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { CaptionPreview } from "@/components/caption-preview";
import { ColorInput } from "@/components/color-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/spinner";
import { InlineError } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api";
import { cn, PLATFORMS } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { BrandKit, Template } from "@/lib/types";

const STEPS = ["Your ministry", "Platforms", "Branding", "Captions"];
const HEX = /^#[0-9A-Fa-f]{6}$/;

export default function OnboardingPage() {
  const { me, refresh } = useAuth();
  const router = useRouter();
  const kits = useApi<BrandKit[]>("/api/brand-kits");
  const templates = useApi<Template[]>("/api/templates");
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me?.org.name ?? "");
  const [speaker, setSpeaker] = useState(me?.org.speaker_name ?? "");
  const [platforms, setPlatforms] = useState<string[]>(me?.org.platforms?.length ? me.org.platforms : ["YouTube Shorts", "TikTok", "Instagram Reels"]);
  const [colors, setColors] = useState<{ primary: string; secondary: string; accent: string } | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kit = kits.data?.find((k) => k.is_default) ?? kits.data?.[0];
  const effColors = colors ?? {
    primary: kit?.colors.primary ?? "#6D28D9",
    secondary: kit?.colors.secondary ?? "#0F172A",
    accent: kit?.colors.accent ?? "#FFD400",
  };
  const effTemplate = templateId ?? kit?.default_template_id ?? templates.data?.[0]?.id ?? null;

  const finish = async (skip = false) => {
    setBusy(true);
    setError(null);
    try {
      if (!skip) {
        if (!name.trim()) {
          setStep(0);
          throw new Error("Enter your church or ministry name.");
        }
        if (![effColors.primary, effColors.secondary, effColors.accent].every((c) => HEX.test(c))) {
          setStep(2);
          throw new Error("Brand colours must be hex values like #6D28D9.");
        }
        if (kit) {
          await api.patch(`/api/brand-kits/${kit.id}`, {
            name: name.trim(),
            colors: effColors,
            default_template_id: effTemplate,
          });
          if (logo) {
            const fd = new FormData();
            fd.append("file", logo);
            await api.post(`/api/brand-kits/${kit.id}/logo`, fd);
          }
        }
        await api.patch("/api/org", { name: name.trim(), speaker_name: speaker.trim() || null, platforms, onboarded: true });
      } else {
        await api.patch("/api/org", { onboarded: true });
      }
      // refresh the shell's copy of the org (onboarded=true) before leaving, or the gate would bounce us back
      await refresh();
      router.replace("/dashboard");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-b from-indigo-50/60 to-transparent px-4 py-10 sm:items-center">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="bg-brand-gradient flex h-9 w-9 items-center justify-center rounded-xl">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">Welcome to Sermon Shorts</span>
        </div>
        <ol className="mb-6 flex gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={cn("h-1.5 rounded-full transition-colors", i <= step ? "bg-brand-gradient" : "bg-slate-200")} />
              <div className={cn("mt-1.5 hidden text-xs sm:block", i === step ? "font-medium text-slate-900" : "text-slate-400")}>{s}</div>
            </li>
          ))}
        </ol>
        <Card className="animate-pop-in p-6 sm:p-8" key={step}>
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Tell us about your ministry</h1>
                <p className="mt-1 text-sm text-slate-500">Used on your brand kit and pre-filled when you upload.</p>
              </div>
              <Field label="Church / ministry name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
              </Field>
              <Field label="Main speaker" hint="e.g. Pastor Grace Wanjiru — you can change it per sermon.">
                <Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={200} />
              </Field>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Where will you post clips?</h1>
                <p className="mt-1 text-sm text-slate-500">All of these use vertical 9:16 video, which is the default.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatforms((ps) => (on ? ps.filter((x) => x !== p) : [...ps, p]))}
                      className={cn(
                        "flex cursor-pointer items-center justify-between rounded-xl border p-4 text-left text-sm font-medium transition",
                        on ? "border-indigo-500 bg-indigo-50/60 text-indigo-800 ring-1 ring-indigo-500" : "border-slate-200 text-slate-700 hover:border-slate-300",
                      )}
                    >
                      {p}
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300")}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Your branding</h1>
                <p className="mt-1 text-sm text-slate-500">Your logo can be stamped on every clip. You can change this later under Brand Kit.</p>
              </div>
              {kits.error && <InlineError>{kits.error}</InlineError>}
              <div>
                <Label>Logo</Label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-300"
                  >
                    {logoPreview || kit?.logo_url ? (
                      <img src={logoPreview ?? kit?.logo_url ?? ""} alt="Logo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-slate-400" />
                    )}
                  </button>
                  <div className="text-xs text-slate-500">
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      {logoPreview ? "Change logo" : "Upload logo"}
                    </Button>
                    <p className="mt-2">PNG with transparent background, up to 5 MB. Optional.</p>
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
              {!kits.data ? (
                <Skeleton className="h-20" />
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <ColorInput label="Primary" value={effColors.primary} onChange={(v) => setColors({ ...effColors, primary: v })} />
                  <ColorInput label="Secondary" value={effColors.secondary} onChange={(v) => setColors({ ...effColors, secondary: v })} />
                  <ColorInput label="Accent" value={effColors.accent} onChange={(v) => setColors({ ...effColors, accent: v })} />
                </div>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Pick a subtitle style</h1>
                <p className="mt-1 text-sm text-slate-500">Most viewers watch muted, so captions matter. You can change this per clip.</p>
              </div>
              {templates.error ? (
                <InlineError>{templates.error}</InlineError>
              ) : !templates.data ? (
                <div className="flex gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-48 w-28" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {templates.data.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      className={cn("cursor-pointer rounded-xl p-1.5 text-left transition", effTemplate === t.id ? "bg-indigo-50 ring-2 ring-indigo-500" : "hover:bg-slate-50")}
                    >
                      <CaptionPreview style={t.style} width={130} className="mx-auto" />
                      <div className="mt-1.5 truncate px-1 text-xs font-medium text-slate-700">{t.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-5">
              <InlineError>{error}</InlineError>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void finish(true)} disabled={busy}>
                Skip setup
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !name.trim()}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button loading={busy} onClick={() => void finish()}>
                Finish setup <Check className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
