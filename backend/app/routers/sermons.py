import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..files import file_response, safe_unlink
from ..jobs import enqueue
from ..models import (
    BibleReference,
    ClipCandidate,
    Folder,
    GeneratedClip,
    ProcessingJob,
    Sermon,
    SermonTopic,
    Transcript,
    TranscriptSegment,
    Upload,
    VideoAsset,
)
from ..security import Ctx, audit, current_ctx
from ..serializers import folder_out, sermon_out

router = APIRouter(tags=["sermons"])

ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".wmv", ".mpg", ".mpeg", ".3gp"}
MODES = ("viral", "teaching", "inspirational", "all")


class SermonSettings(BaseModel):
    modes: list[Literal["viral", "teaching", "inspirational", "all"]] = ["all"]
    clip_lengths: list[int] = Field(default_factory=lambda: [30, 60])  # target durations (s)
    min_s: int | None = Field(default=None, ge=5, le=600)  # custom range overrides clip_lengths
    max_s: int | None = Field(default=None, ge=5, le=600)
    max_clips: int = Field(default=0, ge=0, le=30)  # 0 = automatic
    aspect: Literal["9:16", "1:1", "16:9"] = "9:16"
    template_id: str | None = None
    brand_kit_id: str | None = None
    language: Literal["auto", "en", "sw"] = "auto"
    quality: Literal["standard", "high", "max"] = "standard"  # export quality for this sermon's clips


class UploadInit(BaseModel):
    filename: str = Field(min_length=1, max_length=500)
    size: int = Field(gt=0)


