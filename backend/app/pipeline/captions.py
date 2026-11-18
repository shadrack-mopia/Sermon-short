"""Build animated ASS subtitles (word-highlight / pop / plain) for a clip."""

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{styles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ass_color(hex_color: str, alpha: int = 0) -> str:
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def chunk_words(words: list[list], per_line: int, max_chars: int) -> list[list[list]]:
    chunks, cur = [], []
    for i, w in enumerate(words):
        if cur:
            gap = w[0] - cur[-1][1]
            chars = sum(len(x[2]) + 1 for x in cur) + len(w[2])
            ends_sentence = cur[-1][2].endswith((".", "?", "!", ",", ";", ":"))
            if len(cur) >= per_line or gap > 0.6 or chars > max_chars or (ends_sentence and len(cur) >= max(1, per_line // 2)):
                chunks.append(cur)
                cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def build_ass(words: list[list], style: dict, width: int, height: int, duration: float,
              show_captions: bool = True, watermark: str | None = None, watermark_pos: str = "top-left") -> str:
    """words: [[start, end, text], ...] relative to clip start (seconds)."""
    scale = min(width, height) / 1080
    fs = int(style.get("font_size", 72) * scale)
    outline = style.get("outline", 4) * scale
    shadow = style.get("shadow", 0) * scale
    primary = ass_color(style.get("primary_color", "#FFFFFF"))
    highlight = ass_color(style.get("highlight_color", "#FFD400"))
    outline_c = ass_color(style.get("outline_color", "#000000"))
    border_style = 1
    back = ass_color("#000000", 0x80)
    if style.get("bg_box"):
        border_style = 3
        outline_c = ass_color(style.get("bg_color", "#000000"), 0x40)
        outline = max(8, int(14 * scale))
        shadow = 0
    pos = style.get("position", "lower")
    align, margin_v = {"bottom": (2, int(height * 0.07)), "lower": (2, int(height * 0.22)),
                       "middle": (5, 0), "top": (8, int(height * 0.12))}.get(pos, (2, int(height * 0.22)))
    margin_h = int(width * 0.07)
    font = style.get("font", "Arial Black")
    styles = [
        f"Style: Cap,{font},{fs},{primary},{highlight},{outline_c},{back},-1,0,0,0,100,100,0,0,"
        f"{border_style},{outline:.1f},{shadow:.1f},{align},{margin_h},{margin_h},{margin_v},1",
        f"Style: Mark,Segoe UI Semibold,{int(34 * scale)},{ass_color('#FFFFFF', 0x60)},{primary},"
        f"{ass_color('#000000', 0xA0)},{back},-1,0,0,0,100,100,0,0,1,{2 * scale:.1f},0,"
        f"{ {'top-left': 7, 'top-right': 9, 'bottom-left': 1, 'bottom-right': 3}.get(watermark_pos, 7) },"
        f"{int(40 * scale)},{int(40 * scale)},{int(40 * scale)},1",
    ]
    out = [ASS_HEADER.format(w=width, h=height, styles="\n".join(styles))]

    if watermark:
        out.append(f"Dialogue: 1,{ass_time(0)},{ass_time(duration)},Mark,,0,0,0,,{esc(watermark)}")

    if show_captions and words:
        upper = style.get("uppercase", False)
        anim = style.get("animation", "highlight")
        per_line = max(1, int(style.get("words_per_line", 3)))
        # characters that fit on one line: ~0.55*fs px per char across the usable width
        fit = int((width - 2 * margin_h) / (0.55 * fs)) if fs else 30
        max_chars = max(10, min(fit, per_line * 9))
        chunks = chunk_words(words, per_line, max_chars)
        hl_tag = "{\\c" + highlight + "&\\fscx108\\fscy108}"
        reset = "{\\c" + primary + "&\\fscx100\\fscy100}"
        for ci, ch in enumerate(chunks):
            texts = [esc(w[2].upper() if upper else w[2]) for w in ch]
            chunk_end = ch[-1][1]
            nxt = chunks[ci + 1][0][0] if ci + 1 < len(chunks) else duration
            if nxt - chunk_end < 0.6:
                chunk_end = nxt
            chunk_end = min(chunk_end, duration)
            if anim == "none":
                out.append(f"Dialogue: 0,{ass_time(ch[0][0])},{ass_time(chunk_end)},Cap,,0,0,0,,{' '.join(texts)}")
                continue
            for wi, w in enumerate(ch):
                st = w[0] if wi else ch[0][0]
                en = ch[wi + 1][0] if wi + 1 < len(ch) else chunk_end
                if en <= st:
                    continue
                if anim == "pop":
                    parts = [("{\\fscx70\\fscy70\\t(0,90,\\fscx100\\fscy100)\\c" + highlight + "&}" + t + reset)
                             if k == wi else t for k, t in enumerate(texts)]
                    if per_line == 1:
                        parts = ["{\\fscx70\\fscy70\\t(0,90,\\fscx100\\fscy100)}" + texts[wi]]
                else:
                    parts = [(hl_tag + t + reset) if k == wi else t for k, t in enumerate(texts)]
                out.append(f"Dialogue: 0,{ass_time(st)},{ass_time(en)},Cap,,0,0,0,,{' '.join(parts)}")
    return "\n".join(out) + "\n"
