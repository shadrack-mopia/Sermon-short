"""Sermon intelligence: find, validate, score and select clip-worthy moments.

The LLM only ever sees numbered transcript lines and answers with line numbers,
so every timestamp comes from Whisper and can't be hallucinated.
"""
import logging
import math
from dataclasses import dataclass, field

import numpy as np

from ..services.ollama import chat_json, embed
from .boundaries import Word, fit_duration, padded_range, snap_end, snap_start, text_between

log = logging.getLogger("analysis")

CATEGORIES = ["powerful_statement", "biblical_teaching", "inspirational", "testimony_story",
              "practical_advice", "engaging_question"]
CATEGORY_LABELS = {
    "powerful_statement": "Powerful statement", "biblical_teaching": "Biblical teaching",
    "inspirational": "Inspirational", "testimony_story": "Testimony / story",
    "practical_advice": "Practical advice", "engaging_question": "Engaging question", "custom": "Custom",
}
SCORE_KEYS = ["hook", "clarity", "emotion", "spiritual", "standalone", "completeness", "practical"]

MODE_TEXT = {
    "viral": "VIRAL MOMENTS: strong opening hooks, bold memorable declarations, quotable one-liners, high-energy "
             "preaching, surprising insights, moments that make someone stop scrolling.",
    "teaching": "BIBLICAL TEACHING: clear explanations of a Bible verse or passage, biblical principles, "
                "theological insight, practical Christian teaching that stands alone.",
    "inspirational": "INSPIRATIONAL MOMENTS: encouragement, faith and hope, overcoming hardship, personal "
                     "testimonies, emotional stories and illustrations.",
    "all": "A BALANCED MIX of powerful statements, biblical teaching, inspiration, testimonies/stories, "
           "practical advice (marriage, family, finances, prayer, growth) and engaging questions.",
}

MODE_WEIGHTS = {  # emphasis of each sub-score per mode
    "viral": {"hook": 0.28, "clarity": 0.12, "emotion": 0.16, "spiritual": 0.08, "standalone": 0.16, "completeness": 0.12, "practical": 0.08},
    "teaching": {"hook": 0.10, "clarity": 0.18, "emotion": 0.06, "spiritual": 0.24, "standalone": 0.16, "completeness": 0.14, "practical": 0.12},
    "inspirational": {"hook": 0.14, "clarity": 0.12, "emotion": 0.26, "spiritual": 0.14, "standalone": 0.16, "completeness": 0.12, "practical": 0.06},
    "all": {"hook": 0.18, "clarity": 0.14, "emotion": 0.14, "spiritual": 0.14, "standalone": 0.16, "completeness": 0.14, "practical": 0.10},
}

WINDOW_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "string"}},
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "title": {"type": "string"},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "hook": {"type": "string"},
                    "why": {"type": "string"},
                    "caption": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "scores": {
                        "type": "object",
                        "properties": {k: {"type": "integer", "minimum": 1, "maximum": 10} for k in SCORE_KEYS},
                        "required": SCORE_KEYS,
                    },
                },
                "required": ["start_line", "end_line", "title", "category", "hook", "why", "caption", "hashtags", "scores"],
            },
        },
    },
    "required": ["summary", "topics", "moments"],
}

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "description": {"type": "string"}}, "required": ["name", "description"]}},
    },
    "required": ["title", "summary", "topics"],
}

SYSTEM = """You are an expert Christian content editor who turns sermons into short social media clips.
You understand preaching, scripture and what makes a short sermon clip meaningful and engaging.
Rules:
- Only choose moments that are a COMPLETE THOUGHT: a viewer with no context must understand it.
- Start on the line where the thought begins (not mid-sentence, no "and so..." without context).
- End on the line where the thought lands. Never stop before the point is made.
- Never pick worship songs, announcements, offering logistics, greetings or filler.
- Be honest in scores (1-10). Most moments are 5-7; reserve 9-10 for truly exceptional ones.
- Write titles, hooks and captions in the same language the preacher mainly uses in the moment.
- Titles: short (max 8 words), compelling, faithful to what was said. No clickbait lies.
- Hashtags: 3-6, relevant, include faith-related tags.
- Line numbers must be lines that exist in the given excerpt."""


@dataclass
class Seg:
    idx: int
    start: float
    end: float
    text: str


@dataclass
class Candidate:
    start: float
    end: float
    title: str
    category: str
    hook: str
    reason: str
    caption: str
    hashtags: list[str]
    scores: dict
    transcript: str = ""
    score: float = 0.0
    breakdown: dict = field(default_factory=dict)
    status: str = "candidate"
    reject_reason: str | None = None


