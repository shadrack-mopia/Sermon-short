"""Watermark image: optional social-media icons + text, rendered to a transparent PNG.

The same function renders the live preview in the app and the overlay burned into
clips, so what you see in the brand kit is what you get. Icons are drawn in code
(simple, recognisable shapes) using fonts already on Windows, so no icon files are
needed.
"""
import io
import math
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SOCIAL_ICONS = ["youtube", "tiktok", "instagram", "facebook", "x", "whatsapp"]
# Placement grid: 6 rows x 3 columns, written "r{row}c{col}" (r0c0 = top-left, r5c2 = bottom-right).
# Rows are spread evenly from the top margin to the bottom margin; columns are left / centre / right.
GRID_ROWS, GRID_COLS = 6, 3
POSITIONS = [f"r{r}c{c}" for r in range(GRID_ROWS) for c in range(GRID_COLS)]
DEFAULT_WATERMARK_POSITION, DEFAULT_LOGO_POSITION = "r0c0", "r0c2"
# names used before the grid existed (stored in older brand kits / clips)
LEGACY_POSITIONS = {
    "top-left": "r0c0", "top-center": "r0c1", "top-right": "r0c2",
    "middle-left": "r2c0", "center": "r2c1", "middle-right": "r2c2",
    "bottom-left": "r5c0", "bottom-center": "r5c1", "bottom-right": "r5c2",
}


def normalize_position(p: str | None, default: str = DEFAULT_WATERMARK_POSITION) -> str:
    p = LEGACY_POSITIONS.get(p or "", p)
    return p if p in POSITIONS else default


def grid_cell(position: str) -> tuple[int, int]:
    p = normalize_position(position)
    return int(p[1]), int(p[3])
SIZE_MIN, SIZE_MAX = 50, 300      # % of the default size
OPACITY_MIN, OPACITY_MAX = 10, 100  # %

FONTS_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
FALLBACK_FONTS = ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"]
SS = 4  # supersampling factor for smooth icon edges


@dataclass
class WatermarkSpec:
    text: str | None = None
    icons: list[str] = field(default_factory=list)
    position: str = DEFAULT_WATERMARK_POSITION
    size: int = 100      # percent
    opacity: int = 80    # percent
    font: str | None = None

    def is_empty(self) -> bool:
        return not (self.text and self.text.strip()) and not self.icons


# ---------------- fonts ----------------

@lru_cache
def _font_index() -> dict[str, str]:
    """Map lower-case font family/full names to files in the Windows fonts folder."""
    idx: dict[str, str] = {}
    if not FONTS_DIR.is_dir():
        return idx
    for p in FONTS_DIR.iterdir():
        if p.suffix.lower() not in (".ttf", ".otf"):
            continue
        try:
            fam, style = ImageFont.truetype(str(p), 12).getname()
        except OSError:
            continue
        idx.setdefault(f"{fam} {style}".lower(), str(p))
        if style.lower() in ("regular", "normal", "semibold", "bold"):
            idx.setdefault(fam.lower(), str(p))
    return idx


def _font_path(name: str | None) -> str | None:
    if name:
        idx = _font_index()
        key = name.strip().lower()
        if key in idx:
            return idx[key]
        for k, v in idx.items():  # "Montserrat" matches "montserrat semibold"
            if k.startswith(key):
                return v
    for f in FALLBACK_FONTS:
        if (FONTS_DIR / f).is_file():
            return str(FONTS_DIR / f)
    return None


def _font(name: str | None, px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _font_path(name)
    return ImageFont.truetype(path, px) if path else ImageFont.load_default()


# ---------------- icons ----------------

def _rounded(d: ImageDraw.ImageDraw, box, r, fill=None, outline=None, width=0):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def _glyph(d: ImageDraw.ImageDraw, S: int, text: str, font_file: str, frac: float, fill, dy: float = 0.0):
    path = FONTS_DIR / font_file
    if not path.is_file():
        return
    f = ImageFont.truetype(str(path), int(S * frac))
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((S - (r - l)) / 2 - l, (S - (b - t)) / 2 - t + dy * S), text, font=f, fill=fill)


