# Sermon Shorts

A free, self-hosted AI tool that turns long sermons into short vertical clips. It
transcribes the sermon (English, Swahili or both), finds the meaningful moments,
cuts them at sentence boundaries, reframes them to 9:16, 1:1 or 16:9, burns in
animated captions and your church branding, and gives you files ready for
YouTube Shorts, TikTok, Instagram Reels and Facebook Reels.

Everything runs on this laptop. There are no subscriptions or API keys, and the
sermon audio never leaves the machine.

## Quick start

```powershell
cd D:\Sermons\Sermon_shorts
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1     # once
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # each time
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1      # to stop
```

Everything lives in `D:\Sermons`:

```
D:\Sermons\
  Sermon_shorts\               the app (backend, frontend, scripts, docs)
    backend\.venv\             Python environment
  db\  media\  models\  logs\  your data, models and logs
```

The app always uses the Python environment in `backend\.venv`.

A Python environment can't be moved or copied to another folder, because it
stores absolute paths. If you move the project, delete `backend\.venv` and run
`scripts\setup.ps1` again.

Open http://localhost:3100 and create your account. **The first account becomes
the owner, and after that sign-up is closed.** Add teammates on the **Team**
page. Others on the same Wi-Fi open `http://<laptop-ip>:3100`, which start.ps1
prints. Allow Node.js through Windows Firewall when Windows asks.

## What runs where

| Part | What | Where |
|---|---|---|
| Web app | Next.js on port 3100 | `frontend/` |
| API | FastAPI on 127.0.0.1:18765 (only reachable through the web app) | `backend/app` |
| Worker | Background jobs: probe → audio → transcribe → index → AI analysis → select → render | `backend/app/worker.py` |
| Database | SQLite | `D:\Sermons\db\app.db` |
| Videos and clips | Originals are never modified; clips are stored separately | `D:\Sermons\media\<org>\<sermon>\` |
| Transcription | faster-whisper `large-v3-turbo` on the RTX 3060 (CPU fallback) | `D:\Sermons\models\whisper` |
| Sermon analysis | Ollama `qwen2.5:7b-instruct` | `D:\Sermons\models\ollama` |
| Search embeddings | Ollama `nomic-embed-text` | same |
| Logs | api, worker and web logs | `D:\Sermons\logs` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the schema, API and pipeline.

## How clips are chosen

1. Whisper produces timestamps for every word.
2. The transcript is split into roughly 7-minute windows. The local LLM reads
   numbered lines and answers only with line numbers, so it can't invent
   timestamps.
3. Each moment is snapped to the start and end of a sentence and fitted to your
   chosen clip lengths. Duplicates are removed by overlap and by meaning.
4. Each clip's score (0–100) combines the AI's ratings (hook, clarity,
   emotion, spiritual relevance, standalone meaning, completeness, practical
   value) with measured signals (clean sentence boundaries, transcription
   confidence as a stand-in for audio clarity). **The score is a guide, not a
   prediction of views.**
5. The top clips (about 1 per 5 minutes of sermon, 5–15 in total) are rendered
   with variety across categories. All other candidates stay visible, and you
   can turn any of them into a clip.

## Video quality

- Your uploaded original is never changed. Every clip is cut from the original file.
- **Export quality** is set per sermon (at upload) and per clip (editor → Format):
  - **Standard** (CRF 21, AAC 160k): close to the original at phone sizes, with the smallest files.
  - **High** (CRF 18, AAC 192k): about 1.3–1.5× larger files.
  - **Maximum** (CRF 15, AAC 256k): near-lossless and about 2× larger, for archiving or re-editing.
- **HDR footage** (HLG from phones, or HDR10) is detected automatically and tone-mapped to standard colour,
  so clips don't look washed out on social media. Every clip is tagged as standard HD colour (BT.709).
- **Vertical clips from landscape video crop a slice of the frame.** From 1080p video that slice is
  606 px wide, which is upscaled to 1080 and looks slightly soft. From 4K video the slice is 1214 px,
  which stays fully sharp. 16:9 clips from 16:9 video aren't cropped.

## Configuration (`backend/.env`)

| Key | Default | Notes |
|---|---|---|
| `DATA_DIR` | `D:/Sermons` | Where everything is stored |
| `SECRET_KEY` | generated | Signs login sessions; keep it private |
| `ALLOW_REGISTRATION` | `false` | `true` lets anyone on the network create their own separate account and organization |
| `LLM_MODEL` | `qwen2.5:7b-instruct` | Any Ollama model, e.g. `llama3.1:8b` |
| `WHISPER_MODEL` | `large-v3-turbo` | `medium` is faster; `large-v3` is slower but slightly better for Swahili |
| `VIDEO_ENCODER` | `auto` | `h264_nvenc` needs NVIDIA driver ≥ 610. Your driver (566) is older, so the CPU encoder `libx264` is used |
| `MAX_UPLOAD_GB` / `MAX_DURATION_HOURS` | 20 / 6 | Upload limits, enforced on the server |

## Tests

```powershell
cd D:\Sermons\Sermon_shorts\backend
.venv\Scripts\python.exe -m pytest -q
# full pipeline against a running API (uses a throwaway account):
.venv\Scripts\python.exe scripts\e2e_smoke.py path\to\video.mp4 --base http://127.0.0.1:18765
```

## Backups

Copy `D:\Sermons\db\app.db` while the app is stopped, and `D:\Sermons\media` if
you want to keep the videos. Deleting a sermon in the app removes its files.

## Known limits

- Speed on this laptop: a 1-hour sermon takes about 15–25 minutes in total
  (transcription on the GPU; rendering on the CPU, about 15 s per 30 s clip).
- Speaker framing uses OpenCV face detection with smoothed panning. It works
  best with one clearly visible speaker. Use the framing slider in the editor
  to adjust.
- A local 7B model picks clips well but less reliably than large cloud models.
  Review the picks and trim in the editor.
- Swahili transcription is good but not perfect. Fix words in the caption
  editor.
- Not built (commercial-only features): billing, social posting, Google login,
  email verification.