def fmt_ts(s: float) -> str:
    s = int(s)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def duration_range(settings: dict) -> tuple[float, float]:
    if settings.get("min_s") and settings.get("max_s") and settings["max_s"] > settings["min_s"]:
        return float(settings["min_s"]), float(settings["max_s"])
    lengths = [int(x) for x in settings.get("clip_lengths") or [30, 60] if int(x) > 0] or [30, 60]
    lo, hi = min(lengths), max(lengths)
    return max(8.0, lo * 0.75), hi * 1.25 + 5


def make_windows(segs: list[Seg], window_s: float = 420, overlap_s: float = 60) -> list[list[Seg]]:
    if not segs:
        return []
    windows, start = [], segs[0].start
    end_t = segs[-1].end
    while start < end_t:
        w = [s for s in segs if s.end > start and s.start < start + window_s]
        if w:
            windows.append(w)
        if start + window_s >= end_t:
            break
        start += window_s - overlap_s
    return windows


def _window_prompt(win: list[Seg], modes: list[str], dmin: float, dmax: float, k: int) -> str:
    focus = "\n".join(f"- {MODE_TEXT[m]}" for m in modes)
    lines = "\n".join(f"[{s.idx}] ({fmt_ts(s.start)}) {s.text}" for s in win)
    return (f"Find up to {k} of the best short-clip moments in this sermon excerpt.\n"
            f"Focus on:\n{focus}\n"
            f"Each moment must last between {int(dmin)} and {int(dmax)} seconds (use the timestamps).\n"
            f"If nothing in the excerpt is worth clipping, return an empty moments list.\n"
            f"Also give a 1-2 sentence summary of the excerpt and its topics.\n\n"
            f"SERMON EXCERPT:\n{lines}")


def find_moments(segs: list[Seg], settings: dict, on_progress=None) -> tuple[list[Candidate], list[dict]]:
    modes = settings.get("modes") or ["all"]
    if "all" in modes:
        modes = ["all"]
    dmin, dmax = duration_range(settings)
    by_idx = {s.idx: s for s in segs}
    windows = make_windows(segs)
    cands: list[Candidate] = []
    notes: list[dict] = []
    for wi, win in enumerate(windows):
        data = chat_json(SYSTEM, _window_prompt(win, modes, dmin, dmax, k=4), WINDOW_SCHEMA)
        notes.append({"start": win[0].start, "summary": data.get("summary", ""), "topics": data.get("topics", [])})
        lo, hi = win[0].idx, win[-1].idx
        for m in data.get("moments", []):
            a, b = int(m.get("start_line", -1)), int(m.get("end_line", -1))
            if a > b:
                a, b = b, a
            if a not in by_idx or b not in by_idx or a < lo or b > hi:
                log.info("Dropping moment with invalid lines %s-%s", a, b)
                continue
            scores = {k: max(1, min(10, int(m.get("scores", {}).get(k, 5)))) for k in SCORE_KEYS}
            cands.append(Candidate(
                start=by_idx[a].start, end=by_idx[b].end, title=(m.get("title") or "Sermon moment").strip()[:120],
                category=m.get("category") if m.get("category") in CATEGORIES else "powerful_statement",
                hook=(m.get("hook") or "").strip(), reason=(m.get("why") or "").strip(),
                caption=(m.get("caption") or "").strip(),
                hashtags=[h if h.startswith("#") else f"#{h}" for h in (m.get("hashtags") or [])][:8],
                scores=scores,
            ))
        if on_progress:
            on_progress((wi + 1) / len(windows))
    return cands, notes


def summarise(notes: list[dict], speaker: str | None) -> dict:
    text = "\n".join(f"({fmt_ts(n['start'])}) {n['summary']} Topics: {', '.join(n['topics'])}" for n in notes)
    prompt = (f"These are notes on consecutive parts of one sermon{f' by {speaker}' if speaker else ''}.\n"
              f"Give the sermon a short title, a 3-5 sentence summary of its message, and its 3-6 main "
              f"topics/themes with a one-sentence description each.\n\nNOTES:\n{text}")
    return chat_json(SYSTEM, prompt, SUMMARY_SCHEMA, keep_alive=0)


