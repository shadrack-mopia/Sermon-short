"""FFmpeg / ffprobe helpers."""
import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path

from ..config import get_settings

CREATE_NO_WINDOW = 0x08000000 if hasattr(subprocess, "STARTUPINFO") else 0


class MediaError(RuntimeError):
    pass


def run(cmd: list[str], cwd: str | Path | None = None, timeout: float | None = None) -> subprocess.CompletedProcess:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, creationflags=CREATE_NO_WINDOW)
    if p.returncode != 0:
        tail = "\n".join(p.stderr.strip().splitlines()[-8:])
        raise MediaError(f"{Path(cmd[0]).name} failed ({p.returncode}): {tail}")
    return p


def probe(path: str | Path) -> dict:
    s = get_settings()
    p = run([s.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=120)
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams", [])
    video = next((x for x in streams if x.get("codec_type") == "video" and x.get("disposition", {}).get("attached_pic") != 1), None)
    audio = next((x for x in streams if x.get("codec_type") == "audio"), None)
    duration = float(data.get("format", {}).get("duration") or (video or {}).get("duration") or 0)
    w, h = (int(video.get("width", 0)), int(video.get("height", 0))) if video else (0, 0)
    rot = 0
    if video:
        for sd in video.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(sd["rotation"])
        rot = rot or int((video.get("tags") or {}).get("rotate", 0) or 0)
    if abs(rot) in (90, 270):
        w, h = h, w
    fps = 30.0
    if video and video.get("avg_frame_rate", "0/0") != "0/0":
        n, d = video["avg_frame_rate"].split("/")
        fps = float(n) / float(d) if float(d) else 30.0
    trc = (video or {}).get("color_transfer")
    return {"duration": duration, "width": w, "height": h, "has_video": video is not None,
            "has_audio": audio is not None, "fps": fps, "video_codec": (video or {}).get("codec_name"),
            "audio_codec": (audio or {}).get("codec_name"), "format": data.get("format", {}).get("format_name"),
            "pix_fmt": (video or {}).get("pix_fmt"), "color_transfer": trc,
            "color_primaries": (video or {}).get("color_primaries"), "hdr": is_hdr(trc)}


HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}  # PQ (HDR10 / Dolby Vision base) and HLG (iPhone, many phones)


def is_hdr(color_transfer: str | None) -> bool:
    return (color_transfer or "").lower() in HDR_TRANSFERS


def tonemap_filter(color_transfer: str | None) -> str:
    """HDR → SDR (BT.709) tone mapping so HDR phone footage doesn't look washed out."""
    # npl=100 + Hable was checked visually against the SDR original for both HLG and PQ test footage;
    # Hable rolls off bright stage lights smoothly instead of clipping them.
    return ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
            "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


SDR_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]

QUALITY_PRESETS = {
    # quality: (x264 preset, CRF, NVENC CQ, audio kbps)
    "standard": ("medium", 21, 23, 160),
    "high": ("slow", 18, 20, 192),
    "max": ("slow", 15, 17, 256),
}


def extract_audio(src: str | Path, dst: str | Path) -> None:
    s = get_settings()
    tmp = Path(dst).with_suffix(".tmp.wav")
    run([s.ffmpeg, "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)])
    tmp.replace(dst)


def thumbnail(src: str | Path, dst: str | Path, at: float, width: int = 640,
              color_transfer: str | None = None) -> None:
    s = get_settings()
    vf = f"scale={width}:-2"
    if is_hdr(color_transfer):
        vf = tonemap_filter(color_transfer) + "," + vf
    run([s.ffmpeg, "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1",
         "-vf", vf, "-q:v", "4", str(dst)])


@lru_cache
def video_encoder() -> str:
    s = get_settings()
    if s.video_encoder != "auto":
        return s.video_encoder
    try:  # actually try an NVENC encode; listing encoders isn't enough
        run([s.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2", "-c:v", "h264_nvenc",
             "-f", "null", "-"], timeout=30)
        return "h264_nvenc"
    except (MediaError, subprocess.TimeoutExpired, FileNotFoundError):
        return "libx264"


def encoder_args(enc: str, quality: str = "standard") -> list[str]:
    preset, crf, cq, _ = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["standard"])
    if enc == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p7" if quality != "standard" else "p5", "-rc", "vbr",
                "-cq", str(cq), "-b:v", "0", "-profile:v", "high"]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-profile:v", "high"]


def audio_bitrate(quality: str = "standard") -> str:
    return f"{QUALITY_PRESETS.get(quality, QUALITY_PRESETS['standard'])[3]}k"


_time_re = re.compile(r"out_time_ms=(\d+)")


def run_with_progress(cmd: list[str], duration: float, on_progress=None, cwd=None) -> None:
    """Run ffmpeg with -progress pipe:1 and report 0..1 progress."""
    full = cmd[:1] + ["-progress", "pipe:1", "-nostats"] + cmd[1:]
    p = subprocess.Popen(full, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
    import threading
    err: list[str] = []
    t = threading.Thread(target=lambda: err.extend(p.stderr.readlines()), daemon=True)
    t.start()
    for line in p.stdout:
        m = _time_re.match(line.strip())
        if m and on_progress and duration > 0:
            on_progress(min(1.0, int(m.group(1)) / 1e6 / duration))
    p.wait()
    t.join(timeout=5)
    if p.returncode != 0:
        raise MediaError("ffmpeg failed: " + "".join(err[-8:]).strip())
