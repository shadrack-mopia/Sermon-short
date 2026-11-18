import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 75.3 → "1:15", 3725 → "1:02:05" */
export function formatTime(s: number | null | undefined, withTenths = false): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const neg = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = withTenths ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0");
  const out = h ? `${h}:${String(m).padStart(2, "0")}:${secStr}` : `${m}:${secStr}`;
  return neg ? `-${out}` : out;
}

/** 95 → "1m 35s", 3725 → "1h 2m" */
export function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  const sec = Math.round(s % 60);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}

export function formatBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}

export const STAGES: Record<string, string> = {
  queued: "Waiting in the queue",
  probe: "Checking the video",
  audio: "Extracting audio",
  transcribe: "Transcribing the sermon",
  index: "Indexing for search",
  analyse: "Finding the best moments",
  analyze: "Finding the best moments",
  validate: "Checking clip boundaries",
  rank: "Scoring clips",
  select: "Selecting the best clips",
  render: "Rendering clips",
  notify: "Finishing up",
  done: "Done",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "Preparing";
  return STAGES[stage] ?? humanize(stage);
}

export const STAGE_ORDER = ["probe", "audio", "transcribe", "index", "analyse", "select", "render"];

export const CATEGORIES: Record<string, string> = {
  powerful_statement: "Powerful statement",
  biblical_teaching: "Biblical teaching",
  inspirational: "Inspirational",
  testimony_story: "Testimony / story",
  practical_advice: "Practical advice",
  engaging_question: "Engaging question",
  custom: "Custom",
};

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "Uncategorised";
  return CATEGORIES[c] ?? humanize(c);
}

export const CATEGORY_COLORS: Record<string, string> = {
  powerful_statement: "bg-rose-50 text-rose-700 ring-rose-200",
  biblical_teaching: "bg-sky-50 text-sky-700 ring-sky-200",
  inspirational: "bg-amber-50 text-amber-700 ring-amber-200",
  testimony_story: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  practical_advice: "bg-teal-50 text-teal-700 ring-teal-200",
  engaging_question: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  custom: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function humanize(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function isProcessing(status: string | null | undefined) {
  return status === "queued" || status === "processing" || status === "uploading";
}

export function isRendering(status: string | null | undefined) {
  return status === "queued" || status === "rendering";
}

export function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-500 text-white";
  if (score >= 60) return "bg-indigo-500 text-white";
  if (score >= 40) return "bg-amber-500 text-white";
  return "bg-slate-500 text-white";
}

export function aspectClass(aspect: string | null | undefined) {
  if (aspect === "1:1") return "aspect-square";
  if (aspect === "16:9") return "aspect-video";
  return "aspect-[9/16]";
}

export const PLATFORMS = ["YouTube Shorts", "TikTok", "Instagram Reels", "Facebook Reels"];

export const LANGUAGES: Record<string, string> = { auto: "Auto-detect", en: "English", sw: "Swahili" };
