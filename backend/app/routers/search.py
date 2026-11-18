import re

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BibleReference, SearchChunk, Sermon
from ..pipeline.bible import parse_query_reference
from ..security import Ctx, current_ctx
from ..services.ollama import OllamaError, embed

router = APIRouter(tags=["search"])

STOP = set("""a an the of to in on for and or is are was were be about where when what who how find show me all
every moment moments pastor preacher talks talk talking discusses discuss sermon sermons teaching teachings strongest
best any some that this with from his her their our""".split())

# a little query expansion for common sermon themes (English + Swahili)
SYNONYMS = {
    "prayer": ["pray", "praying", "prayed", "maombi", "omba", "kuomba"],
    "faith": ["believe", "believing", "imani", "trust"],
    "forgiveness": ["forgive", "forgiven", "forgiving", "msamaha", "samehe"],
    "marriage": ["husband", "wife", "married", "ndoa", "spouse"],
    "fear": ["afraid", "anxiety", "worry", "hofu", "woga", "ogopa"],
    "money": ["finances", "financial", "tithe", "giving", "stewardship", "pesa", "fedha", "sadaka"],
    "stewardship": ["finances", "money", "tithe", "giving", "steward"],
    "love": ["upendo", "loved", "loves"],
    "hope": ["tumaini", "hopeful"],
    "grace": ["neema", "mercy", "rehema"],
    "healing": ["heal", "healed", "uponyaji", "pona"],
}


def _terms(q: str) -> list[str]:
    words = [w for w in re.findall(r"[a-zA-Z']+", q.lower()) if w not in STOP and len(w) > 2]
    out = list(words)
    for w in words:
        out += SYNONYMS.get(w, [])
    return list(dict.fromkeys(out))


@router.get("/search")
def search(q: str = Query(min_length=2, max_length=300), sermon_id: str | None = None,
           limit: int = Query(20, ge=1, le=50), ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)):
    titles = dict(db.execute(select(Sermon.id, Sermon.title).where(Sermon.org_id == ctx.org_id)).all())
    if sermon_id and sermon_id not in titles:
        raise HTTPException(404, "Sermon not found")

    hits: dict[tuple, dict] = {}

    # 1) Bible reference search (exact, from the reference index)
    ref = parse_query_reference(q)
    if ref:
        stmt = (select(BibleReference).join(Sermon, Sermon.id == BibleReference.sermon_id)
                .where(Sermon.org_id == ctx.org_id, BibleReference.book == ref.book))
        if ref.chapter:
            stmt = stmt.where(BibleReference.chapter == ref.chapter)
        if ref.verse_start:
            stmt = stmt.where((BibleReference.verse_start.is_(None)) | (BibleReference.verse_start <= (ref.verse_end or ref.verse_start)))
        if sermon_id:
            stmt = stmt.where(BibleReference.sermon_id == sermon_id)
        for r in db.scalars(stmt.limit(100)):
            start = max(0.0, r.start_s - 5)
            hits[(r.sermon_id, round(start))] = {
                "sermon_id": r.sermon_id, "sermon_title": titles.get(r.sermon_id), "start_s": start,
                "end_s": r.start_s + 40, "excerpt": r.context, "score": 1.0, "match": f"Bible: {r.reference}",
            }

    # 2) semantic + keyword search over transcript chunks
    stmt = select(SearchChunk).where(SearchChunk.org_id == ctx.org_id)
    if sermon_id:
        stmt = stmt.where(SearchChunk.sermon_id == sermon_id)
    chunks = db.scalars(stmt).all()
    semantic_ok = True
    if chunks:
        terms = _terms(q)
        kw = np.array([sum(1 for t in terms if re.search(rf"\b{re.escape(t)}", c.text.lower())) for c in chunks],
                      dtype=np.float32)
        kw = np.minimum(kw / max(1, min(3, len(terms))), 1.0)
        sims = np.zeros(len(chunks), dtype=np.float32)
        try:
            qv = embed([q], kind="query")[0]
            have = [i for i, c in enumerate(chunks) if c.embedding]
            if have:
                mat = np.stack([np.frombuffer(chunks[i].embedding, dtype=np.float32) for i in have])
                sims[have] = mat @ qv
        except OllamaError:
            semantic_ok = False
        score = (0.75 * sims + 0.25 * kw) if semantic_ok else kw
        for i in np.argsort(-score)[: limit * 2]:
            if score[i] <= (0.45 if semantic_ok else 0):
                continue
            c = chunks[i]
            key = (c.sermon_id, round(c.start_s))
            if key in hits:
                continue
            hits[key] = {"sermon_id": c.sermon_id, "sermon_title": titles.get(c.sermon_id), "start_s": c.start_s,
                         "end_s": c.end_s, "excerpt": c.text, "score": float(round(score[i], 3)),
                         "match": "meaning" if sims[i] >= kw[i] else "keyword"}

    # collapse overlapping hits within one sermon, keep best
    ordered = sorted(hits.values(), key=lambda h: -h["score"])
    final: list[dict] = []
    for h in ordered:
        if any(f["sermon_id"] == h["sermon_id"] and abs(f["start_s"] - h["start_s"]) < 20 for f in final):
            continue
        h["video_url"] = f"/api/sermons/{h['sermon_id']}/video"
        final.append(h)
        if len(final) >= limit:
            break
    return {"query": q, "semantic": semantic_ok, "reference": ref.reference if ref else None, "results": final}
