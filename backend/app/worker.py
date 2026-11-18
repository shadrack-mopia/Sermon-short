"""Background worker: runs sermon processing and clip rendering jobs from the processing_jobs table.

Run:  python -m app.worker
Jobs survive restarts: a job left 'running' by a crashed worker is re-queued on start.
"""
import json
import logging
import shutil
import signal
import threading
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select, update

from .config import get_settings
from .db import SessionLocal
from .jobs import enqueue, notify, record_usage
from .migrations import DEFAULT_TEMPLATE_ID, migrate
from .models import (
    BibleReference,
    BrandKit,
    ClipCandidate,
    ClipCaption,
    ClipTemplate,
    GeneratedClip,
    ProcessingJob,
    SearchChunk,
    Sermon,
    SermonTopic,
    Transcript,
    TranscriptSegment,
    VideoAsset,
    utcnow,
)
from .pipeline import analysis
from .pipeline.bible import find_references
from .pipeline.boundaries import flatten_words
from .pipeline.render import RenderSpec, clip_thumbnail, detect_track, render
from .services import media, ollama

log = logging.getLogger("worker")
STOP = threading.Event()


class JobCancelled(Exception):
    pass


# ---------------- job plumbing ----------------

class JobRunner:
    def __init__(self, job_id: str):
        self.job_id = job_id
        self._last_write = 0.0

    def update(self, stage: str | None = None, progress: float | None = None, sermon_id: str | None = None,
               force: bool = False):
        now = time.monotonic()
        if not force and now - self._last_write < 1.5:
            return
        self._last_write = now
        with SessionLocal() as db:
            job = db.get(ProcessingJob, self.job_id)
            if job is None or job.status != "running":
                raise JobCancelled()
            if stage:
                job.stage = stage
            if progress is not None:
                job.progress = int(progress)
            job.heartbeat_at = utcnow()
            if sermon_id:
                s = db.get(Sermon, sermon_id)
                if s is None:
                    raise JobCancelled()
                if stage:
                    s.stage = stage
                if progress is not None:
                    s.progress = int(progress)
            db.commit()


def claim_job() -> str | None:
    with SessionLocal() as db:
        # render jobs first so users see clips sooner; then oldest first
        job = db.scalar(select(ProcessingJob).where(ProcessingJob.status == "queued")
                        .order_by((ProcessingJob.kind != "render_clip"), ProcessingJob.created_at).limit(1))
        if not job:
            return None
        res = db.execute(update(ProcessingJob).where(ProcessingJob.id == job.id, ProcessingJob.status == "queued")
                         .values(status="running", attempts=ProcessingJob.attempts + 1, started_at=utcnow(),
                                 heartbeat_at=utcnow(), error=None))
        db.commit()
        return job.id if res.rowcount == 1 else None


def recover_stale() -> None:
    with SessionLocal() as db:
        for job in db.scalars(select(ProcessingJob).where(ProcessingJob.status == "running")):
            if job.attempts >= job.max_attempts:
                _fail(db, job, "Worker stopped during processing too many times")
            else:
                job.status = "queued"
                log.info("Re-queued interrupted job %s (%s)", job.id, job.kind)
        db.commit()


def _public_msg(msg: str) -> str:
    """Hide server file paths from user-facing errors (keep only the file name)."""
    import re
    return re.sub(r"(?:[A-Za-z]:)?[\\/](?:[^\s\\/:'\"]+[\\/])+([^\s\\/:'\"]+)", r"\1", msg)


def _fail(db, job: ProcessingJob, msg: str):
    msg = _public_msg(msg)
    job.status, job.error, job.finished_at = "failed", msg[:2000], utcnow()
    if job.kind == "process_sermon":
        s = db.get(Sermon, job.ref_id)
        if s:
            s.status, s.error = "failed", msg[:2000]  # keep s.stage = the step that failed
            notify(db, s.org_id, "Processing failed", f"{s.title}: {msg[:200]}", f"/sermons/{s.id}", "error")
    elif job.kind == "render_clip":
        c = db.get(GeneratedClip, job.ref_id)
        if c:
            c.status, c.error = "failed", msg[:2000]
            _maybe_notify_sermon_done(db, c.sermon_id)


