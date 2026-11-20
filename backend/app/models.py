import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TimestampMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


ORG_FK = lambda: ForeignKey("organizations.id", ondelete="CASCADE")  # noqa: E731
SERMON_FK = lambda: ForeignKey("sermons.id", ondelete="CASCADE")  # noqa: E731


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(200))
    speaker_name: Mapped[str | None] = mapped_column(String(200))
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    platforms: Mapped[list] = mapped_column(JSON, default=list)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(200), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)


class OrganizationMember(TimestampMixin, Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner|admin|member


class Folder(TimestampMixin, Base):
    __tablename__ = "folders"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    name: Mapped[str] = mapped_column(String(200))


class Sermon(TimestampMixin, Base):
    __tablename__ = "sermons"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), index=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300))
    speaker: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str | None] = mapped_column(String(50))
    error: Mapped[str | None] = mapped_column(Text)
    duration_s: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str | None] = mapped_column(String(20))
    summary: Mapped[str | None] = mapped_column(Text)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    source_filename: Mapped[str | None] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    storage_dir: Mapped[str] = mapped_column(String(500), default="")


class VideoAsset(TimestampMixin, Base):
    __tablename__ = "video_assets"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # original|audio|thumbnail
    path: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Transcript(TimestampMixin, Base):
    __tablename__ = "transcripts"
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), unique=True)
    language: Mapped[str | None] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text, default="")
    word_count: Mapped[int] = mapped_column(Integer, default=0)


class TranscriptSegment(TimestampMixin, Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (Index("ix_seg_sermon_idx", "sermon_id", "idx"),)
    sermon_id: Mapped[str] = mapped_column(SERMON_FK())
    idx: Mapped[int] = mapped_column(Integer)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    words: Mapped[list] = mapped_column(JSON, default=list)  # [[start, end, word, prob], ...]
    avg_prob: Mapped[float] = mapped_column(Float, default=0.0)
    language: Mapped[str | None] = mapped_column(String(20))


class SearchChunk(TimestampMixin, Base):
    __tablename__ = "search_chunks"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)


class SermonTopic(TimestampMixin, Base):
    __tablename__ = "sermon_topics"
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)


class BibleReference(TimestampMixin, Base):
    __tablename__ = "bible_references"
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    reference: Mapped[str] = mapped_column(String(100), index=True)
    book: Mapped[str] = mapped_column(String(50), index=True)
    chapter: Mapped[int | None] = mapped_column(Integer)
    verse_start: Mapped[int | None] = mapped_column(Integer)
    verse_end: Mapped[int | None] = mapped_column(Integer)
    start_s: Mapped[float] = mapped_column(Float)
    context: Mapped[str] = mapped_column(Text, default="")


class ClipCandidate(TimestampMixin, Base):
    __tablename__ = "clip_candidates"
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    title: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(50))
    hook: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str] = mapped_column(Text, default="")
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    score: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(20), default="candidate")  # selected|rejected|duplicate|candidate
    reject_reason: Mapped[str | None] = mapped_column(String(200))
    extra: Mapped[dict] = mapped_column(JSON, default=dict)


class ClipTemplate(TimestampMixin, Base):
    __tablename__ = "clip_templates"
    org_id: Mapped[str | None] = mapped_column(ORG_FK(), index=True)  # null = built-in
    name: Mapped[str] = mapped_column(String(100))
    style: Mapped[dict] = mapped_column(JSON, default=dict)


class BrandKit(TimestampMixin, Base):
    __tablename__ = "brand_kits"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    name: Mapped[str] = mapped_column(String(200))
    logo_path: Mapped[str | None] = mapped_column(String(500))
    colors: Mapped[dict] = mapped_column(JSON, default=dict)  # primary, secondary, accent
    font: Mapped[str | None] = mapped_column(String(100))
    watermark_text: Mapped[str | None] = mapped_column(String(200))
    watermark_position: Mapped[str] = mapped_column(String(20), default="r0c0")  # grid cell r{0-5}c{0-2}
    watermark_size: Mapped[int] = mapped_column(Integer, default=100)  # percent of default size
    watermark_opacity: Mapped[int] = mapped_column(Integer, default=80)  # percent
    social_icons: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["tiktok", "instagram"]
    logo_position: Mapped[str] = mapped_column(String(20), default="r0c2")  # grid cell r{0-5}c{0-2}
    default_template_id: Mapped[str | None] = mapped_column(ForeignKey("clip_templates.id", ondelete="SET NULL"))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_apply: Mapped[bool] = mapped_column(Boolean, default=True)


class GeneratedClip(TimestampMixin, Base):
    __tablename__ = "generated_clips"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    sermon_id: Mapped[str] = mapped_column(SERMON_FK(), index=True)
    candidate_id: Mapped[str | None] = mapped_column(ForeignKey("clip_candidates.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    caption: Mapped[str | None] = mapped_column(Text)
    hashtags: Mapped[list] = mapped_column(JSON, default=list)
    category: Mapped[str] = mapped_column(String(50), default="powerful_statement")
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float, default=0)
    score_breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str] = mapped_column(Text, default="")
    aspect: Mapped[str] = mapped_column(String(10), default="9:16")
    template_id: Mapped[str | None] = mapped_column(ForeignKey("clip_templates.id", ondelete="SET NULL"))
    brand_kit_id: Mapped[str | None] = mapped_column(ForeignKey("brand_kits.id", ondelete="SET NULL"))
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    video_path: Mapped[str | None] = mapped_column(String(500))
    thumb_path: Mapped[str | None] = mapped_column(String(500))
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    render_version: Mapped[int] = mapped_column(Integer, default=0)
    crop_x: Mapped[float | None] = mapped_column(Float)  # 0..1 centre of crop, from face detection


class ClipCaption(TimestampMixin, Base):
    __tablename__ = "clip_captions"
    clip_id: Mapped[str] = mapped_column(ForeignKey("generated_clips.id", ondelete="CASCADE"), unique=True)
    words: Mapped[list] = mapped_column(JSON, default=list)  # [[start, end, word], ...] relative to clip start
    edited: Mapped[bool] = mapped_column(Boolean, default=False)


class ProcessingJob(TimestampMixin, Base):
    __tablename__ = "processing_jobs"
    __table_args__ = (Index("ix_jobs_status_created", "status", "created_at"),)
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # process_sermon|render_clip
    ref_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    stage: Mapped[str | None] = mapped_column(String(50))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class UsageRecord(TimestampMixin, Base):
    __tablename__ = "usage_records"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    amount: Mapped[float] = mapped_column(Float, default=0)
    ref_id: Mapped[str | None] = mapped_column(String(36))


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20), default="info")  # info|success|error
    read: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"
    org_id: Mapped[str | None] = mapped_column(String(36), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(100))
    target: Mapped[str | None] = mapped_column(String(100))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Upload(TimestampMixin, Base):
    __tablename__ = "uploads"
    org_id: Mapped[str] = mapped_column(ORG_FK(), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer)
    received_bytes: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="uploading")  # uploading|complete|aborted


class SchemaVersion(Base):
    __tablename__ = "schema_version"
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
