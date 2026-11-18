# Sermon Shorts — Architecture

A self-hosted, zero-cost AI sermon-to-shorts tool. Everything runs on one Windows
laptop (RTX 3060 6 GB, 16 GB RAM) and is reachable by a few people on the same
network. No paid services, no subscriptions.

## 1. System architecture

```
 Browser (laptop or phone on Wi-Fi)
        │  http://<laptop-ip>:3100
        ▼
 ┌────────────────────┐  /api/* rewrite   ┌──────────────────────────┐
 │ Next.js frontend   │ ────────────────▶ │ FastAPI API (127.0.0.1:  │
 │ (0.0.0.0:3100)     │                   │ 8000) — auth, uploads,   │
 └────────────────────┘                   │ CRUD, search, streaming  │
                                          └──────────┬───────────────┘
                                                     │ SQLite (WAL)
                                                     ▼
                                          D:\Sermons\db\app.db
                                                     ▲
                                          ┌──────────┴───────────────┐
                                          │ Worker process           │
                                          │ polls processing_jobs    │
                                          │  ├ FFmpeg / ffprobe      │
                                          │  ├ faster-whisper (GPU)  │
                                          │  ├ Ollama: qwen2.5 7B    │
                                          │  ├ Ollama: nomic-embed   │
                                          │  └ OpenCV face detection │
                                          └──────────┬───────────────┘
                                                     ▼
                                     D:\Sermons\media\<org>\<sermon>\...
```

Replacements for the paid services in the original brief:

| Brief                    | Here                                         |
|--------------------------|----------------------------------------------|
| Supabase / Postgres      | SQLite (WAL mode) via SQLAlchemy             |
| Supabase Auth            | Local accounts, bcrypt, JWT httpOnly cookie  |
| S3 / R2 + signed URLs    | Local disk; files served only through authenticated endpoints with HTTP Range |
| Redis + Celery           | `processing_jobs` table + a worker process (claim, heartbeat, retry, recovery) |
| OpenAI Whisper API       | faster-whisper `large-v3-turbo` on CUDA      |
| OpenAI LLM               | Ollama `qwen2.5:7b-instruct` with JSON-schema structured output |
| Embeddings               | Ollama `nomic-embed-text`                    |
| Stripe / M-Pesa          | Not built (personal use). Usage is still tracked. |

The API never runs heavy work; it only queues jobs. Closing the browser never
stops processing. Restarting the worker resumes interrupted jobs.

## 2. Database schema (SQLite)

All ids are UUID strings; every table has `created_at`/`updated_at`.
Tenant isolation: every query on tenant data filters by `org_id` taken from the
authenticated user, never from the request body.

- **organizations**: id, name, speaker_name
- **users**: id, email (unique), password_hash, name, is_active
- **organization_members**: id, org_id→organizations, user_id→users, role (owner|admin|member); unique(org_id,user_id)
- **folders**: id, org_id, name
- **sermons**: id, org_id, folder_id?, created_by, title, speaker, status
  (uploading|queued|processing|ready|failed), progress 0-100, stage, error,
  duration_s, width, height, language, summary, settings JSON (modes, clip
  lengths, max clips, aspect), source_filename, size_bytes
- **video_assets**: id, org_id, sermon_id, kind (original|audio|thumbnail), path, size_bytes, meta JSON
- **transcripts**: id, sermon_id (unique), language, text, word_count
- **transcript_segments**: id, sermon_id, idx, start_s, end_s, text, words JSON `[[start,end,word,prob],...]`, avg_prob; index(sermon_id, idx)
- **search_chunks**: id, org_id, sermon_id, start_s, end_s, text, embedding BLOB (float32)
- **sermon_topics**: id, sermon_id, name, description
- **bible_references**: id, sermon_id, reference (normalised, e.g. "Psalm 23:1"), book, chapter, verse_start, verse_end, start_s, context
- **clip_candidates**: id, sermon_id, start_s, end_s, title, category, hook, reason, transcript, scores JSON, score, status (selected|rejected|duplicate), reject_reason
- **generated_clips**: id, org_id, sermon_id, candidate_id?, title, description, caption, hashtags JSON, category, start_s, end_s, score, score_breakdown JSON, transcript, aspect (9:16|1:1|16:9), template_id, brand_kit_id?, options JSON (captions on/off, logo, watermark, caption position, font size, colors), status (queued|rendering|ready|failed), error, video_path, thumb_path, downloads, render_version
- **clip_captions**: id, clip_id (unique), words JSON (editable, clip-relative times)
- **clip_templates**: id, org_id? (null = built-in), name, style JSON
- **brand_kits**: id, org_id, name, logo_path, colors JSON, font, watermark_text, default_template_id, is_default, auto_apply
- **processing_jobs**: id, org_id, kind (process_sermon|render_clip), ref_id, status (queued|running|done|failed), stage, progress, attempts, max_attempts, error, heartbeat_at, started_at, finished_at
- **usage_records**: id, org_id, kind (processing_minutes|clip_render|download), amount, ref_id
- **notifications**: id, org_id, user_id?, title, body, link, read
- **audit_logs**: id, org_id, user_id, action, target, meta JSON
- **uploads**: id, org_id, user_id, filename, size_bytes, received_bytes, path, status

Deliberately not built (commercial-only): subscriptions, social_accounts,
publishing_jobs.

## 3. Frontend pages

`/login`, `/register`, `/onboarding`, `/dashboard`, `/sermons`,
`/sermons/upload`, `/sermons/[id]` (live processing + details + transcript +
topics + Bible refs + clips), `/clips` (gallery, sort/filter),
`/clips/[id]` (editor), `/search` (Sermon Intelligence), `/brand`,
`/templates`, `/analytics`, `/settings`, `/team`.