def run_job(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(ProcessingJob, job_id)
        kind, ref, payload, attempts, max_attempts = job.kind, job.ref_id, job.payload or {}, job.attempts, job.max_attempts
    runner = JobRunner(job_id)
    try:
        if kind == "process_sermon":
            process_sermon(ref, payload, runner)
        elif kind == "render_clip":
            render_clip(ref, runner)
        else:
            raise RuntimeError(f"Unknown job kind {kind}")
        with SessionLocal() as db:
            job = db.get(ProcessingJob, job_id)
            if job and job.status == "running":
                job.status, job.progress, job.finished_at = "done", 100, utcnow()
                db.commit()
    except JobCancelled:
        log.info("Job %s cancelled", job_id)
    except Exception as e:  # noqa: BLE001
        log.error("Job %s failed: %s\n%s", job_id, e, traceback.format_exc())
        msg = str(e) or e.__class__.__name__
        with SessionLocal() as db:
            job = db.get(ProcessingJob, job_id)
            if job is None:
                return
            permanent = isinstance(e, ValueError)  # bad input: retrying won't help
            if attempts < max_attempts and not permanent:
                job.status, job.error = "queued", f"Attempt {attempts} failed: {_public_msg(msg)[:500]} — retrying"
                db.commit()
                time.sleep(min(30, 5 * attempts))
            else:
                _fail(db, job, msg)
                db.commit()


# ---------------- sermon pipeline ----------------

def _sermon_and_original(sermon_id: str):
    with SessionLocal() as db:
        s = db.get(Sermon, sermon_id)
        if s is None:
            raise JobCancelled()
        a = db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == sermon_id, VideoAsset.kind == "original"))
        if not a or not Path(a.path).is_file():
            raise ValueError("Original video file is missing")
        return s, a.path


