from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Notification, ProcessingJob, UsageRecord


def enqueue(db: Session, org_id: str, kind: str, ref_id: str, payload: dict | None = None) -> ProcessingJob:
    """Queue a job unless an identical one is already queued/running."""
    existing = db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.kind == kind, ProcessingJob.ref_id == ref_id,
            ProcessingJob.status.in_(("queued", "running")),
        )
    )
    if existing:
        if existing.status == "queued" and payload:
            existing.payload = payload
        return existing
    job = ProcessingJob(org_id=org_id, kind=kind, ref_id=ref_id, payload=payload or {})
    db.add(job)
    return job


def notify(db: Session, org_id: str, title: str, body: str = "", link: str | None = None,
           kind: str = "info", user_id: str | None = None) -> None:
    db.add(Notification(org_id=org_id, user_id=user_id, title=title, body=body, link=link, kind=kind))


def record_usage(db: Session, org_id: str, kind: str, amount: float, ref_id: str | None = None) -> None:
    db.add(UsageRecord(org_id=org_id, kind=kind, amount=amount, ref_id=ref_id))
