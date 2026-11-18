"""Detect Bible references in English and Swahili transcripts.

Handles written forms ("John 3:16", "1 Cor 13:4-7", "Yohana 3:16") and the way
preachers say them ("John chapter 3 verse 16", "Psalm 23", "first Corinthians
13", "Zaburi sura ya 23 mstari wa 1").
"""
import re
from dataclasses import dataclass

# canonical name -> aliases (lower case). Numbered books use {n} for the number.
BOOKS: dict[str, list[str]] = {
    "Genesis": ["genesis", "gen", "mwanzo"], "Exodus": ["exodus", "exod", "kutoka"],
    "Leviticus": ["leviticus", "lev", "mambo ya walawi", "walawi"], "Numbers": ["numbers", "hesabu"],
    "Deuteronomy": ["deuteronomy", "deut", "kumbukumbu la torati", "kumbukumbu"],
    "Joshua": ["joshua", "yoshua"], "Judges": ["judges", "waamuzi"], "Ruth": ["ruth", "ruthu"],
    "{n} Samuel": ["{n} samuel", "{n} sam", "{n} samweli"], "{n} Kings": ["{n} kings", "{n} wafalme"],
    "{n} Chronicles": ["{n} chronicles", "{n} chron", "{n} mambo ya nyakati", "{n} nyakati"],
    "Ezra": ["ezra"], "Nehemiah": ["nehemiah", "nehemia"], "Esther": ["esther", "esta"], "Job": ["job", "ayubu"],
    "Psalm": ["psalms", "psalm", "ps", "zaburi"], "Proverbs": ["proverbs", "prov", "mithali"],
    "Ecclesiastes": ["ecclesiastes", "eccl", "mhubiri"], "Song of Solomon": ["song of solomon", "song of songs", "wimbo ulio bora"],
    "Isaiah": ["isaiah", "isa", "isaya"], "Jeremiah": ["jeremiah", "jer", "yeremia"],
    "Lamentations": ["lamentations", "maombolezo"], "Ezekiel": ["ezekiel", "ezek", "ezekieli"],
    "Daniel": ["daniel", "danieli"], "Hosea": ["hosea"], "Joel": ["joel", "yoeli"], "Amos": ["amos", "amosi"],
    "Obadiah": ["obadiah", "obadia"], "Jonah": ["jonah", "yona"], "Micah": ["micah", "mika"], "Nahum": ["nahum", "nahumu"],
    "Habakkuk": ["habakkuk", "habakuki"], "Zephaniah": ["zephaniah", "sefania"], "Haggai": ["haggai", "hagai"],
    "Zechariah": ["zechariah", "zekaria"], "Malachi": ["malachi", "malaki"],
    "Matthew": ["matthew", "matt", "mathayo"], "Mark": ["mark", "marko"], "Luke": ["luke", "luka"],
    "John": ["john", "yohana"], "Acts": ["acts", "matendo ya mitume", "matendo"],
    "Romans": ["romans", "rom", "warumi"], "{n} Corinthians": ["{n} corinthians", "{n} cor", "{n} wakorintho"],
    "Galatians": ["galatians", "gal", "wagalatia"], "Ephesians": ["ephesians", "eph", "waefeso"],
    "Philippians": ["philippians", "phil", "wafilipi"], "Colossians": ["colossians", "col", "wakolosai"],
    "{n} Thessalonians": ["{n} thessalonians", "{n} thess", "{n} wathesalonike"],
    "{n} Timothy": ["{n} timothy", "{n} tim", "{n} timotheo"], "Titus": ["titus", "tito"],
    "Philemon": ["philemon", "filemoni"], "Hebrews": ["hebrews", "heb", "waebrania"],
    "James": ["james", "yakobo"], "{n} Peter": ["{n} peter", "{n} pet", "{n} petro"],
    "{n} John": ["{n} john", "{n} yohana"], "Jude": ["jude", "yuda"],
    "Revelation": ["revelation", "revelations", "rev", "ufunuo"],
}

