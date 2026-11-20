from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, BeforeValidator, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..files import file_response, safe_unlink
from ..models import BrandKit, ClipTemplate
from ..security import Ctx, audit, current_ctx
from ..pipeline import watermark as wm
from ..serializers import brand_out, template_out

router = APIRouter(tags=["brand"])

LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
HEX = r"^#[0-9A-Fa-f]{6}$"
SocialIcon = Literal["youtube", "tiktok", "instagram", "facebook", "x", "whatsapp"]


def _grid_position(v):
    """Accept grid cells 'r{0-5}c{0-2}' (and the old names like 'top-left', converted)."""
    if v is None:
        return v
    v = wm.LEGACY_POSITIONS.get(v, v)
    if v not in wm.POSITIONS:
        raise ValueError("position must be a grid cell r0c0 … r5c2 (6 rows × 3 columns)")
    return v


GridPosition = Annotated[str, BeforeValidator(_grid_position)]


class Colors(BaseModel):
    primary: str = Field(default="#6D28D9", pattern=HEX)
    secondary: str = Field(default="#0F172A", pattern=HEX)
    accent: str = Field(default="#FFD400", pattern=HEX)


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    colors: Colors = Colors()
    font: str | None = Field(default=None, max_length=100)
    watermark_text: str | None = Field(default=None, max_length=200)
    watermark_position: GridPosition = wm.DEFAULT_WATERMARK_POSITION
    watermark_size: int = Field(default=100, ge=wm.SIZE_MIN, le=wm.SIZE_MAX)
    watermark_opacity: int = Field(default=80, ge=wm.OPACITY_MIN, le=wm.OPACITY_MAX)
    social_icons: list[SocialIcon] = Field(default_factory=list, max_length=6)
    logo_position: GridPosition = wm.DEFAULT_LOGO_POSITION
    default_template_id: str | None = None
    is_default: bool = False
    auto_apply: bool = True


class BrandPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    colors: Colors | None = None
    font: str | None = None
    watermark_text: str | None = Field(default=None, max_length=200)
    watermark_position: GridPosition | None = None
    watermark_size: int | None = Field(default=None, ge=wm.SIZE_MIN, le=wm.SIZE_MAX)
    watermark_opacity: int | None = Field(default=None, ge=wm.OPACITY_MIN, le=wm.OPACITY_MAX)
    social_icons: list[SocialIcon] | None = Field(default=None, max_length=6)
    logo_position: GridPosition | None = None
    default_template_id: str | None = None
    is_default: bool | None = None
    auto_apply: bool | None = None


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    style: dict


STYLE_KEYS = {"font": str, "font_size": int, "primary_color": str, "highlight_color": str, "outline_color": str,
              "outline": int, "shadow": int, "bg_box": bool, "bg_color": str, "uppercase": bool,
              "words_per_line": int, "position": str, "animation": str}


def _kit(db, ctx, kit_id) -> BrandKit:
    k = db.get(BrandKit, kit_id)
    if not k or k.org_id != ctx.org_id:
        raise HTTPException(404, "Brand kit not found")
    return k


def _check_template(db, ctx, tid):
    if tid:
        t = db.get(ClipTemplate, tid)
        if not t or t.org_id not in (None, ctx.org_id):
            raise HTTPException(404, "Template not found")


def _make_default(db, ctx, k):
    db.execute(update(BrandKit).where(BrandKit.org_id == ctx.org_id, BrandKit.id != k.id).values(is_default=False))
    k.is_default = True