def process_sermon(sermon_id: str, payload: dict, r: JobRunner) -> None:
    s, src = _sermon_and_original(sermon_id)
    sdir = Path(s.storage_dir)
    from_stage = payload.get("from_stage")
    with SessionLocal() as db:
        db.execute(update(Sermon).where(Sermon.id == sermon_id).values(status="processing", error=None))
        db.commit()

    # 1. probe / validate
    r.update("probe", 1, sermon_id, force=True)
    info = media.probe(src)
    if not info["has_video"]:
        raise ValueError("The file has no video stream")
    if not info["has_audio"]:
        raise ValueError("The video has no audio track, so the sermon can't be transcribed")
    if info["duration"] < 30:
        raise ValueError("Video is shorter than 30 seconds")
    if info["duration"] > get_settings().max_duration_hours * 3600:
        raise ValueError(f"Video is longer than {get_settings().max_duration_hours:g} hours")
    duration = info["duration"]
    with SessionLocal() as db:
        x = db.get(Sermon, sermon_id)
        x.duration_s, x.width, x.height = duration, info["width"], info["height"]
        a = db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == sermon_id, VideoAsset.kind == "original"))
        a.meta = info
        db.commit()

    # 2. audio + thumbnail
    r.update("audio", 2, sermon_id, force=True)
    audio = sdir / "audio.wav"
    if not audio.exists():
        media.extract_audio(src, audio)
    thumb = sdir / "thumbnail.jpg"
    if not thumb.exists():
        try:
            media.thumbnail(src, thumb, min(duration * 0.1, 120), color_transfer=info.get("color_transfer"))
        except media.MediaError as e:
            log.warning("thumbnail failed: %s", e)
    with SessionLocal() as db:
        for kind, p in (("audio", audio), ("thumbnail", thumb)):
            if p.exists() and not db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == sermon_id, VideoAsset.kind == kind)):
                db.add(VideoAsset(org_id=s.org_id, sermon_id=sermon_id, kind=kind, path=str(p), size_bytes=p.stat().st_size))
        db.commit()

    # 3. transcription
    with SessionLocal() as db:
        if from_stage == "transcribe":
            db.execute(delete(TranscriptSegment).where(TranscriptSegment.sermon_id == sermon_id))
            db.execute(delete(Transcript).where(Transcript.sermon_id == sermon_id))
            db.commit()
        have = db.scalar(select(func.count(TranscriptSegment.id)).where(TranscriptSegment.sermon_id == sermon_id))
    if not have:
        r.update("transcribe", 6, sermon_id, force=True)
        ollama.unload_llm()  # give Whisper the GPU
        from .services.transcribe import transcribe
        lang = (s.settings or {}).get("language", "auto")
        result = transcribe(audio, duration, lang, lambda p: r.update("transcribe", 6 + p * 49, sermon_id))
        if not result["segments"]:
            raise ValueError("No speech was detected in the video")
        with SessionLocal() as db:
            text = " ".join(x["text"] for x in result["segments"])
            db.add(Transcript(sermon_id=sermon_id, language=result["language"], text=text, word_count=len(text.split())))
            db.add_all([TranscriptSegment(sermon_id=sermon_id, idx=i, start_s=x["start"], end_s=x["end"], text=x["text"],
                                          words=x["words"], avg_prob=x["avg_prob"], language=x["language"])
                        for i, x in enumerate(result["segments"])])
            x = db.get(Sermon, sermon_id)
            x.language = result["language"]
            record_usage(db, s.org_id, "processing_minutes", round(duration / 60, 2), sermon_id)
            db.commit()

    with SessionLocal() as db:
        segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.sermon_id == sermon_id)
                          .order_by(TranscriptSegment.idx)).all()
        seg_data = [(g.idx, g.start_s, g.end_s, g.text, g.words) for g in segs]

    # 4. index: Bible references + search chunks
    r.update("index", 56, sermon_id, force=True)
    _index(s.org_id, sermon_id, seg_data)

    # 5-8. analyse, validate, score, select
    r.update("analyse", 62, sermon_id, force=True)
    settings = s.settings or {}
    a_segs = [analysis.Seg(i, st, en, tx) for i, st, en, tx, _ in seg_data]
    cands, notes = analysis.find_moments(a_segs, settings, lambda p: r.update("analyse", 62 + p * 26, sermon_id))
    r.update("select", 89, sermon_id, force=True)
    words = flatten_words([{"words": w} for *_, w in seg_data])
    analysis.validate(cands, words, settings)
    analysis.score(cands, settings.get("modes") or ["all"])
    analysis.dedupe(cands)
    chosen = analysis.select(cands, analysis.target_count(duration, int(settings.get("max_clips") or 0)))
    try:
        summary = analysis.summarise(notes, s.speaker) if notes else {}
    except ollama.OllamaError as e:
        log.warning("summary failed: %s", e)
        summary = {}
    ollama.unload_llm()

    # 9. save + queue renders
    with SessionLocal() as db:
        sermon = db.get(Sermon, sermon_id)
        old_auto = db.scalars(select(GeneratedClip).where(GeneratedClip.sermon_id == sermon_id,
                                                          GeneratedClip.candidate_id.is_not(None))).all()
        for c in old_auto:
            media_safe_unlink(c.video_path)
            media_safe_unlink(c.thumb_path)
            db.delete(c)
        db.execute(delete(ClipCandidate).where(ClipCandidate.sermon_id == sermon_id))
        db.execute(delete(SermonTopic).where(SermonTopic.sermon_id == sermon_id))
        if summary.get("summary"):
            sermon.summary = summary["summary"]
        for t in (summary.get("topics") or [])[:8]:
            db.add(SermonTopic(sermon_id=sermon_id, name=t.get("name", "")[:200], description=t.get("description")))
        kit = None
        if settings.get("brand_kit_id"):
            kit = db.get(BrandKit, settings["brand_kit_id"])
        if kit is None:
            kit = db.scalar(select(BrandKit).where(BrandKit.org_id == s.org_id, BrandKit.is_default.is_(True),
                                                   BrandKit.auto_apply.is_(True)))
        template_id = settings.get("template_id") or (kit.default_template_id if kit else None) or DEFAULT_TEMPLATE_ID
        n_clips = 0
        for c in cands:
            cc = ClipCandidate(sermon_id=sermon_id, start_s=c.start, end_s=c.end, title=c.title, category=c.category,
                               hook=c.hook, reason=c.reason, transcript=c.transcript, scores=c.scores, score=c.score,
                               status=c.status, reject_reason=c.reject_reason,
                               extra={"caption": c.caption, "hashtags": c.hashtags, "breakdown": c.breakdown})
            db.add(cc)
            db.flush()
            if c in chosen:
                gc = GeneratedClip(
                    org_id=s.org_id, sermon_id=sermon_id, candidate_id=cc.id, title=c.title,
                    description=c.hook, caption=c.caption, hashtags=c.hashtags, category=c.category,
                    start_s=c.start, end_s=c.end, score=c.score, score_breakdown=c.breakdown, reason=c.reason,
                    transcript=c.transcript, aspect=settings.get("aspect", "9:16"), template_id=template_id,
                    brand_kit_id=kit.id if kit else None,
                    options={"captions": True, "logo": bool(kit and kit.logo_path),
                             "watermark": bool(kit and kit.watermark_text), "resolution": 1080,
                             "quality": settings.get("quality") or "standard"},
                    status="queued")
                db.add(gc)
                db.flush()
                enqueue(db, s.org_id, "render_clip", gc.id, {"sermon_id": sermon_id})
                n_clips += 1
        sermon.status, sermon.stage, sermon.progress = "ready", "rendering" if n_clips else "done", 100
        if n_clips:
            notify(db, s.org_id, "Sermon analysed", f"{sermon.title}: found {n_clips} clips, rendering now.",
                   f"/sermons/{sermon_id}", "info")
        else:
            notify(db, s.org_id, "No clips found", f"{sermon.title}: the AI didn't find clip-worthy moments with "
                   "these settings. Try other clip lengths or modes.", f"/sermons/{sermon_id}", "error")
        db.commit()

    # 10. browser-friendly preview of the full sermon (only when the original won't play in browsers)
    _make_preview(s.org_id, sermon_id, src, info, sdir)