def validate(cands: list[Candidate], words: list[Word], settings: dict) -> None:
    """Snap to sentence boundaries, enforce duration, attach transcript. Marks rejects in place."""
    dmin, dmax = duration_range(settings)
    for c in cands:
        if not words:
            c.status, c.reject_reason = "rejected", "no word timings"
            continue
        i0, i1 = snap_start(words, c.start, back=6, fwd=6), snap_end(words, c.end, back=6, fwd=8)
        if i1 <= i0:
            c.status, c.reject_reason = "rejected", "empty range"
            continue
        fitted = fit_duration(words, i0, i1, dmin, dmax)
        if not fitted:
            c.status, c.reject_reason = "rejected", f"could not fit {int(dmin)}-{int(dmax)}s at sentence boundaries"
            continue
        i0, i1 = fitted
        c.start, c.end = padded_range(words, i0, i1)
        c.transcript = text_between(words, c.start, c.end)
        c.breakdown["_bounds"] = (words[i0].sent_start, words[i1].sent_end)
        clip_words = [w for w in words[i0:i1 + 1]]
        c.breakdown["_audio"] = float(np.mean([w.prob for w in clip_words])) if clip_words else 0.0


def score(cands: list[Candidate], modes: list[str]) -> None:
    modes = ["all"] if (not modes or "all" in modes) else modes
    weights = {k: float(np.mean([MODE_WEIGHTS[m][k] for m in modes])) for k in SCORE_KEYS}
    tot = sum(weights.values())
    for c in cands:
        if c.status == "rejected":
            continue
        llm = sum(weights[k] * c.scores[k] for k in SCORE_KEYS) / tot  # 1..10
        llm100 = (llm - 1) / 9 * 100
        s_ok, e_ok = c.breakdown.get("_bounds", (False, False))
        boundary = 50 * s_ok + 50 * e_ok
        audio = float(np.clip((c.breakdown.get("_audio", 0.7) - 0.5) / 0.45, 0, 1) * 100)
        c.score = round(0.8 * llm100 + 0.1 * boundary + 0.1 * audio, 1)
        c.breakdown = {
            "opening_hook": c.scores["hook"] * 10, "message_clarity": c.scores["clarity"] * 10,
            "emotional_engagement": c.scores["emotion"] * 10, "spiritual_relevance": c.scores["spiritual"] * 10,
            "standalone_meaning": c.scores["standalone"] * 10, "completeness": c.scores["completeness"] * 10,
            "practical_usefulness": c.scores["practical"] * 10, "clean_boundaries": boundary,
            "audio_clarity": round(audio),
        }


def dedupe(cands: list[Candidate], use_embeddings: bool = True, sim_threshold: float = 0.88) -> None:
    live = sorted([c for c in cands if c.status != "rejected"], key=lambda c: -c.score)
    vecs = None
    if use_embeddings and len(live) > 1:
        try:
            vecs = embed([c.transcript or c.title for c in live])
        except Exception as e:  # noqa: BLE001  (embedding is an enhancement; overlap check still runs)
            log.warning("Dedup embeddings unavailable: %s", e)
    kept: list[int] = []
    for i, c in enumerate(live):
        dup = None
        for j in kept:
            k = live[j]
            overlap = max(0.0, min(c.end, k.end) - max(c.start, k.start))
            if overlap / max(1e-6, min(c.end - c.start, k.end - k.start)) > 0.4:
                dup = f"overlaps '{k.title}'"
                break
            if vecs is not None and float(vecs[i] @ vecs[j]) > sim_threshold:
                dup = f"same message as '{k.title}'"
                break
        if dup:
            c.status, c.reject_reason = "duplicate", dup
        else:
            kept.append(i)


def target_count(duration_s: float, max_clips: int) -> int:
    if max_clips:
        return max_clips
    return int(min(15, max(5, math.ceil(duration_s / 60 / 5))))


def select(cands: list[Candidate], n: int, min_score: float = 35) -> list[Candidate]:
    pool = sorted([c for c in cands if c.status not in ("rejected", "duplicate")], key=lambda c: -c.score)
    cap = max(2, math.ceil(n * 0.5))  # keep variety: no category takes more than half
    chosen, per_cat = [], {}
    for c in pool:
        if len(chosen) >= n:
            break
        if c.score < min_score and len(chosen) >= 3:
            c.reject_reason = "low score"
            continue
        if per_cat.get(c.category, 0) >= cap:
            continue
        chosen.append(c)
        per_cat[c.category] = per_cat.get(c.category, 0) + 1
    for c in pool:  # fill remaining slots ignoring category cap
        if len(chosen) >= n:
            break
        if c not in chosen and c.score >= min_score:
            chosen.append(c)
    for c in pool:
        c.status = "selected" if c in chosen else ("rejected" if c.status == "candidate" else c.status)
        if c.status == "rejected" and not c.reject_reason:
            c.reject_reason = "lower ranked"
    return sorted(chosen, key=lambda c: c.start)
