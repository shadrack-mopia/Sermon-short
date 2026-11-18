import re
import tempfile
import zipfile
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..files import file_response, safe_unlink
from ..jobs import enqueue, record_usage
from ..models import BrandKit, ClipCaption, ClipTemplate, GeneratedClip, ProcessingJob, Sermon, TranscriptSegment
from ..pipeline.boundaries import flatten_words, snap_range, text_between
from ..security import Ctx, audit, current_ctx
from ..serializers import clip_out
from .sermons import get_sermon

router = APIRouter(tags=["clips"])

RENDER_FIELDS = {"start_s", "end_s", "aspect", "template_id", "brand_kit_id", "options"}


class ClipOptions(BaseModel):
    captions: bool = True
    logo: bool = True
    watermark: bool = False
    caption_position: Literal["top", "middle", "lower", "bottom"] | None = None
    font_size: int | None = Field(default=None, ge=24, le=160)
    font: str | None = Field(default=None, max_length=100)
    primary_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    highlight_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    bg_box: bool | None = None
    uppercase: bool | None = None
    crop_x: float | None = Field(default=None, ge=0, le=1)  # manual framing override
    resolution: Literal[720, 1080] = 1080
    quality: Literal["standard", "high", "max"] = "standard"  # encoder quality (file size grows with quality)


class ClipUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = None
    caption: str | None = None
    hashtags: list[str] | None = None
    start_s: float | None = Field(default=None, ge=0)
    end_s: float | None = Field(default=None, gt=0)
    aspect: Literal["9:16", "1:1", "16:9"] | None = None
    template_id: str | None = None
    brand_kit_id: str | None = None
    clear_brand_kit: bool = False
    options: ClipOptions | None = None
    snap: bool = True  # snap edited times to sentence boundaries


class ClipCreate(BaseModel):
    sermon_id: str
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    title: str = Field(default="New clip", max_length=300)
    aspect: Literal["9:16", "1:1", "16:9"] = "9:16"
    snap: bool = True


class CaptionsIn(BaseModel):
    words: list[tuple[float, float, str]]


def get_clip(db: Session, ctx: Ctx, clip_id: str) -> GeneratedClip:
    c = db.get(GeneratedClip, clip_id)
    if not c or c.org_id != ctx.org_id:
        raise HTTPException(404, "Clip not found")
    return c


def _words(db: Session, sermon_id: str):
    segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.sermon_id == sermon_id)
                      .order_by(TranscriptSegment.idx)).all()
    return flatten_words(segs)


def _validate_range(s: Sermon, start: float, end: float):
    if end <= start:
        raise HTTPException(400, "End must be after start")
    if end - start < 3:
        raise HTTPException(400, "Clip must be at least 3 seconds")
    if end - start > 600:
        raise HTTPException(400, "Clip must be at most 10 minutes")
    if s.duration_s and end > s.duration_s + 0.5:
        raise HTTPException(400, "End is beyond the end of the sermon")


def _queue_render(db: Session, c: GeneratedClip):
    c.status, c.error = "queued", None
    enqueue(db, c.org_id, "render_clip", c.id, {"sermon_id": c.sermon_id})


