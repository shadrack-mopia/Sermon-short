"""Cut, reframe, caption, brand and encode a clip with FFmpeg."""
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config import get_settings
from ..services.media import (SDR_TAGS, audio_bitrate, encoder_args, is_hdr, run, run_with_progress, tonemap_filter,
                              video_encoder)
from .captions import build_ass
from .watermark import (DEFAULT_LOGO_POSITION, WatermarkSpec, avoid_overlap_dy, build_image, normalize_position,
                        overlay_xy)

log = logging.getLogger("render")

OUTPUT_SIZES = {
    ("9:16", 1080): (1080, 1920), ("9:16", 720): (720, 1280),
    ("1:1", 1080): (1080, 1080), ("1:1", 720): (720, 720),
    ("16:9", 1080): (1920, 1080), ("16:9", 720): (1280, 720),
}


@dataclass
class RenderSpec:
    src: str
    out: str
    start: float
    end: float
    src_w: int
    src_h: int
    aspect: str = "9:16"
    resolution: int = 1080
    track: list[tuple[float, float]] | None = None  # [(t_rel, centre_x 0..1)]
    crop_x: float | None = None  # manual override
    words: list[list] | None = None  # [[s, e, text]] relative
    style: dict | None = None
    show_captions: bool = True
    logo_path: str | None = None
    logo_position: str = "r0c2"
    watermark: WatermarkSpec | None = None  # icons + text image overlay
    quality: str = "standard"  # standard | high | max
    color_transfer: str | None = None  # from ffprobe; HDR sources are tone-mapped to SDR


# ---------------- speaker tracking ----------------

