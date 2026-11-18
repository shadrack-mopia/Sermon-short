from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import BrandKit, Organization, OrganizationMember, User
from ..serializers import user_out
from ..security import (
    COOKIE_NAME,
    Ctx,
    audit,
    current_ctx,
    hash_password,
    login_limiter,
    require_admin,
    set_session_cookie,
    verify_password,
)

router = APIRouter(tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    org_name: str = Field(default="My Church", max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    speaker_name: str | None = Field(default=None, max_length=200)
    platforms: list[str] | None = None
    onboarded: bool | None = None


class MemberIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="member", pattern="^(admin|member)$")


def _org_out(o: Organization) -> dict:
    return {"id": o.id, "name": o.name, "speaker_name": o.speaker_name,
            "platforms": o.platforms or [], "onboarded": o.onboarded}


def _me(ctx: Ctx, db: Session) -> dict:
    org = db.get(Organization, ctx.org_id)
    return {"user": user_out(ctx.user, ctx.role), "org": _org_out(org)}


@router.get("/auth/config")
def auth_config(db: Session = Depends(get_db)):
    has_users = db.scalar(select(func.count(User.id))) > 0
    return {"registration_open": get_settings().allow_registration or not has_users}


@router.post("/auth/register")
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(f"reg:{request.client.host if request.client else '?'}")
    has_users = db.scalar(select(func.count(User.id))) > 0
    if has_users and not get_settings().allow_registration:
        raise HTTPException(403, "Registration is closed. Ask your admin to add you on the Team page.")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, password_hash=hash_password(body.password), name=body.name.strip())
    org = Organization(name=body.org_name.strip() or "My Church")
    db.add_all([user, org])
    db.flush()
    db.add(OrganizationMember(org_id=org.id, user_id=user.id, role="owner"))
    db.add(BrandKit(org_id=org.id, name=org.name, is_default=True, colors={"primary": "#6D28D9", "secondary": "#0F172A", "accent": "#FFD400"}))
    audit(db, None, "user.register", user.id, org_id=org.id, user_id=user.id)
    db.commit()
    set_session_cookie(response, user)
    return {"user": user_out(user, "owner"), "org": _org_out(org)}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(f"login:{request.client.host if request.client else '?'}:{body.email.lower()}")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    set_session_cookie(response, user)
    member = db.scalar(select(OrganizationMember).where(OrganizationMember.user_id == user.id))
    audit(db, None, "user.login", user.id, org_id=member.org_id if member else None, user_id=user.id)
    db.commit()
    return _me(Ctx(user, member.org_id, member.role), db)


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return _me(ctx, db)


@router.patch("/auth/me")
def update_me(body: MeUpdate, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    user = db.get(User, ctx.user.id)
    if body.email and body.email.lower() != user.email:
        if db.scalar(select(User).where(User.email == body.email.lower())):
            raise HTTPException(409, "Email already in use")
        user.email = body.email.lower()
    if body.name is not None:
        user.name = body.name.strip()
    db.commit()
    return _me(Ctx(user, ctx.org_id, ctx.role), db)


@router.post("/auth/change-password")
def change_password(body: PasswordChange, response: Response, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    user = db.get(User, ctx.user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1  # sign out other sessions
    audit(db, ctx, "user.change_password", user.id)
    db.commit()
    set_session_cookie(response, user)
    return {"ok": True}


@router.get("/org")
def get_org(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return _org_out(db.get(Organization, ctx.org_id))


@router.patch("/org")
def update_org(body: OrgUpdate, ctx: Ctx = Depends(require_admin), db: Session = Depends(get_db)):
    org = db.get(Organization, ctx.org_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(org, k, v)
    audit(db, ctx, "org.update", org.id)
    db.commit()
    return _org_out(org)


@router.get("/org/members")
def members(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    rows = db.execute(
        select(User, OrganizationMember.role, OrganizationMember.id)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.org_id == ctx.org_id).order_by(User.created_at)
    ).all()
    return [{**user_out(u, role), "member_id": mid} for u, role, mid in rows]


@router.post("/org/members")
def add_member(body: MemberIn, ctx: Ctx = Depends(require_admin), db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, password_hash=hash_password(body.password), name=body.name)
    db.add(user)
    db.flush()
    db.add(OrganizationMember(org_id=ctx.org_id, user_id=user.id, role=body.role))
    audit(db, ctx, "org.add_member", user.id, role=body.role)
    db.commit()
    return user_out(user, body.role)


@router.delete("/org/members/{user_id}")
def remove_member(user_id: str, ctx: Ctx = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.scalar(select(OrganizationMember).where(OrganizationMember.org_id == ctx.org_id,
                                                   OrganizationMember.user_id == user_id))
    if not m:
        raise HTTPException(404, "Member not found")
    if m.role == "owner":
        raise HTTPException(400, "The owner cannot be removed")
    user = db.get(User, user_id)
    db.delete(m)
    if user:
        user.is_active = False
        user.token_version += 1
    audit(db, ctx, "org.remove_member", user_id)
    db.commit()
    return {"ok": True}
