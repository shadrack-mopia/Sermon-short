// Shapes mirror backend/app/serializers.py and the routers. Keep in sync with the API.

export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role | null;
  created_at: string | null;
}

export interface Member extends User {
  member_id: string;
}

export interface Org {
  id: string;
  name: string;
  speaker_name: string | null;
  platforms: string[];
  onboarded: boolean;
}

export interface Me {
  user: User;
  org: Org;
}

export type SermonStatus = "uploading" | "queued" | "processing" | "ready" | "failed";
export type Mode = "viral" | "teaching" | "inspirational" | "all";
export type Aspect = "9:16" | "1:1" | "16:9";
export type Language = "auto" | "en" | "sw";
export type Quality = "standard" | "high" | "max";

export interface SermonSettings {
  modes: Mode[];
  clip_lengths: number[];
  min_s: number | null;
  max_s: number | null;
  max_clips: number;
  aspect: Aspect;
  template_id: string | null;
  brand_kit_id: string | null;
  language: Language;
  quality: Quality;
}

export interface Sermon {
  id: string;
  title: string;
  speaker: string | null;
  status: SermonStatus;
  progress: number;
  stage: string | null;
  error: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  language: string | null;
  summary: string | null;
  settings: Partial<SermonSettings>;
  folder_id: string | null;
  source_filename: string | null;
  size_bytes: number | null;
  clip_count: number | null;
  thumbnail_url: string;
  video_url: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface SermonDetail extends Sermon {
  topics: { name: string; description: string | null }[];
  bible_references: { reference: string; start_s: number; context: string | null }[];
  job: { status: string; stage: string | null; progress: number; attempts: number; error: string | null } | null;
  clips_rendering: number;
}

export interface TranscriptSegment {
  idx: number;
  start_s: number;
  end_s: number;
  text: string;
}

export interface Transcript {
  language: string | null;
  word_count: number;
  segments: TranscriptSegment[];
}

export interface Candidate {
  id: string;
  start_s: number;
  end_s: number;
  title: string | null;
  category: string | null;
  hook: string | null;
  reason: string | null;
  score: number;
  status: "selected" | "rejected" | "duplicate" | string;
  reject_reason: string | null;
  transcript: string | null;
}

export type CaptionPosition = "top" | "middle" | "lower" | "bottom";

export interface ClipOptions {
  captions: boolean;
  logo: boolean;
  watermark: boolean;
  caption_position: CaptionPosition | null;
  font_size: number | null;
  font: string | null;
  primary_color: string | null;
  highlight_color: string | null;
  bg_box: boolean | null;
  uppercase: boolean | null;
  crop_x: number | null;
  resolution: 720 | 1080;
  quality: Quality;
}

export type ClipStatus = "queued" | "rendering" | "ready" | "failed";

export interface Clip {
  id: string;
  sermon_id: string;
  sermon_title: string | null;
  title: string;
  description: string | null;
  caption: string | null;
  hashtags: string[];
  category: string | null;
  start_s: number;
  end_s: number;
  duration_s: number;
  score: number;
  score_breakdown: Record<string, number>;
  reason: string | null;
  transcript: string | null;
  aspect: Aspect;
  template_id: string | null;
  brand_kit_id: string | null;
  options: Partial<ClipOptions>;
  status: ClipStatus;
  error: string | null;
  downloads: number;
  render_version: number;
  video_url: string | null;
  thumbnail_url: string | null;
  download_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  // only on GET /clips/{id}
  sermon_duration_s?: number | null;
  sermon_video_url?: string;
}

/** [start, end, text] with clip-relative seconds */
export type CaptionWord = [number, number, string];

export interface Folder {
  id: string;
  name: string;
  sermon_count: number;
  created_at: string | null;
}

export interface TemplateStyle {
  font: string;
  font_size: number;
  primary_color: string;
  highlight_color: string;
  outline_color: string;
  outline: number;
  shadow: number;
  bg_box: boolean;
  bg_color: string;
  uppercase: boolean;
  words_per_line: number;
  position: CaptionPosition;
  animation: "highlight" | "pop" | "none";
}

export interface Template {
  id: string;
  name: string;
  style: TemplateStyle;
  builtin: boolean;
}

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface BrandKit {
  id: string;
  name: string;
  colors: { primary?: string; secondary?: string; accent?: string };
  font: string | null;
  watermark_text: string | null;
  logo_position: LogoPosition;
  default_template_id: string | null;
  is_default: boolean;
  auto_apply: boolean;
  logo_url: string | null;
}

export interface Stats {
  sermons: number;
  clips: number;
  processing_minutes: number;
  processing_minutes_month: number;
  downloads: number;
  storage_bytes: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
  active_jobs: number;
  recent_sermons: Sermon[];
}

export interface SystemStatus {
  ollama: { ok: boolean; llm?: boolean; embed?: boolean; error?: string };
  worker_alive: boolean;
  last_job_heartbeat: string | null;
  llm_model: string;
  whisper_model: string;
}

export interface Analytics {
  by_category: { category: string | null; count: number; avg_score: number }[];
  weekly: { week: string; processing_minutes?: number; download?: number; clip_render?: number }[];
  top_clips: { id: string; title: string; downloads: number; score: number }[];
}

export interface SearchHit {
  sermon_id: string;
  sermon_title: string | null;
  start_s: number;
  end_s: number;
  excerpt: string | null;
  score: number;
  match: string;
  video_url: string;
}

export interface SearchResponse {
  query: string;
  semantic: boolean;
  reference: string | null;
  results: SearchHit[];
}

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: "info" | "success" | "error" | string;
  read: boolean;
  created_at: string | null;
}

export interface NotificationsResponse {
  unread: number;
  items: Notification[];
}
