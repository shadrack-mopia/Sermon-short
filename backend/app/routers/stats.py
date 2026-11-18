import shutil
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import GeneratedClip, Notification, ProcessingJob, Sermon, UsageRecord, VideoAsset
from ..security import Ctx, current_ctx
from ..serializers import job_out, notification_out, sermon_out
from ..services import ollama

router = APIRouter(tags=["stats"])


def _usage(db, org_id, kind, since=None):
    stmt = select(func.coalesce(func.sum(UsageRecord.amount), 0)).where(UsageRecord.org_id == org_id, UsageRecord.kind == kind)
    if since:
        stmt = stmt.where(UsageRecord.created_at >= since)
    return float(db.scalar(stmt))


@router.get("/stats")
def stats(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    org = ctx.org_id
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    storage = db.scalar(select(func.coalesce(func.sum(VideoAsset.size_bytes), 0)).where(VideoAsset.org_id == org))
    recent = db.scalars(select(Sermon).where(Sermon.org_id == org).order_by(Sermon.created_at.desc()).limit(6)).all()
    disk = shutil.disk_usage(get_settings().media_dir)
    return {
        "sermons": db.scalar(select(func.count(Sermon.id)).where(Sermon.org_id == org)),
        "clips": db.scalar(select(func.count(GeneratedClip.id)).where(GeneratedClip.org_id == org)),
        "processing_minutes": round(_usage(db, org, "processing_minutes"), 1),
        "processing_minutes_month": round(_usage(db, org, "processing_minutes", month_start), 1),
        "downloads": int(_usage(db, org, "download")),
        "storage_bytes": int(storage),
        "disk_free_bytes": disk.free,
        "disk_total_bytes": disk.total,
        "active_jobs": db.scalar(select(func.count(ProcessingJob.id)).where(
            ProcessingJob.org_id == org, ProcessingJob.status.in_(("queued", "running")))),
        "recent_sermons": [sermon_out(s) for s in recent],
    }


@router.get("/analytics")
def analytics(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    org = ctx.org_id
    since = datetime.utcnow() - timedelta(days=90)
    by_cat = db.execute(select(GeneratedClip.category, func.count(GeneratedClip.id), func.avg(GeneratedClip.score))
                        .where(GeneratedClip.org_id == org).group_by(GeneratedClip.category)).all()
    weekly = db.execute(select(func.strftime("%Y-%W", UsageRecord.created_at), UsageRecord.kind, func.sum(UsageRecord.amount))
                        .where(UsageRecord.org_id == org, UsageRecord.created_at >= since)
                        .group_by(func.strftime("%Y-%W", UsageRecord.created_at), UsageRecord.kind)).all()
    top = db.execute(select(GeneratedClip.id, GeneratedClip.title, GeneratedClip.downloads, GeneratedClip.score)
                     .where(GeneratedClip.org_id == org).order_by(GeneratedClip.downloads.desc(), GeneratedClip.score.desc())
                     .limit(10)).all()
    weeks: dict[str, dict] = {}
    for wk, kind, amt in weekly:
        weeks.setdefault(wk, {"week": wk})[kind] = round(float(amt), 1)
    return {
        "by_category": [{"category": c, "count": n, "avg_score": round(a or 0)} for c, n, a in by_cat],
        "weekly": sorted(weeks.values(), key=lambda w: w["week"]),
        "top_clips": [{"id": i, "title": t, "downloads": d, "score": round(s or 0)} for i, t, d, s in top],
    }


@router.get("/jobs")
def jobs(active: bool = False, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    stmt = select(ProcessingJob).where(ProcessingJob.org_id == ctx.org_id)
    if active:
        stmt = stmt.where(ProcessingJob.status.in_(("queued", "running")))
    return [job_out(j) for j in db.scalars(stmt.order_by(ProcessingJob.created_at.desc()).limit(50))]


@router.get("/notifications")
def notifications(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.org_id == ctx.org_id,
                                                 (Notification.user_id.is_(None)) | (Notification.user_id == ctx.user.id))
                      .order_by(Notification.created_at.desc()).limit(30)).all()
    return {"unread": sum(1 for n in rows if not n.read), "items": [notification_out(n) for n in rows]}


@router.post("/notifications/read-all")
def read_all(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.org_id == ctx.org_id,
                                          (Notification.user_id.is_(None)) | (Notification.user_id == ctx.user.id))
               .values(read=True))
    db.commit()
    return {"ok": True}


@router.get("/system")
def system(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    """Status of the local AI stack so the UI can show what's missing."""
    from datetime import datetime as dt
    hb = db.scalar(select(func.max(ProcessingJob.heartbeat_at)))
    worker_file = get_settings().data_dir / "db" / "worker.heartbeat"
    worker_alive = False
    if worker_file.exists():
        worker_alive = (dt.utcnow().timestamp() - worker_file.stat().st_mtime) < 30
    return {"ollama": ollama.health(), "worker_alive": worker_alive, "last_job_heartbeat": hb.isoformat() if hb else None,
            "llm_model": get_settings().llm_model, "embed_model": get_settings().embed_model,
            "whisper_model": get_settings().whisper_model}