def draw_icon(name: str, size: int) -> Image.Image:
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W = (255, 255, 255, 255)
    if name == "youtube":
        _rounded(d, (0, S * .14, S, S * .86), S * .2, fill=(255, 0, 0, 255))
        d.polygon([(S * .40, S * .33), (S * .40, S * .67), (S * .69, S * .5)], fill=W)
    elif name == "tiktok":
        _rounded(d, (0, 0, S, S), S * .22, fill=(0, 0, 0, 255))

        def note(dx, dy, col):
            ox, oy = S * dx, S * dy
            d.ellipse((S * .25 + ox, S * .52 + oy, S * .51 + ox, S * .78 + oy), outline=col, width=int(S * .075))
            d.rectangle((S * .46 + ox, S * .18 + oy, S * .535 + ox, S * .66 + oy), fill=col)
            d.arc((S * .48 + ox, S * .02 + oy, S * .80 + ox, S * .34 + oy), 90, 180, fill=col, width=int(S * .075))
        note(-.03, -.02, (37, 244, 238, 255))
        note(.03, .02, (254, 44, 85, 255))
        note(0, 0, W)
    elif name == "instagram":
        # diagonal gradient: yellow/orange bottom-left → pink → purple/blue top-right
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
        t = 1 - (xx + (S - yy)) / (2 * S)
        stops = [0.0, 0.35, 0.6, 0.8, 1.0]
        cols = np.array([(254, 218, 117), (250, 126, 30), (214, 41, 118), (150, 47, 191), (79, 91, 213)], np.float32)
        rgb = np.stack([np.interp(t, stops, cols[:, i]) for i in range(3)], axis=-1)
        rgba = np.dstack([rgb, np.full((S, S), 255, np.float32)]).astype(np.uint8)
        grad = Image.fromarray(rgba, "RGBA")
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S, S), radius=S * .24, fill=255)
        im.paste(grad, (0, 0), mask)
        w = int(S * .075)
        _rounded(d, (S * .2, S * .2, S * .8, S * .8), S * .17, outline=W, width=w)
        d.ellipse((S * .36, S * .36, S * .64, S * .64), outline=W, width=w)
        d.ellipse((S * .64, S * .27, S * .72, S * .35), fill=W)
    elif name == "facebook":
        d.ellipse((0, 0, S, S), fill=(24, 119, 242, 255))
        _glyph(d, S, "f", "segoeuib.ttf", 0.95, W, dy=.08)
    elif name == "x":
        _rounded(d, (0, 0, S, S), S * .22, fill=(0, 0, 0, 255))
        w = int(S * .085)
        d.line((S * .27, S * .24, S * .73, S * .76), fill=W, width=w)
        d.line((S * .73, S * .24, S * .27, S * .76), fill=W, width=int(w * .55))
    elif name == "whatsapp":
        d.ellipse((0, 0, S, S), fill=(37, 211, 102, 255))
        w = int(S * .07)
        d.ellipse((S * .18, S * .18, S * .82, S * .82), outline=W, width=w)
        d.polygon([(S * .2, S * .86), (S * .27, S * .66), (S * .38, S * .77)], fill=W)
        # handset: a thick arc with rounded ear/mouth pieces, tilted like the WhatsApp phone
        # bulges toward the lower left; ends (ear and mouth pieces) at top-left and bottom-right
        cx, cy, r = S * .53, S * .47, S * .16
        a0, a1 = 50, 220
        d.arc((cx - r, cy - r, cx + r, cy + r), a0, a1, fill=W, width=int(S * .075))
        for a in (a0, a1):
            px, py = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
            k = S * .068
            d.ellipse((px - k, py - k, px + k, py + k), fill=W)
    else:
        raise ValueError(f"Unknown icon {name}")
    return im.resize((size, size), Image.LANCZOS)


# ---------------- composition ----------------

