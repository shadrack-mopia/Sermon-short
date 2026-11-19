"""Model → JSON dicts returned by the API. Kept explicit so the frontend contract is obvious."""
from .models import (
    BrandKit,
    ClipTemplate,
    Folder,
    GeneratedClip,
    Notification,
    ProcessingJob,
    Sermon,
    User,
)


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def user_out(u: User, role: str | None = None) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": role, "created_at": iso(u.created_at)}


def sermon_out(s: Sermon, clip_count: int | None = None) -> dict:
    return {
        "id": s.id, "title": s.title, "speaker": s.speaker, "status": s.status,
        "progress": s.progress, "stage": s.stage, "error": s.error,
        "duration_s": s.duration_s, "width": s.width, "height": s.height,
        "language": s.language, "summary": s.summary, "settings": s.settings or {},
        "folder_id": s.folder_id, "source_filename": s.source_filename,
        "size_bytes": s.size_bytes, "clip_count": clip_count,
        "thumbnail_url": f"/api/sermons/{s.id}/thumbnail",
        "video_url": f"/api/sermons/{s.id}/video",
        "created_at": iso(s.created_at), "updated_at": iso(s.updated_at),
    }


def clip_out(c: GeneratedClip, sermon_title: str | None = None) -> dict:
    v = c.render_version
    return {
        "id": c.id, "sermon_id": c.sermon_id, "sermon_title": sermon_title,
        "title": c.title, "description": c.description, "caption": c.caption,
        "hashtags": c.hashtags or [], "category": c.category,
        "start_s": c.start_s, "end_s": c.end_s, "duration_s": round(c.end_s - c.start_s, 2),
        "score": round(c.score or 0), "score_breakdown": c.score_breakdown or {},
        "reason": c.reason, "transcript": c.transcript, "aspect": c.aspect,
        "template_id": c.template_id, "brand_kit_id": c.brand_kit_id,
        "options": c.options or {}, "status": c.status, "error": c.error,
        "downloads": c.downloads, "render_version": v,
        "video_url": f"/api/clips/{c.id}/video?v={v}" if c.video_path else None,
        "thumbnail_url": f"/api/clips/{c.id}/thumbnail?v={v}" if c.thumb_path else None,
        "download_url": f"/api/clips/{c.id}/download" if c.video_path else None,
        "created_at": iso(c.created_at), "updated_at": iso(c.updated_at),
    }


def folder_out(f: Folder, count: int = 0) -> dict:
    return {"id": f.id, "name": f.name, "sermon_count": count, "created_at": iso(f.created_at)}


def template_out(t: ClipTemplate) -> dict:
    return {"id": t.id, "name": t.name, "style": t.style, "builtin": t.org_id is None}


def brand_out(b: BrandKit) -> dict:
    return {
        "id": b.id, "name": b.name, "colors": b.colors or {}, "font": b.font,
        "watermark_text": b.watermark_text, "watermark_position": b.watermark_position or "top-left",
        "watermark_size": b.watermark_size or 100, "watermark_opacity": b.watermark_opacity or 80,
        "social_icons": b.social_icons or [], "logo_position": b.logo_position,
        "default_template_id": b.default_template_id, "is_default": b.is_default,
        "auto_apply": b.auto_apply,
        "logo_url": f"/api/brand-kits/{b.id}/logo?t={int(b.updated_at.timestamp())}" if b.logo_path else None,
    }


def job_out(j: ProcessingJob) -> dict:
    return {
        "id": j.id, "kind": j.kind, "ref_id": j.ref_id, "status": j.status, "stage": j.stage,
        "progress": j.progress, "attempts": j.attempts, "error": j.error,
        "created_at": iso(j.created_at), "finished_at": iso(j.finished_at),
    }


def notification_out(n: Notification) -> dict:
    return {"id": n.id, "title": n.title, "body": n.body, "link": n.link, "kind": n.kind,
            "read": n.read, "created_at": iso(n.created_at)}
