import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuditLog, OrganizationMember, User

COOKIE_NAME = "ss_session"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {"sub": user.id, "v": user.token_version, "iat": now, "exp": now + timedelta(days=s.session_days)}
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def set_session_cookie(response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        COOKIE_NAME, create_token(user), httponly=True, samesite="lax", secure=s.cookie_secure,
        max_age=s.session_days * 86400, path="/",
    )


@dataclass
class Ctx:
    user: User
    org_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role in ("owner", "admin")


def current_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active or payload.get("v") != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    member = db.scalar(select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1))
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No organization")
    return Ctx(user=user, org_id=member.org_id, role=member.role)


def require_admin(ctx: Ctx = Depends(current_ctx)) -> Ctx:
    if not ctx.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return ctx


def audit(db: Session, ctx: Ctx | None, action: str, target: str | None = None, **meta) -> None:
    db.add(AuditLog(org_id=ctx.org_id if ctx else meta.pop("org_id", None),
                    user_id=ctx.user.id if ctx else meta.pop("user_id", None),
                    action=action, target=target, meta=meta))


class RateLimiter:
    """Small in-memory sliding-window limiter (single API process)."""

    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try again shortly")
        q.append(now)


login_limiter = RateLimiter(10, 300)