@router.get("/clips")
def list_clips(sermon_id: str | None = None, category: str | None = None, status: str | None = None,
               sort: Literal["score", "duration", "newest", "category", "topic"] = "score",
               ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    stmt = (select(GeneratedClip, Sermon.title).join(Sermon, Sermon.id == GeneratedClip.sermon_id)
            .where(GeneratedClip.org_id == ctx.org_id))
    if sermon_id:
        stmt = stmt.where(GeneratedClip.sermon_id == sermon_id)
    if category:
        stmt = stmt.where(GeneratedClip.category == category)
    if status:
        stmt = stmt.where(GeneratedClip.status == status)
    order = {
        "score": GeneratedClip.score.desc(),
        "duration": (GeneratedClip.end_s - GeneratedClip.start_s).asc(),
        "newest": GeneratedClip.created_at.desc(),
        "category": GeneratedClip.category.asc(),
        "topic": GeneratedClip.title.asc(),
    }[sort]
    return [clip_out(c, t) for c, t in db.execute(stmt.order_by(order)).all()]


@router.get("/clips/download-zip")
def download_zip(sermon_id: str | None = None, ids: str | None = None, ctx: Ctx = Depends(current_ctx),
                 db: Session = Depends(get_db)):
    stmt = select(GeneratedClip).where(GeneratedClip.org_id == ctx.org_id, GeneratedClip.status == "ready")
    if sermon_id:
        stmt = stmt.where(GeneratedClip.sermon_id == sermon_id)
    if ids:
        stmt = stmt.where(GeneratedClip.id.in_(ids.split(",")))
    clips = [c for c in db.scalars(stmt.order_by(GeneratedClip.score.desc())) if c.video_path]
    if not clips:
        raise HTTPException(404, "No finished clips to download")
    # spill to disk past 64 MB; mp4s are already compressed so store them as-is
    buf = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        captions = []
        for n, c in enumerate(clips, 1):
            name = f"{n:02d}_{_slug(c.title)}.mp4"
            z.write(c.video_path, name)
            captions.append(f"{name}\n{c.title}\n{c.caption or ''}\n{' '.join(c.hashtags or [])}\n")
            c.downloads += 1
            record_usage(db, ctx.org_id, "download", 1, c.id)
        z.writestr("captions.txt", "\n".join(captions))
    db.commit()
    size = buf.tell()
    buf.seek(0)

    def chunks():
        try:
            while data := buf.read(1024 * 1024):  # 1 MB blocks (iterating the file would split on newlines)
                yield data
        finally:
            buf.close()

    return StreamingResponse(chunks(), media_type="application/zip",
                             headers={"Content-Disposition": 'attachment; filename="sermon_clips.zip"',
                                      "Content-Length": str(size)})


@router.get("/clips/{clip_id}")
def clip_detail(clip_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    s = db.get(Sermon, c.sermon_id)
    out = clip_out(c, s.title)
    out["sermon_duration_s"] = s.duration_s
    out["sermon_video_url"] = f"/api/sermons/{s.id}/video"
    return out


@router.post("/clips")
def create_clip(body: ClipCreate, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, body.sermon_id)
    if s.status != "ready":
        raise HTTPException(409, "Sermon has not finished processing")
    words = _words(db, s.id)
    start, end = snap_range(words, body.start_s, body.end_s) if body.snap else (body.start_s, body.end_s)
    _validate_range(s, start, end)
    kit = db.scalar(select(BrandKit).where(BrandKit.org_id == ctx.org_id, BrandKit.is_default.is_(True)))
    c = GeneratedClip(org_id=ctx.org_id, sermon_id=s.id, title=body.title, start_s=start, end_s=end,
                      aspect=body.aspect, transcript=text_between(words, start, end), category="custom",
                      template_id=(s.settings or {}).get("template_id"),
                      brand_kit_id=kit.id if kit and kit.auto_apply else None,
                      options=ClipOptions(quality=(s.settings or {}).get("quality") or "standard").model_dump())
    db.add(c)
    db.flush()
    _queue_render(db, c)
    audit(db, ctx, "clip.create", c.id)
    db.commit()
    return clip_out(c, s.title)


@router.patch("/clips/{clip_id}")
def update_clip(clip_id: str, body: ClipUpdate, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    s = db.get(Sermon, c.sermon_id)
    data = body.model_dump(exclude_unset=True)
    rerender = False

    for k in ("title", "description", "caption", "hashtags"):
        if k in data:
            setattr(c, k, data[k])

    if "start_s" in data or "end_s" in data:
        start = data.get("start_s", c.start_s)
        end = data.get("end_s", c.end_s)
        words = _words(db, s.id)
        if body.snap:
            start, end = snap_range(words, start, end)
        _validate_range(s, start, end)
        if (start, end) != (c.start_s, c.end_s):
            c.start_s, c.end_s = start, end
            c.transcript = text_between(words, start, end)
            cap = db.scalar(select(ClipCaption).where(ClipCaption.clip_id == c.id))
            if cap:
                db.delete(cap)  # timings changed: rebuild captions from transcript
            rerender = True
    if "aspect" in data and data["aspect"] != c.aspect:
        c.aspect, rerender = data["aspect"], True
    if "template_id" in data and data["template_id"] != c.template_id:
        t = db.get(ClipTemplate, data["template_id"]) if data["template_id"] else None
        if data["template_id"] and (not t or t.org_id not in (None, ctx.org_id)):
            raise HTTPException(404, "Template not found")
        c.template_id, rerender = data["template_id"], True
    if body.clear_brand_kit:
        c.brand_kit_id, rerender = None, True
    elif "brand_kit_id" in data and data["brand_kit_id"] != c.brand_kit_id:
        k = db.get(BrandKit, data["brand_kit_id"]) if data["brand_kit_id"] else None
        if data["brand_kit_id"] and (not k or k.org_id != ctx.org_id):
            raise HTTPException(404, "Brand kit not found")
        c.brand_kit_id, rerender = data["brand_kit_id"], True
    if body.options is not None:
        new = body.options.model_dump()
        if new != (c.options or {}):
            c.options, rerender = new, True

    if rerender:
        _queue_render(db, c)
    audit(db, ctx, "clip.update", c.id, rerender=rerender)
    db.commit()
    return clip_out(c, s.title)


@router.post("/clips/{clip_id}/render")
def rerender(clip_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    _queue_render(db, c)
    db.commit()
    return clip_out(c, db.get(Sermon, c.sermon_id).title)


class BulkDeleteIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


def _remove_clip(db: Session, ctx: Ctx, c: GeneratedClip) -> None:
    """Delete a clip's files, cancel its pending render job, and remove the row."""
    for j in db.scalars(select(ProcessingJob).where(ProcessingJob.kind == "render_clip", ProcessingJob.ref_id == c.id,
                                                    ProcessingJob.status == "queued")):
        j.status, j.error = "failed", "Clip deleted"
    # a render already running notices the clip is gone and discards its output (see worker.render_clip)
    safe_unlink(c.video_path)
    safe_unlink(c.thumb_path)
    audit(db, ctx, "clip.delete", c.id, title=c.title)
    db.delete(c)


@router.post("/clips/bulk-delete")
def bulk_delete(body: BulkDeleteIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(body.ids))
    clips = db.scalars(select(GeneratedClip).where(GeneratedClip.org_id == ctx.org_id,
                                                   GeneratedClip.id.in_(ids))).all()
    for c in clips:
        _remove_clip(db, ctx, c)
    db.commit()
    # ids from other organisations are silently skipped (never revealed or deleted)
    return {"deleted": len(clips), "not_found": len(ids) - len(clips)}


@router.delete("/clips/{clip_id}")
def delete_clip(clip_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    _remove_clip(db, ctx, get_clip(db, ctx, clip_id))
    db.commit()
    return {"ok": True}


@router.get("/clips/{clip_id}/captions")
def get_captions(clip_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    cap = db.scalar(select(ClipCaption).where(ClipCaption.clip_id == c.id))
    if cap:
        return {"words": cap.words, "edited": cap.edited}
    words = [w for w in _words(db, c.sermon_id) if w.start >= c.start_s - 0.05 and w.end <= c.end_s + 0.3]
    return {"words": [[round(w.start - c.start_s, 3), round(w.end - c.start_s, 3), w.text] for w in words],
            "edited": False}


@router.put("/clips/{clip_id}/captions")
def put_captions(clip_id: str, body: CaptionsIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    dur = c.end_s - c.start_s
    words = []
    for st, en, txt in body.words:
        txt = txt.strip()
        if not txt:
            continue
        st, en = max(0.0, st), min(dur, en)
        if en <= st:
            en = min(dur, st + 0.2)
        words.append([round(st, 3), round(en, 3), txt[:60]])
    words.sort(key=lambda w: w[0])
    cap = db.scalar(select(ClipCaption).where(ClipCaption.clip_id == c.id))
    if cap:
        cap.words, cap.edited = words, True
    else:
        db.add(ClipCaption(clip_id=c.id, words=words, edited=True))
    c.transcript = " ".join(w[2] for w in words)
    _queue_render(db, c)
    db.commit()
    return {"words": words, "edited": True}


@router.get("/clips/{clip_id}/video")
def clip_video(clip_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return file_response(request, get_clip(db, ctx, clip_id).video_path, media_type="video/mp4")


@router.get("/clips/{clip_id}/thumbnail")
def clip_thumb(clip_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return file_response(request, get_clip(db, ctx, clip_id).thumb_path)


@router.get("/clips/{clip_id}/download")
def clip_download(clip_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    c = get_clip(db, ctx, clip_id)
    if not c.video_path:
        raise HTTPException(409, "Clip is not rendered yet")
    if "range" not in request.headers:
        c.downloads += 1
        record_usage(db, ctx.org_id, "download", 1, c.id)
        db.commit()
    return file_response(request, c.video_path, download_name=f"{_slug(c.title)}.mp4", media_type="video/mp4")


def _slug(s: str) -> str:
    return re.sub(r"[^\w]+", "_", s or "clip").strip("_")[:60] or "clip"