def media_safe_unlink(p):
    from .files import safe_unlink
    safe_unlink(p)


def _index(org_id: str, sermon_id: str, seg_data) -> None:
    with SessionLocal() as db:
        db.execute(delete(BibleReference).where(BibleReference.sermon_id == sermon_id))
        seen = set()
        for k, (idx, st, en, tx, _) in enumerate(seg_data):
            nxt = seg_data[k + 1][3] if k + 1 < len(seg_data) else ""
            for ref in find_references(tx + " " + nxt):
                if ref.pos >= len(tx):
                    continue
                key = (ref.reference, int(st // 60))
                if key in seen:
                    continue
                seen.add(key)
                ctx_text = " ".join(x[3] for x in seg_data[max(0, k - 1):k + 2])
                db.add(BibleReference(sermon_id=sermon_id, reference=ref.reference, book=ref.book, chapter=ref.chapter,
                                      verse_start=ref.verse_start, verse_end=ref.verse_end, start_s=st,
                                      context=ctx_text[:600]))
        db.execute(delete(SearchChunk).where(SearchChunk.sermon_id == sermon_id))
        chunks, cur = [], []
        for item in seg_data:
            cur.append(item)
            if cur[-1][2] - cur[0][1] >= 25:
                chunks.append(cur)
                cur = cur[-1:] if len(cur) > 2 else []  # one segment overlap
        if cur:
            chunks.append(cur)
        texts = [" ".join(x[3] for x in c) for c in chunks]
        vecs = None
        try:
            vecs = ollama.embed(texts)
        except ollama.OllamaError as e:
            log.warning("Embeddings unavailable, search will be keyword-only for this sermon: %s", e)
        for i, c in enumerate(chunks):
            db.add(SearchChunk(org_id=org_id, sermon_id=sermon_id, start_s=c[0][1], end_s=c[-1][2], text=texts[i],
                               embedding=vecs[i].tobytes() if vecs is not None else None))
        db.commit()


def _make_preview(org_id, sermon_id, src, info, sdir: Path) -> None:
    ok_codec = (info.get("video_codec") == "h264" and info.get("audio_codec") in ("aac", "mp3", None)
                and not info.get("hdr") and info.get("pix_fmt") in (None, "yuv420p", "yuvj420p"))
    ok_container = Path(src).suffix.lower() in (".mp4", ".m4v", ".mov")
    if ok_codec and ok_container:
        return
    out = sdir / "preview.mp4"
    with SessionLocal() as db:
        if db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == sermon_id, VideoAsset.kind == "preview")):
            return
    s = get_settings()
    enc = media.video_encoder()
    tmp = sdir / "preview.tmp.mp4"
    try:
        vf = "scale=-2:720"
        if info.get("hdr"):
            vf = media.tonemap_filter(info.get("color_transfer")) + "," + vf
        media.run([s.ffmpeg, "-y", "-v", "error", "-i", str(src), "-vf", vf, *media.encoder_args(enc),
                   "-pix_fmt", "yuv420p", *media.SDR_TAGS, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                   str(tmp)])
        tmp.replace(out)
        with SessionLocal() as db:
            db.add(VideoAsset(org_id=org_id, sermon_id=sermon_id, kind="preview", path=str(out), size_bytes=out.stat().st_size))
            db.commit()
    except media.MediaError as e:
        log.warning("Preview transcode failed (sermon still usable): %s", e)