def build_image(spec: WatermarkSpec, frame_w: int, frame_h: int) -> Image.Image:
    """Watermark sized relative to the output frame (100% ≈ 4.5% of the short side, ~49 px on 1080p)."""
    base = min(frame_w, frame_h) * 0.045
    h = max(12, int(base * max(SIZE_MIN, min(SIZE_MAX, spec.size)) / 100))
    gap_icon, gap_text = int(h * .22), int(h * .4)
    icons = [draw_icon(n, h) for n in spec.icons if n in SOCIAL_ICONS]
    text = (spec.text or "").strip()
    font = _font(spec.font, int(h * .78))
    stroke = max(1, int(h * .07))
    tw = th = 0
    if text:
        probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
        l, t, r, b = probe.textbbox((0, 0), text, font=font, stroke_width=stroke)
        tw, th = r - l, b - t
    pad = int(h * .25)  # room for the shadow
    width = sum(i.width for i in icons) + gap_icon * max(0, len(icons) - 1) + (gap_text if icons and text else 0) + tw
    W, H = max(1, width + 2 * pad), max(h, th) + 2 * pad
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x = pad
    for ic in icons:
        out.alpha_composite(ic, (x, (H - h) // 2))
        x += ic.width + gap_icon
    if icons and text:
        x += gap_text - gap_icon
    if text:
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        l, t, r, b = dl.textbbox((0, 0), text, font=font, stroke_width=stroke)
        dl.text((x - l, (H - (b - t)) / 2 - t), text, font=font, fill=(255, 255, 255, 255),
                stroke_width=stroke, stroke_fill=(0, 0, 0, 170))
        out.alpha_composite(layer)
    # soft drop shadow behind everything, so it reads on light and dark video
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(out.getchannel("A").point(lambda a: int(a * .55)).filter(ImageFilter.GaussianBlur(h * .08)))
    final = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    final.alpha_composite(shadow, (max(1, int(h * .04)), max(1, int(h * .05))))
    final.alpha_composite(out)
    op = max(OPACITY_MIN, min(OPACITY_MAX, spec.opacity)) / 100
    if op < 1:
        final.putalpha(final.getchannel("A").point(lambda a: int(a * op)))
    return final


def to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def overlay_xy(position: str, margin: int, dy: int = 0) -> str:
    """FFmpeg overlay x:y for a grid cell (W/H = frame, w/h = overlay). dy nudges it down (+) or up (-).

    Columns: left edge / centred / right edge. Rows are spread evenly, so row 0 touches the
    top margin, row 5 the bottom margin, and rows 1-4 sit in between.
    """
    r, c = grid_cell(position)
    m = margin
    x = {0: f"{m}", 1: "(W-w)/2", 2: f"W-w-{m}"}[c]
    last = GRID_ROWS - 1
    if r == 0:
        y = f"{m}"
    elif r == last:
        y = f"H-h-{m}"
    else:
        y = f"{m}+(H-h-{2 * m})*{r}/{last}"
    if dy:
        y = f"{y}{'+' if dy > 0 else '-'}{abs(dy)}"
    return f"{x}:{y}"


def avoid_overlap_dy(wm_position: str, logo_position: str, logo_h: int, margin: int) -> int:
    """If the watermark shares the logo's cell, move it just past the logo (down in the top half, up in the bottom)."""
    if normalize_position(wm_position) != normalize_position(logo_position, DEFAULT_LOGO_POSITION):
        return 0
    r, _ = grid_cell(wm_position)
    shift = logo_h + margin // 2
    return shift if r < GRID_ROWS / 2 else -shift


def spec_for_clip(kit, opts: dict) -> WatermarkSpec | None:
    """Brand-kit watermark settings with the clip's overrides applied (None = no watermark)."""
    if kit is None or not opts.get("watermark"):
        return None
    pick = lambda key, kit_val: opts[key] if opts.get(key) is not None else kit_val  # noqa: E731
    spec = clamp_spec(text=kit.watermark_text, icons=pick("wm_icons", kit.social_icons or []),
                      position=pick("wm_position", kit.watermark_position), size=pick("wm_size", kit.watermark_size),
                      opacity=pick("wm_opacity", kit.watermark_opacity), font=kit.font)
    return None if spec.is_empty() else spec


def clamp_spec(**kw) -> WatermarkSpec:
    s = WatermarkSpec(**kw)
    s.icons = [i for i in dict.fromkeys(s.icons or []) if i in SOCIAL_ICONS]
    s.position = normalize_position(s.position)
    s.size = int(max(SIZE_MIN, min(SIZE_MAX, s.size or 100)))
    s.opacity = int(max(OPACITY_MIN, min(OPACITY_MAX, s.opacity or 80)))
    return s