def detect_track(src: str, start: float, end: float, step: float = 1.0) -> list[tuple[float, float]]:
    """Sample frames, find the main face, return smoothed horizontal centre over time."""
    import cv2
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        return []
    pts: list[tuple[float, float | None]] = []
    prev = None
    t = start
    try:
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = 640 / w if w > 640 else 1.0
            small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1 else frame
            gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
            min_sz = max(24, int(small.shape[0] * 0.06))
            faces = list(cascade.detectMultiScale(gray, 1.1, 5, minSize=(min_sz, min_sz)))
            if not faces:
                faces = list(profile.detectMultiScale(gray, 1.1, 5, minSize=(min_sz, min_sz)))
            cx = None
            if faces:
                # prefer the largest face, but stick with the one closest to the previous position
                faces.sort(key=lambda f: -f[2] * f[3])
                big = faces[0][2] * faces[0][3]
                options = [f for f in faces if f[2] * f[3] >= big * 0.5]
                if prev is not None:
                    options.sort(key=lambda f: abs((f[0] + f[2] / 2) / small.shape[1] - prev))
                f = options[0]
                cx = (f[0] + f[2] / 2) / small.shape[1]
                prev = cx
            pts.append((t - start, cx))
            t += step
    finally:
        cap.release()
    found = [(t, x) for t, x in pts if x is not None]
    if not found:
        return []
    # fill gaps by holding the last known position
    filled, last = [], found[0][1]
    for t, x in pts:
        last = x if x is not None else last
        filled.append((t, last))
    xs = np.array([x for _, x in filled])
    k = min(5, len(xs))
    smooth = np.convolve(np.pad(xs, (k // 2, k - 1 - k // 2), mode="edge"), np.ones(k) / k, mode="valid")
    # dead-zone: only move the camera when the speaker moves noticeably
    out, cur = [], smooth[0]
    for (t, _), x in zip(filled, smooth):
        if abs(x - cur) > 0.06:
            cur = x
        out.append((t, float(cur)))
    # drop redundant keyframes
    pruned = [out[0]]
    for i in range(1, len(out) - 1):
        if out[i][1] != pruned[-1][1] or out[i + 1][1] != out[i][1]:
            pruned.append(out[i])
    if len(out) > 1:
        pruned.append(out[-1])
    return pruned


# ---------------- crop geometry ----------------

def crop_geometry(src_w: int, src_h: int, aspect: str) -> tuple[int, int]:
    aw, ah = (int(x) for x in aspect.split(":"))
    r = aw / ah
    if src_w / src_h > r:
        cw, ch = int(src_h * r) // 2 * 2, src_h // 2 * 2
    else:
        cw, ch = src_w // 2 * 2, int(src_w / r) // 2 * 2
    return cw, ch


def x_expression(track: list[tuple[float, float]] | None, crop_x: float | None, src_w: int, cw: int) -> str:
    """Piecewise-linear ffmpeg expression for the crop's left edge over time t."""
    max_x = src_w - cw

    def px(c):
        return int(min(max(0, c * src_w - cw / 2), max_x))

    if crop_x is not None or not track:
        return str(px(0.5 if crop_x is None else crop_x))
    keys = [(t, px(c)) for t, c in track]
    if len({x for _, x in keys}) == 1:
        return str(keys[0][1])
    # ease between keyframes over 0.6 s so the camera pans smoothly instead of jumping
    expr = str(keys[-1][1])
    for i in range(len(keys) - 1, 0, -1):
        t0, x0 = keys[i - 1]
        t1, x1 = keys[i]
        if x0 == x1:
            seg = str(x0)
        else:
            ts = max(t0, t1 - 0.6)
            seg = f"if(lt(t,{ts:.2f}),{x0},{x0}+({x1 - x0})*(t-{ts:.2f})/{(t1 - ts):.2f})"
        expr = f"if(lt(t,{t1:.2f}),{seg},{expr})"
    return expr


# ---------------- render ----------------

def render(spec: RenderSpec, workdir: Path, on_progress=None) -> None:
    s = get_settings()
    workdir.mkdir(parents=True, exist_ok=True)
    ow, oh = OUTPUT_SIZES[(spec.aspect, spec.resolution)]
    dur = spec.end - spec.start
    cw, ch = crop_geometry(spec.src_w, spec.src_h, spec.aspect)
    xexp = x_expression(spec.track, spec.crop_x, spec.src_w, cw)
    y = max(0, (spec.src_h - ch) // 2)

    has_subs = bool(spec.show_captions and spec.words)
    if has_subs:
        ass = build_ass(spec.words or [], spec.style or {}, ow, oh, dur, spec.show_captions)
        (workdir / "captions.ass").write_text(ass, encoding="utf-8")

    chain = [f"[0:v]crop=w={cw}:h={ch}:x='{xexp}':y={y}", f"scale={ow}:{oh}:flags=lanczos", "setsar=1",
             # tag output as standard HD colour so every platform shows the same colours
             "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"]
    if is_hdr(spec.color_transfer):
        chain[0] = "[0:v]" + tonemap_filter(spec.color_transfer) + "," + chain[0][len("[0:v]"):]
    if has_subs:
        chain.append("subtitles=captions.ass")
    graph = ",".join(chain) + "[base]"
    last = "[base]"
    inputs = ["-ss", f"{spec.start:.3f}", "-t", f"{dur:.3f}", "-i", str(spec.src)]
    m = int(min(ow, oh) * 0.04)  # margin from the frame edge
    n_in = 1
    logo_h = 0
    has_logo = bool(spec.logo_path and Path(spec.logo_path).is_file())
    if has_logo:
        lw = int(min(ow, oh) * 0.16)
        try:
            from PIL import Image
            with Image.open(spec.logo_path) as li:
                logo_h = int(lw * li.height / max(1, li.width))
        except OSError:
            logo_h = lw
        pos = overlay_xy(normalize_position(spec.logo_position, DEFAULT_LOGO_POSITION), m)
        inputs += ["-loop", "1", "-i", str(spec.logo_path)]
        graph += (f";[{n_in}:v]scale={lw}:-1,format=rgba,colorchannelmixer=aa=0.92[logo];"
                  f"{last}[logo]overlay={pos}:shortest=1[vlogo]")
        last, n_in = "[vlogo]", n_in + 1
    if spec.watermark and not spec.watermark.is_empty():
        wm_png = workdir / "watermark.png"
        build_image(spec.watermark, ow, oh).save(wm_png)
        # same cell as the logo: sit just beyond the logo instead of on top of it
        dy = avoid_overlap_dy(spec.watermark.position, spec.logo_position, logo_h, m) if has_logo else 0
        xy = overlay_xy(spec.watermark.position, m, dy)
        inputs += ["-loop", "1", "-i", wm_png.name]
        graph += f";{last}[{n_in}:v]overlay={xy}:shortest=1[vwm]"
        last, n_in = "[vwm]", n_in + 1
    graph += ";[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]"
    (workdir / "graph.txt").write_text(graph, encoding="utf-8")

    tmp = workdir / "out.tmp.mp4"
    enc = video_encoder()
    cmd = [s.ffmpeg, "-y", "-v", "error", *inputs, "-/filter_complex", "graph.txt",
           "-map", last, "-map", "[aout]", *encoder_args(enc, spec.quality), "-pix_fmt", "yuv420p",
           *SDR_TAGS, "-c:a", "aac", "-b:a", audio_bitrate(spec.quality), "-movflags", "+faststart", "-t", f"{dur:.3f}", str(tmp)]
    try:
        run_with_progress(cmd, dur, on_progress, cwd=workdir)
    except Exception:
        if enc != "libx264":  # NVENC can fail (e.g. GPU busy) — fall back to CPU encoder
            log.warning("NVENC render failed, retrying with libx264")
            cmd = [c for c in cmd]
            i = cmd.index("-c:v")
            cmd[i:i + len(encoder_args(enc, spec.quality))] = encoder_args("libx264", spec.quality)
            run_with_progress(cmd, dur, on_progress, cwd=workdir)
        else:
            raise
    tmp.replace(spec.out)


def clip_thumbnail(video: str, dst: str, at: float = 1.0) -> None:
    s = get_settings()
    run([s.ffmpeg, "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", video, "-frames:v", "1",
         "-vf", "scale=360:-2", "-q:v", "4", dst])