@router.get("/brand-kits")
def list_kits(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return [brand_out(k) for k in db.scalars(select(BrandKit).where(BrandKit.org_id == ctx.org_id).order_by(BrandKit.created_at))]


@router.post("/brand-kits")
def create_kit(body: BrandIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    _check_template(db, ctx, body.default_template_id)
    data = body.model_dump()
    data["colors"] = body.colors.model_dump()
    k = BrandKit(org_id=ctx.org_id, **data)
    db.add(k)
    db.flush()
    if body.is_default:
        _make_default(db, ctx, k)
    audit(db, ctx, "brand.create", k.id)
    db.commit()
    return brand_out(k)


@router.patch("/brand-kits/{kit_id}")
def update_kit(kit_id: str, body: BrandPatch, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    k = _kit(db, ctx, kit_id)
    data = body.model_dump(exclude_unset=True)
    if "default_template_id" in data:
        _check_template(db, ctx, data["default_template_id"])
    if "colors" in data and body.colors:
        data["colors"] = body.colors.model_dump()
    is_default = data.pop("is_default", None)
    for key, v in data.items():
        setattr(k, key, v)
    if is_default:
        _make_default(db, ctx, k)
    db.commit()
    return brand_out(k)


@router.delete("/brand-kits/{kit_id}")
def delete_kit(kit_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    k = _kit(db, ctx, kit_id)
    safe_unlink(k.logo_path)
    db.delete(k)
    audit(db, ctx, "brand.delete", kit_id)
    db.commit()
    return {"ok": True}


@router.post("/brand-kits/{kit_id}/logo")
async def upload_logo(kit_id: str, file: UploadFile = File(...), ctx: Ctx = Depends(current_ctx),
                      db: Session = Depends(get_db)):
    k = _kit(db, ctx, kit_id)
    ext = LOGO_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "Logo must be PNG, JPG or WEBP")
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Logo must be under 5 MB")
    # validate it really is an image
    import cv2
    import numpy as np
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise HTTPException(400, "File is not a valid image")
    d = get_settings().media_dir / ctx.org_id / "brand"
    d.mkdir(parents=True, exist_ok=True)
    safe_unlink(k.logo_path)
    path = d / f"{k.id}_logo.png"
    cv2.imwrite(str(path), img)  # normalise to PNG (keeps alpha)
    k.logo_path = str(path)
    db.commit()
    db.refresh(k)
    return brand_out(k)


@router.delete("/brand-kits/{kit_id}/logo")
def delete_logo(kit_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    k = _kit(db, ctx, kit_id)
    safe_unlink(k.logo_path)
    k.logo_path = None
    db.commit()
    return brand_out(k)


@router.get("/brand-kits/{kit_id}/logo")
def get_logo(kit_id: str, request: Request, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    return file_response(request, _kit(db, ctx, kit_id).logo_path)


@router.get("/watermark/preview")
def watermark_preview(
    text: str = Query(default="", max_length=200),
    icons: str = Query(default="", max_length=200, description="comma-separated: youtube,tiktok,instagram,facebook,x,whatsapp"),
    size: int = Query(default=100, ge=wm.SIZE_MIN, le=wm.SIZE_MAX),
    opacity: int = Query(default=80, ge=wm.OPACITY_MIN, le=wm.OPACITY_MAX),
    font: str | None = Query(default=None, max_length=100),
    ctx: Ctx = Depends(current_ctx),
):
    """The exact watermark image the renderer uses, sized for a 1080×1920 clip."""
    names = [i.strip() for i in icons.split(",") if i.strip()]
    bad = [i for i in names if i not in wm.SOCIAL_ICONS]
    if bad:
        raise HTTPException(400, f"Unknown icon(s): {', '.join(bad)}")
    spec = wm.clamp_spec(text=text, icons=names, size=size, opacity=opacity, font=font)
    if spec.is_empty():
        raise HTTPException(400, "Add watermark text or at least one social icon")
    png = wm.to_png(wm.build_image(spec, 1080, 1920))
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/templates")
def list_templates(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(ClipTemplate).where((ClipTemplate.org_id.is_(None)) | (ClipTemplate.org_id == ctx.org_id))
                      .order_by(ClipTemplate.org_id.is_not(None), ClipTemplate.created_at))
    return [template_out(t) for t in rows]


def _clean_style(style: dict) -> dict:
    from ..migrations import BUILTIN_TEMPLATES
    base = dict(BUILTIN_TEMPLATES[0]["style"])
    for k, typ in STYLE_KEYS.items():
        if k in style:
            try:
                base[k] = typ(style[k])
            except (TypeError, ValueError):
                raise HTTPException(400, f"Invalid value for {k}")
    base["font_size"] = max(24, min(160, base["font_size"]))
    base["words_per_line"] = max(1, min(8, base["words_per_line"]))
    if base["position"] not in ("top", "middle", "lower", "bottom"):
        base["position"] = "lower"
    if base["animation"] not in ("highlight", "pop", "none"):
        base["animation"] = "highlight"
    return base


@router.post("/templates")
def create_template(body: TemplateIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    t = ClipTemplate(org_id=ctx.org_id, name=body.name, style=_clean_style(body.style))
    db.add(t)
    db.commit()
    return template_out(t)


@router.patch("/templates/{template_id}")
def update_template(template_id: str, body: TemplateIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    t = db.get(ClipTemplate, template_id)
    if not t or t.org_id != ctx.org_id:
        raise HTTPException(404, "Template not found (built-in templates can't be edited; duplicate one instead)")
    t.name, t.style = body.name, _clean_style(body.style)
    db.commit()
    return template_out(t)


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    t = db.get(ClipTemplate, template_id)
    if not t or t.org_id != ctx.org_id:
        raise HTTPException(404, "Template not found")
    db.delete(t)
    db.commit()
    return {"ok": True}