## 4. API (all under `/api`, JSON, cookie auth)

Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
`GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`.

Org/team: `GET|PATCH /org`, `GET /org/members`, `POST /org/members`
(owner/admin creates an account for a teammate), `DELETE /org/members/{id}`.

Uploads (resumable, chunked): `POST /uploads` {filename,size} →
`{id, chunk_size, received_bytes}`; `PUT /uploads/{id}?offset=N` (raw body);
`POST /uploads/{id}/complete` {title, speaker, folder_id, settings} → sermon.

Sermons: `GET /sermons?folder_id&q`, `GET /sermons/{id}`, `PATCH /sermons/{id}`,
`DELETE /sermons/{id}`, `POST /sermons/{id}/reprocess`,
`GET /sermons/{id}/transcript`, `GET /sermons/{id}/video` (Range),
`GET /sermons/{id}/thumbnail`, `GET /sermons/{id}/candidates`.

Folders: `GET|POST /folders`, `PATCH|DELETE /folders/{id}`.

Clips: `GET /clips?sermon_id&sort&category`, `GET /clips/{id}`,
`PATCH /clips/{id}` (edit + re-render), `POST /clips` (from search hit or
rejected candidate: sermon_id,start_s,end_s,title), `DELETE /clips/{id}`,
`GET /clips/{id}/captions`, `PUT /clips/{id}/captions`,
`GET /clips/{id}/video` (Range), `GET /clips/{id}/download`,
`GET /clips/{id}/thumbnail`, `GET /clips/download-zip?sermon_id=`.

Search: `GET /search?q=&sermon_id=` → hits with sermon, start/end, excerpt, score.

Brand/templates: `GET|POST /brand-kits`, `PATCH|DELETE /brand-kits/{id}`,
`POST /brand-kits/{id}/logo` (multipart), `GET /brand-kits/{id}/logo`,
`GET /templates`, `POST /templates`, `DELETE /templates/{id}`.

Stats/jobs: `GET /stats`, `GET /analytics`, `GET /jobs?active=1`,
`GET /notifications`, `POST /notifications/read-all`, `GET /health`.

## 5. Video processing workflow (worker, `process_sermon`)

Each stage is idempotent (skips if its output exists) so retries resume.

1. **probe** – ffprobe: duration, resolution, audio stream present; reject otherwise.
2. **audio** – `ffmpeg -vn -ac 1 -ar 16000` → `audio.wav`; thumbnail at 10 % of duration.
3. **transcribe** – faster-whisper large-v3-turbo, int8_float16 on CUDA (CPU
   fallback), VAD, word timestamps, `multilingual=True` so English/Swahili
   switching is handled per segment. Model is freed afterwards so Ollama gets the VRAM.
4. **index** – ~30 s chunks embedded with nomic-embed-text for search; Bible
   references found with a regex over all book names (English + Swahili).
5. **analyse** – transcript split into ~6-minute windows with overlap; each
   window is sent to the LLM as numbered lines `[idx] (mm:ss) text`. The LLM
   returns moments by line range plus sub-scores (JSON schema enforced). A final
   call produces title, summary and topics from window notes.
6. **validate** – boundaries snapped to sentence starts/ends; duration checked
   against the user's chosen lengths (extended/trimmed at sentence boundaries);
   duplicates removed by time overlap and embedding similarity.
7. **rank** – score = weighted LLM sub-scores (hook, clarity, emotion,
   spiritual relevance, standalone, completeness, practical) + measured signals
   (ends on sentence end, Whisper confidence as audio-clarity proxy, speech
   pace). Shown as 0–100 with breakdown. It's a guide, not a virality promise.
8. **select** – top N (≈1 per 5 sermon minutes, 5–15), modes balanced.
9. **render** – one `render_clip` job per clip: cut, face-detected crop to the
   aspect ratio, loudnorm, ASS animated word-highlight captions, logo /
   watermark, NVENC (libx264 fallback), thumbnail.
10. **notify** – notification row; the UI polls.

Reliability: jobs are claimed atomically, heartbeat every few seconds; on
worker start, `running` jobs with stale heartbeats are re-queued; up to 3
attempts; errors are stored and shown. Failures are reported, never faked.

## 6. AI sermon-analysis prompts

The LLM sees only numbered transcript lines, never raw timestamps to invent.
It must return line ranges that already exist, so timestamps always come from
Whisper. Categories: powerful_statement, biblical_teaching, inspirational,
testimony_story, practical_advice, engaging_question. Modes (viral, teaching,
inspirational, all) change the instructions and the category weighting.

## 7. Roadmap

- **Phase 1 (now)**: auth, dashboard, chunked upload, probe/audio/transcribe,
  analysis, clips, captions, face-centred crop, preview, trim/edit, download, ZIP.
- **Phase 2**: per-shot dynamic speaker tracking, more caption animations,
  background music, transitions, simple/advanced editor modes.
- **Phase 3**: better search ranking (hybrid + rerank), topic clip discovery,
  translated captions, URL import (yt-dlp) for content you own.
- **Phase 4 (only if ever commercialised)**: billing, social publishing.

## 8. External services & credentials

None required. Local installs: FFmpeg (present), Ollama + `qwen2.5:7b-instruct`
+ `nomic-embed-text` (on D:), faster-whisper model (downloaded once from
Hugging Face to `D:\Sermons\models\whisper`), Node.js, Python 3.11.
