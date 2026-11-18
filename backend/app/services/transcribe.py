"""Local speech-to-text with faster-whisper (GPU when available)."""
import gc
import logging
import os
import sys
from pathlib import Path
from typing import Callable

from ..config import get_settings

log = logging.getLogger("transcribe")


def _add_cuda_dlls() -> None:
    """pip's nvidia-cublas/cudnn wheels ship DLLs that Windows won't find on its own."""
    if sys.platform != "win32":
        return
    import site
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        nv = Path(sp) / "nvidia"
        if not nv.is_dir():
            continue
        for b in nv.glob("*/bin"):
            os.add_dll_directory(str(b))
            os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")


_add_cuda_dlls()


def _load_model():
    from faster_whisper import WhisperModel
    s = get_settings()
    devices = ["cuda", "cpu"] if s.whisper_device == "auto" else [s.whisper_device]
    last = None
    for dev in devices:
        try:
            ct = s.whisper_compute_type if dev == "cuda" else "int8"
            m = WhisperModel(s.whisper_model, device=dev, compute_type=ct, download_root=str(s.whisper_dir))
            log.info("Whisper %s loaded on %s (%s)", s.whisper_model, dev, ct)
            return m, dev
        except Exception as e:  # noqa: BLE001
            log.warning("Whisper on %s failed: %s", dev, e)
            last = e
    raise RuntimeError(f"Could not load Whisper model: {last}")


def transcribe(audio_path: str | Path, duration: float, language: str | None,
               on_progress: Callable[[float], None] | None = None) -> dict:
    """Returns {"language", "segments": [{start,end,text,words:[[s,e,w,p]],avg_prob,language}]}.

    language: None/"auto" = detect (multilingual per-segment, handles English/Swahili code switching).
    """
    model, device = _load_model()
    try:
        lang = None if language in (None, "", "auto") else language
        kwargs = dict(
            language=lang, task="transcribe", word_timestamps=True, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700}, beam_size=5,
            condition_on_previous_text=False,  # avoids repetition loops on long audio
            initial_prompt="A Christian sermon. Bible verses, Jesus, God, Holy Spirit, amen, hallelujah.",
        )
        if lang is None:
            kwargs["multilingual"] = True
        try:
            seg_iter, info = model.transcribe(str(audio_path), **kwargs)
        except TypeError:  # older faster-whisper without `multilingual`
            kwargs.pop("multilingual", None)
            seg_iter, info = model.transcribe(str(audio_path), **kwargs)
        segments = []
        for seg in seg_iter:
            words = [[round(w.start, 3), round(w.end, 3), w.word.strip(), round(w.probability, 3)]
                     for w in (seg.words or []) if w.word.strip()]
            text = seg.text.strip()
            if not text:
                continue
            probs = [w[3] for w in words]
            segments.append({
                "start": round(seg.start, 3), "end": round(seg.end, 3), "text": text, "words": words,
                "avg_prob": round(sum(probs) / len(probs), 3) if probs else 0.0,
                "language": getattr(seg, "language", None) or info.language,
            })
            if on_progress and duration:
                on_progress(min(1.0, seg.end / duration))
        return {"language": info.language, "language_probability": info.language_probability,
                "device": device, "segments": segments}
    finally:
        del model
        gc.collect()