class UploadComplete(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    speaker: str | None = Field(default=None, max_length=200)
    folder_id: str | None = None
    settings: SermonSettings = SermonSettings()
    rights_confirmed: bool = False


class SermonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    speaker: str | None = Field(default=None, max_length=200)
    folder_id: str | None = None
    move_folder: bool = False  # set true to apply folder_id (allows moving to "no folder")


class ReprocessIn(BaseModel):
    settings: SermonSettings | None = None
    from_stage: Literal["analyse", "transcribe"] = "analyse"


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


def get_sermon(db: Session, ctx: Ctx, sermon_id: str) -> Sermon:
    s = db.get(Sermon, sermon_id)
    if not s or s.org_id != ctx.org_id:
        raise HTTPException(404, "Sermon not found")
    return s


def _check_folder(db: Session, ctx: Ctx, folder_id: str | None):
    if folder_id:
        f = db.get(Folder, folder_id)
        if not f or f.org_id != ctx.org_id:
            raise HTTPException(404, "Folder not found")


# ---------- uploads (resumable, chunked) ----------

@router.post("/uploads")
def upload_init(body: UploadInit, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_settings()
    ext = Path(body.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type {ext or '(none)'}. Use MP4, MOV, MKV, WEBM, AVI…")
    if body.size > s.max_upload_gb * 1024**3:
        raise HTTPException(413, f"File is larger than the {s.max_upload_gb:g} GB limit")
    free = shutil.disk_usage(s.media_dir).free
    if body.size * 1.5 > free:
        raise HTTPException(507, "Not enough free disk space on the storage drive")
    up = Upload(org_id=ctx.org_id, user_id=ctx.user.id, filename=body.filename, size_bytes=body.size, path="")
    db.add(up)
    db.flush()
    up.path = str(s.media_dir / "_uploads" / f"{up.id}{ext}")
    Path(up.path).touch()
    db.commit()
    return {"id": up.id, "chunk_size": s.upload_chunk_mb * 1024 * 1024, "received_bytes": 0}


@router.get("/uploads/{upload_id}")
def upload_status(upload_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up or up.org_id != ctx.org_id:
        raise HTTPException(404, "Upload not found")
    return {"id": up.id, "received_bytes": up.received_bytes, "size": up.size_bytes, "status": up.status}


@router.put("/uploads/{upload_id}")
async def upload_chunk(upload_id: str, offset: int, request: Request, ctx: Ctx = Depends(current_ctx),
                       db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up or up.org_id != ctx.org_id:
        raise HTTPException(404, "Upload not found")
    if up.status != "uploading":
        raise HTTPException(409, "Upload already finished")
    if offset != up.received_bytes:
        raise HTTPException(409, detail={"message": "Offset mismatch", "received_bytes": up.received_bytes})
    max_chunk = get_settings().upload_chunk_mb * 1024 * 1024 + 1024
    written = 0
    with open(up.path, "r+b") as f:
        f.seek(offset)
        f.truncate()
        async for data in request.stream():
            written += len(data)
            if written > max_chunk or offset + written > up.size_bytes:
                f.truncate(offset)
                raise HTTPException(413, "Chunk too large")
            f.write(data)
    up.received_bytes = offset + written
    db.commit()
    return {"received_bytes": up.received_bytes}


@router.post("/uploads/{upload_id}/complete")
def upload_complete(upload_id: str, body: UploadComplete, ctx: Ctx = Depends(current_ctx),
                    db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up or up.org_id != ctx.org_id:
        raise HTTPException(404, "Upload not found")
    if not body.rights_confirmed:
        raise HTTPException(400, "Please confirm you have the rights to upload and process this video")
    if up.status != "uploading" or up.received_bytes != up.size_bytes:
        raise HTTPException(409, f"Upload incomplete ({up.received_bytes}/{up.size_bytes} bytes)")
    _check_folder(db, ctx, body.folder_id)
    sermon = Sermon(org_id=ctx.org_id, folder_id=body.folder_id, created_by=ctx.user.id, title=body.title.strip(),
                    speaker=body.speaker, status="queued", stage="queued", settings=body.settings.model_dump(),
                    source_filename=up.filename, size_bytes=up.size_bytes)
    db.add(sermon)
    db.flush()
    sdir = get_settings().media_dir / ctx.org_id / sermon.id
    sdir.mkdir(parents=True, exist_ok=True)
    dest = sdir / f"original{Path(up.path).suffix}"
    shutil.move(up.path, dest)
    sermon.storage_dir = str(sdir)
    up.status, up.path = "complete", str(dest)
    db.add(VideoAsset(org_id=ctx.org_id, sermon_id=sermon.id, kind="original", path=str(dest), size_bytes=up.size_bytes))
    enqueue(db, ctx.org_id, "process_sermon", sermon.id)
    audit(db, ctx, "sermon.upload", sermon.id, filename=up.filename, size=up.size_bytes)
    db.commit()
    return sermon_out(sermon, 0)


@router.delete("/uploads/{upload_id}")
def upload_abort(upload_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up or up.org_id != ctx.org_id:
        raise HTTPException(404, "Upload not found")
    if up.status == "uploading":
        safe_unlink(up.path)
        up.status = "aborted"
        db.commit()
    return {"ok": True}


# ---------- sermons ----------

def _clip_counts(db: Session, org_id: str) -> dict[str, int]:
    rows = db.execute(select(GeneratedClip.sermon_id, func.count(GeneratedClip.id))
                      .where(GeneratedClip.org_id == org_id).group_by(GeneratedClip.sermon_id)).all()
    return dict(rows)


@router.get("/sermons")
def list_sermons(folder_id: str | None = None, q: str | None = None, status: str | None = None,
                 ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    stmt = select(Sermon).where(Sermon.org_id == ctx.org_id)
    if folder_id == "none":
        stmt = stmt.where(Sermon.folder_id.is_(None))
    elif folder_id:
        stmt = stmt.where(Sermon.folder_id == folder_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Sermon.title.ilike(like) | Sermon.speaker.ilike(like))
    if status:
        stmt = stmt.where(Sermon.status == status)
    counts = _clip_counts(db, ctx.org_id)
    return [sermon_out(s, counts.get(s.id, 0)) for s in db.scalars(stmt.order_by(Sermon.created_at.desc()))]


@router.get("/sermons/{sermon_id}")
def sermon_detail(sermon_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    topics = db.scalars(select(SermonTopic).where(SermonTopic.sermon_id == s.id)).all()
    refs = db.scalars(select(BibleReference).where(BibleReference.sermon_id == s.id).order_by(BibleReference.start_s)).all()
    job = db.scalar(select(ProcessingJob).where(ProcessingJob.ref_id == s.id, ProcessingJob.kind == "process_sermon")
                    .order_by(ProcessingJob.created_at.desc()).limit(1))
    rendering = db.scalar(select(func.count(GeneratedClip.id)).where(
        GeneratedClip.sermon_id == s.id, GeneratedClip.status.in_(("queued", "rendering"))))
    out = sermon_out(s, _clip_counts(db, ctx.org_id).get(s.id, 0))
    out.update({
        "topics": [{"name": t.name, "description": t.description} for t in topics],
        "bible_references": [{"reference": r.reference, "start_s": r.start_s, "context": r.context} for r in refs],
        "job": {"status": job.status, "stage": job.stage, "progress": job.progress, "attempts": job.attempts,
                "error": job.error} if job else None,
        "clips_rendering": rendering,
    })
    return out


@router.patch("/sermons/{sermon_id}")
def update_sermon(sermon_id: str, body: SermonUpdate, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    if body.title is not None:
        s.title = body.title.strip()
    if body.speaker is not None:
        s.speaker = body.speaker
    if body.move_folder:
        _check_folder(db, ctx, body.folder_id)
        s.folder_id = body.folder_id
    db.commit()
    return sermon_out(s, _clip_counts(db, ctx.org_id).get(s.id, 0))


@router.delete("/sermons/{sermon_id}")
def delete_sermon(sermon_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    for j in db.scalars(select(ProcessingJob).where(ProcessingJob.status.in_(("queued", "running")))):
        if j.ref_id == s.id or (j.kind == "render_clip" and j.payload.get("sermon_id") == s.id):
            j.status, j.error = "failed", "Sermon deleted"
    sdir = s.storage_dir
    audit(db, ctx, "sermon.delete", s.id, title=s.title)
    db.delete(s)
    db.commit()
    media_root = get_settings().media_dir.resolve()
    if sdir and Path(sdir).resolve().is_relative_to(media_root):
        shutil.rmtree(sdir, ignore_errors=True)
    return {"ok": True}


@router.post("/sermons/{sermon_id}/reprocess")
def reprocess(sermon_id: str, body: ReprocessIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    if s.status in ("queued", "processing"):
        raise HTTPException(409, "Sermon is already processing")
    if body.settings:
        s.settings = body.settings.model_dump()
    s.status, s.progress, s.stage, s.error = "queued", 0, "queued", None
    enqueue(db, ctx.org_id, "process_sermon", s.id, {"from_stage": body.from_stage})
    audit(db, ctx, "sermon.reprocess", s.id, from_stage=body.from_stage)
    db.commit()
    return sermon_out(s)


@router.get("/sermons/{sermon_id}/transcript")
def transcript(sermon_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    t = db.scalar(select(Transcript).where(Transcript.sermon_id == s.id))
    segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.sermon_id == s.id).order_by(TranscriptSegment.idx))
    return {"language": t.language if t else None, "word_count": t.word_count if t else 0,
            "segments": [{"idx": g.idx, "start_s": g.start_s, "end_s": g.end_s, "text": g.text} for g in segs]}


@router.get("/sermons/{sermon_id}/candidates")
def candidates(sermon_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    rows = db.scalars(select(ClipCandidate).where(ClipCandidate.sermon_id == s.id).order_by(ClipCandidate.score.desc()))
    clips = db.execute(select(GeneratedClip.id, GeneratedClip.candidate_id, GeneratedClip.start_s, GeneratedClip.end_s)
                       .where(GeneratedClip.sermon_id == s.id)).all()

    def clip_for(c):
        for cid, cand_id, st, en in clips:
            if cand_id == c.id or (abs(st - c.start_s) < 1.5 and abs(en - c.end_s) < 1.5):
                return cid
        return None

    return [{"id": c.id, "start_s": c.start_s, "end_s": c.end_s, "title": c.title, "category": c.category,
             "hook": c.hook, "reason": c.reason, "score": round(c.score), "status": c.status,
             "reject_reason": c.reject_reason, "transcript": c.transcript, "clip_id": clip_for(c)} for c in rows]


def _asset(db: Session, sermon_id: str, kind: str) -> VideoAsset | None:
    return db.scalar(select(VideoAsset).where(VideoAsset.sermon_id == sermon_id, VideoAsset.kind == kind))


@router.get("/sermons/{sermon_id}/video")
def sermon_video(sermon_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    preview = _asset(db, s.id, "preview")
    a = preview or _asset(db, s.id, "original")
    return file_response(request, a.path if a else None)


@router.get("/sermons/{sermon_id}/thumbnail")
def sermon_thumb(sermon_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    s = get_sermon(db, ctx, sermon_id)
    a = _asset(db, s.id, "thumbnail")
    return file_response(request, a.path if a else None)


# ---------- folders ----------

@router.get("/folders")
def list_folders(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Sermon.folder_id, func.count(Sermon.id)).where(Sermon.org_id == ctx.org_id)
                             .group_by(Sermon.folder_id)).all())
    return [folder_out(f, counts.get(f.id, 0))
            for f in db.scalars(select(Folder).where(Folder.org_id == ctx.org_id).order_by(Folder.name))]


@router.post("/folders")
def create_folder(body: FolderIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    f = Folder(org_id=ctx.org_id, name=body.name.strip())
    db.add(f)
    db.commit()
    return folder_out(f)


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: str, body: FolderIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    f = db.get(Folder, folder_id)
    if not f or f.org_id != ctx.org_id:
        raise HTTPException(404, "Folder not found")
    f.name = body.name.strip()
    db.commit()
    return folder_out(f)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    f = db.get(Folder, folder_id)
    if not f or f.org_id != ctx.org_id:
        raise HTTPException(404, "Folder not found")
    db.delete(f)  # sermons keep existing, folder_id set NULL
    db.commit()
    return {"ok": True}