# ---------------- clip rendering ----------------

def render_clip(clip_id: str, r: JobRunner) -> None:
    with SessionLocal() as db:
        c = db.get(GeneratedClip, clip_id)
        if c is None:
            raise JobCancelled()
        s = db.get(Sermon, c.sermon_id)
        src = db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == s.id, VideoAsset.kind == "original"))
        if not src or not Path(src.path).is_file():
            raise ValueError("Original sermon video is missing")
        c.status, c.error = "rendering", None
        db.commit()
        opts = dict(c.options or {})
        tpl = db.get(ClipTemplate, c.template_id or DEFAULT_TEMPLATE_ID) or db.get(ClipTemplate, DEFAULT_TEMPLATE_ID)
        style = dict(tpl.style if tpl else {})
        kit = db.get(BrandKit, c.brand_kit_id) if c.brand_kit_id else None
        if kit and kit.font and not opts.get("font"):
            style["font"] = kit.font
        for k in ("font", "font_size", "primary_color", "highlight_color", "bg_box", "uppercase"):
            if opts.get(k) is not None:
                style[k] = opts[k]
        if opts.get("caption_position"):
            style["position"] = opts["caption_position"]
        cap = db.scalar(select(ClipCaption).where(ClipCaption.clip_id == c.id))
        if cap and cap.words:
            words = cap.words
        else:
            segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.sermon_id == s.id,
                                                              TranscriptSegment.end_s >= c.start_s - 1,
                                                              TranscriptSegment.start_s <= c.end_s + 1)
                              .order_by(TranscriptSegment.idx)).all()
            words = [[round(w.start - c.start_s, 3), round(w.end - c.start_s, 3), w.text]
                     for w in flatten_words(segs) if w.start >= c.start_s - 0.05 and w.end <= c.end_s + 0.3]
        start, end, aspect, version = c.start_s, c.end_s, c.aspect, c.render_version + 1
        meta = src.meta or {}
        if "color_transfer" not in meta:  # sermons processed before HDR support: probe once and remember
            try:
                meta = {**meta, **media.probe(src.path)}
                src.meta = meta
                db.commit()
            except media.MediaError as e:
                log.warning("re-probe failed: %s", e)
        src_w, src_h = meta.get("width") or s.width, meta.get("height") or s.height
        quality = opts.get("quality") or (s.settings or {}).get("quality") or "standard"
        color_transfer = meta.get("color_transfer")
        logo = kit.logo_path if (kit and opts.get("logo", True)) else None
        logo_pos = kit.logo_position if kit else "top-right"
        watermark = kit.watermark_text if (kit and opts.get("watermark")) else None
        old_video, old_thumb = c.video_path, c.thumb_path
        org_id, sermon_id, sdir = c.org_id, s.id, Path(s.storage_dir)

    work = sdir / "clips" / f"work_{clip_id}"
    work.mkdir(parents=True, exist_ok=True)
    r.update("framing", 5, force=True)
    track = None
    if opts.get("crop_x") is None and aspect != _src_aspect(src_w, src_h):
        cache = work / f"track_{start:.2f}_{end:.2f}.json"
        if cache.exists():
            track = [tuple(x) for x in json.loads(cache.read_text())]
        else:
            track = detect_track(src.path, start, end)
            cache.write_text(json.dumps(track))
    out = sdir / "clips" / f"{clip_id}_v{version}.mp4"
    spec = RenderSpec(src=src.path, out=str(out), start=start, end=end, src_w=src_w, src_h=src_h, aspect=aspect,
                      resolution=int(opts.get("resolution") or 1080), track=track, crop_x=opts.get("crop_x"),
                      words=words, style=style, show_captions=opts.get("captions", True), logo_path=logo,
                      logo_position=logo_pos, watermark=watermark, quality=quality,
                      color_transfer=color_transfer)
    r.update("rendering", 10, force=True)
    render(spec, work, lambda p: r.update("rendering", 10 + p * 85))
    thumb = sdir / "clips" / f"{clip_id}_v{version}.jpg"
    clip_thumbnail(str(out), str(thumb), min(1.0, (end - start) / 2))
    with SessionLocal() as db:
        c = db.get(GeneratedClip, clip_id)
        if c is None:  # deleted while rendering
            media_safe_unlink(out)
            media_safe_unlink(thumb)
            raise JobCancelled()
        c.video_path, c.thumb_path, c.render_version, c.status, c.error = str(out), str(thumb), version, "ready", None
        record_usage(db, org_id, "clip_render", 1, clip_id)
        _maybe_notify_sermon_done(db, sermon_id)
        db.commit()
    for p in (old_video, old_thumb):
        if p and p not in (str(out), str(thumb)):
            media_safe_unlink(p)
    for f in work.glob("*"):
        if not f.name.startswith("track_"):
            media_safe_unlink(f)


