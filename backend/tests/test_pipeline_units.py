from app.pipeline import analysis
from app.pipeline.bible import find_references, parse_query_reference
from app.pipeline.boundaries import fit_duration, flatten_words, snap_range
from app.pipeline.captions import build_ass, chunk_words
from app.pipeline.render import crop_geometry, x_expression


def _words(sentences, gap=0.1, wdur=0.3):
    """Build whisper-like segments from a list of sentences."""
    t, segs = 0.0, []
    for s in sentences:
        ws = []
        for tok in s.split():
            ws.append([t, t + wdur, tok, 0.9])
            t += wdur + gap
        segs.append({"words": ws})
        t += 0.3
    return segs


SENTENCES = [
    "Good morning church.",
    "Today we talk about faith.",
    "Faith is trusting God when you cannot see the way.",
    "Abraham went out not knowing where he was going.",
    "And God was faithful to him.",
    "He will be faithful to you too.",
]


def test_flatten_marks_sentence_boundaries():
    w = flatten_words(_words(SENTENCES))
    assert w[0].sent_start and w[2].sent_end  # "Good morning church."
    assert w[3].sent_start and w[3].text == "Today"


def test_snap_range_never_cuts_mid_sentence():
    w = flatten_words(_words(SENTENCES))
    # pick a start in the middle of sentence 3 and an end mid-sentence 4
    mid3 = next(x for x in w if x.text == "trusting").start
    mid4 = next(x for x in w if x.text == "knowing").end
    start, end = snap_range(w, mid3, mid4)
    first = next(x for x in w if x.start >= start)
    last = [x for x in w if x.end <= end][-1]
    assert first.sent_start
    assert last.sent_end


def test_fit_duration_trims_and_extends():
    w = flatten_words(_words(SENTENCES))
    full = (0, len(w) - 1)
    total = w[-1].end - w[0].start
    trimmed = fit_duration(w, *full, min_s=3, max_s=total / 2)
    assert trimmed and w[trimmed[1]].end - w[trimmed[0]].start <= total / 2
    assert w[trimmed[1]].sent_end
    short = fit_duration(w, 0, 2, min_s=6, max_s=total)
    assert short and w[short[1]].end - w[short[0]].start >= 6
    assert fit_duration(w, 0, 2, min_s=total + 5, max_s=total + 10) is None


def test_bible_references_written_and_spoken():
    refs = {r.reference for r in find_references(
        "Turn with me to John 3:16. Then Psalm 23. Also first Corinthians chapter 13 verse 4 to 7, "
        "and Romans 8:28. Kwa Kiswahili, Yohana 14:6 na Zaburi sura ya 91.")}
    assert "John 3:16" in refs
    assert "1 Corinthians 13:4-7" in refs
    assert "Romans 8:28" in refs
    assert "John 14:6" in refs
    assert "Psalm 91" in refs


def test_bible_ambiguous_words_need_verse():
    assert not find_references("Mark 5 people came to the meeting")
    assert parse_query_reference("Find all references to Psalm 23").reference == "Psalm 23"


def test_duration_range_and_target_count():
    assert analysis.duration_range({"clip_lengths": [30, 60]}) == (22.5, 80.0)
    assert analysis.duration_range({"min_s": 20, "max_s": 40}) == (20.0, 40.0)
    assert analysis.target_count(60 * 60, 0) == 12
    assert analysis.target_count(10 * 60, 0) == 5
    assert analysis.target_count(4 * 3600, 0) == 15
    assert analysis.target_count(3600, 7) == 7


def _cand(start, end, score, cat="inspirational", title="t"):
    c = analysis.Candidate(start, end, title, cat, "", "", "", [], {k: 5 for k in analysis.SCORE_KEYS})
    c.score = score
    return c


def test_dedupe_by_overlap_and_select_variety():
    cands = [_cand(0, 30, 90, title="a"), _cand(5, 35, 80, title="b"), _cand(100, 130, 70, title="c"),
             _cand(200, 230, 60, cat="biblical_teaching", title="d")]
    analysis.dedupe(cands, use_embeddings=False)
    assert cands[1].status == "duplicate"
    chosen = analysis.select(cands, 3)
    assert [c.title for c in chosen] == ["a", "c", "d"]


def test_scoring_rewards_good_scores():
    hi = _cand(0, 30, 0)
    hi.scores = {k: 9 for k in analysis.SCORE_KEYS}
    hi.breakdown = {"_bounds": (True, True), "_audio": 0.9}
    lo = _cand(0, 30, 0)
    lo.scores = {k: 3 for k in analysis.SCORE_KEYS}
    lo.breakdown = {"_bounds": (False, False), "_audio": 0.5}
    analysis.score([hi, lo], ["viral"])
    assert 80 < hi.score <= 100 and lo.score < 30
    assert "opening_hook" in hi.breakdown


def test_windows_cover_whole_sermon():
    segs = [analysis.Seg(i, i * 10.0, i * 10.0 + 9, f"s{i}") for i in range(200)]  # ~33 min
    wins = analysis.make_windows(segs)
    covered = {s.idx for w in wins for s in w}
    assert covered == set(range(200))
    assert len(wins) >= 5


def test_captions_ass_highlight():
    words = [[0.0, 0.4, "Faith"], [0.5, 0.8, "is"], [0.9, 1.4, "trusting"], [1.5, 2.0, "God."]]
    ass = build_ass(words, {"words_per_line": 3, "animation": "highlight", "uppercase": True}, 1080, 1920, 3.0,
                    watermark="Grace Church")
    assert "PlayResX: 1080" in ass and "FAITH" in ass
    assert ass.count("Dialogue: 0") == 4  # one event per word
    assert "Grace Church" in ass
    assert len(chunk_words(words, 2, 40)) == 2


def test_crop_geometry_and_expression():
    assert crop_geometry(1920, 1080, "9:16") == (606, 1080)
    assert crop_geometry(1920, 1080, "16:9") == (1920, 1080)
    assert x_expression(None, None, 1920, 606) == str(int(960 - 303))
    expr = x_expression([(0, 0.3), (5, 0.7)], None, 1920, 606)
    assert expr.startswith("if(lt(t,5.00)")