ORDINALS = {"1": ["1", "1st", "first", "i", "one", "kwanza"], "2": ["2", "2nd", "second", "ii", "two", "pili"],
            "3": ["3", "3rd", "third", "iii", "three", "tatu"]}
NUMBERED_MAX = {"{n} Samuel": 2, "{n} Kings": 2, "{n} Chronicles": 2, "{n} Corinthians": 2, "{n} Thessalonians": 2,
                "{n} Timothy": 2, "{n} Peter": 2, "{n} John": 3}

NUM_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen twenty".split())}


def _alias_table() -> list[tuple[str, str]]:
    table = []
    for canon, aliases in BOOKS.items():
        if "{n}" in canon:
            for n in range(1, NUMBERED_MAX[canon] + 1):
                for ordw in ORDINALS[str(n)]:
                    for a in aliases:
                        alias = a.replace("{n}", ordw)
                        table.append((alias, canon.replace("{n}", str(n))))
                        if ordw == "kwanza" or ordw == "pili" or ordw == "tatu":
                            table.append((a.replace("{n} ", "") + " " + ordw, canon.replace("{n}", str(n))))
        else:
            table.extend((a, canon) for a in aliases)
    table.sort(key=lambda x: -len(x[0]))  # longest alias first
    return table


ALIASES = _alias_table()
_book_re = "|".join(re.escape(a) for a, _ in ALIASES)
_num = r"(\d{1,3}|" + "|".join(sorted(NUM_WORDS, key=len, reverse=True)) + r")"
REF_RE = re.compile(
    rf"\b(?P<book>{_book_re})\.?\s+"
    rf"(?:(?:chapter|ch\.?|sura\s+ya|sura)\s+)?(?P<ch>{_num})"
    rf"(?:\s*(?::|\.|,?\s+(?:verses?|vs?\.?|mstari\s+wa|mistari|mstari)\s+)\s*(?P<v1>{_num})"
    rf"(?:\s*(?:-|–|to|through|hadi|mpaka)\s*(?P<v2>{_num}))?)?",
    re.IGNORECASE,
)
ALIAS_MAP = {a: c for a, c in ALIASES}
# short aliases that are common English words need an explicit chapter AND verse
AMBIGUOUS = {"job", "mark", "acts", "numbers", "judges", "james", "john", "ps", "rev", "col", "gal", "rom", "phil",
             "heb", "isa", "jer", "gen", "lev", "eph", "tim", "pet", "sam", "cor", "amos", "mika", "tito", "luke"}


@dataclass
class Ref:
    reference: str
    book: str
    chapter: int | None
    verse_start: int | None
    verse_end: int | None
    pos: int


def _to_int(s: str | None) -> int | None:
    if not s:
        return None
    s = s.lower()
    return int(s) if s.isdigit() else NUM_WORDS.get(s)


def find_references(text: str) -> list[Ref]:
    out = []
    for m in REF_RE.finditer(text):
        alias = m.group("book").lower()
        book = ALIAS_MAP.get(alias)
        if not book:
            continue
        ch, v1, v2 = _to_int(m.group("ch")), _to_int(m.group("v1")), _to_int(m.group("v2"))
        if not ch or ch > 150:
            continue
        if alias in AMBIGUOUS and v1 is None and not re.search(r"chapter|sura", m.group(0), re.I):
            continue  # "Mark 5" could be a name; require a verse or the word "chapter"
        if v2 is not None and v1 is not None and v2 < v1:
            v2 = None
        ref = f"{book} {ch}" + (f":{v1}" if v1 else "") + (f"-{v2}" if v2 else "")
        out.append(Ref(ref, book, ch, v1, v2, m.start()))
    return out


def parse_query_reference(q: str) -> Ref | None:
    refs = find_references(q)
    if refs:
        return refs[0]
    # a bare book name in a query ("Psalm") is fine
    ql = q.lower()
    for alias, canon in ALIASES:
        if re.search(rf"\b{re.escape(alias)}\b", ql) and alias not in AMBIGUOUS:
            return Ref(canon, canon, None, None, None, 0)
    return None