def _src_aspect(w, h) -> str:
    if not w or not h:
        return "16:9"
    r = w / h
    return "9:16" if abs(r - 9 / 16) < 0.02 else "1:1" if abs(r - 1) < 0.02 else "16:9" if abs(r - 16 / 9) < 0.02 else "other"


def _maybe_notify_sermon_done(db, sermon_id: str) -> None:
    db.flush()
    pending = db.scalar(select(func.count(GeneratedClip.id)).where(
        GeneratedClip.sermon_id == sermon_id, GeneratedClip.status.in_(("queued", "rendering"))))
    s = db.get(Sermon, sermon_id)
    if pending == 0 and s and s.stage == "rendering":
        ready = db.scalar(select(func.count(GeneratedClip.id)).where(GeneratedClip.sermon_id == sermon_id,
                                                                    GeneratedClip.status == "ready"))
        s.stage = "done"
        notify(db, s.org_id, "Clips ready", f"{s.title}: {ready} clips are ready to preview and download.",
               f"/sermons/{sermon_id}", "success")


# ---------------- main loop ----------------

def _heartbeat_loop():
    f = get_settings().data_dir / "db" / "worker.heartbeat"
    while not STOP.is_set():
        try:
            f.write_text(datetime.utcnow().isoformat())
        except OSError:
            pass
        STOP.wait(10)


def _cleanup_old_uploads():
    """Remove abandoned partial uploads older than 2 days."""
    from .models import Upload
    with SessionLocal() as db:
        cutoff = utcnow() - timedelta(days=2)
        for up in db.scalars(select(Upload).where(Upload.status == "uploading", Upload.updated_at < cutoff)):
            media_safe_unlink(up.path)
            up.status = "aborted"
        db.commit()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    migrate()
    recover_stale()
    _cleanup_old_uploads()
    if not shutil.which(get_settings().ffmpeg):
        log.error("ffmpeg not found on PATH")
    log.info("Worker started. Encoder: %s. Ollama: %s", media.video_encoder(), ollama.health())
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    while not STOP.is_set():
        job_id = claim_job()
        if job_id:
            log.info("Running job %s", job_id)
            run_job(job_id)
        else:
            STOP.wait(2)
    log.info("Worker stopped")


if __name__ == "__main__":
    main()
