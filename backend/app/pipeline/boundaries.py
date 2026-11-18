"""Sentence-aware clip boundary helpers (pure functions, unit tested).

Words come from Whisper as [start, end, text, prob]. A clip should start at
the beginning of a sentence and end at the end of one, so the speaker's thought
is never cut mid-sentence.
"""
from dataclasses import dataclass

END_PUNCT = (".", "?", "!", "…", '."', '?"', '!"', ".”", "?”", "!”")


@dataclass
class Word:
    start: float
    end: float
    text: str
    prob: float = 1.0
    sent_start: bool = False
    sent_end: bool = False


def flatten_words(segments: list) -> list[Word]:
    """segments: iterable of objects/dicts with .words / ['words'] lists."""
    out: list[Word] = []
    for seg in segments:
        words = seg["words"] if isinstance(seg, dict) else seg.words
        for w in words or []:
            text = str(w[2]).strip()
            if not text:
                continue
            out.append(Word(float(w[0]), float(w[1]), text, float(w[3]) if len(w) > 3 else 1.0))
    for i, w in enumerate(out):
        w.sent_end = w.text.endswith(END_PUNCT)
        prev = out[i - 1] if i else None
        # a long pause also counts as a sentence break (speech often lacks punctuation)
        w.sent_start = prev is None or prev.sent_end or (w.start - prev.end) > 1.2
        if prev and (w.start - prev.end) > 1.2:
            prev.sent_end = True
    return out


def _nearest(cands: list[tuple[float, int]], t: float) -> int | None:
    return min(cands, key=lambda c: abs(c[0] - t))[1] if cands else None


def snap_start(words: list[Word], t: float, back: float = 10.0, fwd: float = 4.0) -> int:
    cands = [(w.start, i) for i, w in enumerate(words) if w.sent_start and t - back <= w.start <= t + fwd]
    idx = _nearest(cands, t)
    if idx is None:
        idx = _nearest([(w.start, i) for i, w in enumerate(words)], t) or 0
    return idx


def snap_end(words: list[Word], t: float, back: float = 4.0, fwd: float = 10.0) -> int:
    cands = [(w.end, i) for i, w in enumerate(words) if w.sent_end and t - back <= w.end <= t + fwd]
    idx = _nearest(cands, t)
    if idx is None:
        idx = _nearest([(w.end, i) for i, w in enumerate(words)], t)
        idx = len(words) - 1 if idx is None else idx
    return idx


def padded_range(words: list[Word], i0: int, i1: int) -> tuple[float, float]:
    """Add a little breathing room without bleeding into neighbouring words."""
    start = words[i0].start - 0.2
    if i0 > 0:
        start = max(start, (words[i0 - 1].end + words[i0].start) / 2)
    end = words[i1].end + 0.4
    if i1 + 1 < len(words):
        end = min(end, (words[i1].end + words[i1 + 1].start) / 2 + 0.05)
    return max(0.0, round(start, 2)), round(end, 2)


def fit_duration(words: list[Word], i0: int, i1: int, min_s: float, max_s: float) -> tuple[int, int] | None:
    """Adjust [i0, i1] so it lasts between min_s and max_s, moving only to sentence
    boundaries. Prefers trimming/extending the end. Returns None if impossible."""
    def dur(a, b):
        return words[b].end - words[a].start

    if dur(i0, i1) > max_s:
        # trim the end back to the latest sentence end that fits
        ends = [j for j in range(i0, i1 + 1) if words[j].sent_end and min_s <= dur(i0, j) <= max_s]
        if ends:
            return i0, ends[-1]
        # try starting later at a sentence start
        for a in range(i0 + 1, i1):
            if words[a].sent_start:
                ends = [j for j in range(a, i1 + 1) if words[j].sent_end and min_s <= dur(a, j) <= max_s]
                if ends:
                    return a, ends[-1]
        return None
    if dur(i0, i1) < min_s:
        # extend the end forward to the first sentence end that satisfies min_s
        for j in range(i1 + 1, len(words)):
            if dur(i0, j) > max_s:
                break
            if words[j].sent_end and dur(i0, j) >= min_s:
                return i0, j
        # or extend the start backwards
        for a in range(i0 - 1, -1, -1):
            if dur(a, i1) > max_s:
                break
            if words[a].sent_start and dur(a, i1) >= min_s:
                return a, i1
        return None
    return i0, i1


def snap_range(words: list[Word], start: float, end: float) -> tuple[float, float]:
    if not words:
        return start, end
    i0 = snap_start(words, start)
    i1 = snap_end(words, end)
    if i1 < i0:
        i1 = i0
    return padded_range(words, i0, i1)


def words_between(words: list[Word], start: float, end: float) -> list[Word]:
    return [w for w in words if w.start >= start - 0.05 and w.end <= end + 0.3]


def text_between(words: list[Word], start: float, end: float) -> str:
    return " ".join(w.text for w in words_between(words, start, end))
