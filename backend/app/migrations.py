"""Versioned schema migrations.

Version 1 creates the full schema from the SQLAlchemy models. Future schema
changes are appended to MIGRATIONS as (version, [sql, ...]) and applied once.
"""
import re

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import models  # noqa: F401  (register tables)
from .db import Base, SessionLocal, engine
from .models import ClipTemplate, SchemaVersion

def _grid_position_sql() -> list[str]:
    """Convert old position names ('top-left', 'center', ...) to grid cells in brand kits and clip overrides."""
    from .pipeline.watermark import LEGACY_POSITIONS
    case = lambda expr: "CASE " + expr + " " + " ".join(  # noqa: E731
        f"WHEN '{old}' THEN '{new}'" for old, new in LEGACY_POSITIONS.items()) + f" ELSE {expr} END"
    olds = ", ".join(f"'{o}'" for o in LEGACY_POSITIONS)
    wm = "json_extract(options, '$.wm_position')"
    return [
        f"UPDATE brand_kits SET watermark_position = {case('watermark_position')}",
        f"UPDATE brand_kits SET logo_position = {case('logo_position')}",
        f"UPDATE generated_clips SET options = json_set(options, '$.wm_position', {case(wm)}) WHERE {wm} IN ({olds})",
    ]


MIGRATIONS: list[tuple[int, list[str]]] = [
    (2, [  # watermark position / size / opacity and social-media icons on brand kits
        "ALTER TABLE brand_kits ADD COLUMN watermark_position VARCHAR(20) NOT NULL DEFAULT 'top-left'",  # -> r0c0 in v3
        "ALTER TABLE brand_kits ADD COLUMN watermark_size INTEGER NOT NULL DEFAULT 100",
        "ALTER TABLE brand_kits ADD COLUMN watermark_opacity INTEGER NOT NULL DEFAULT 80",
        "ALTER TABLE brand_kits ADD COLUMN social_icons JSON NOT NULL DEFAULT '[]'",
    ]),
    (3, _grid_position_sql()),  # named corners/centre -> 6x3 grid cells (r{row}c{col})
]

_ADD_COLUMN = re.compile(r"ALTER TABLE (\w+) ADD COLUMN (\w+)", re.I)


def _column_exists(db: Session, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(text(f"PRAGMA table_info({table})")))

BUILTIN_TEMPLATES = [
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "Bold Highlight",
        "style": {
            "font": "Arial Black", "font_size": 84, "primary_color": "#FFFFFF",
            "highlight_color": "#FFD400", "outline_color": "#000000", "outline": 5,
            "shadow": 2, "bg_box": False, "bg_color": "#000000", "uppercase": True,
            "words_per_line": 3, "position": "lower", "animation": "highlight",
        },
    },
    {
        "id": "00000000-0000-0000-0000-000000000002",
        "name": "Clean Box",
        "style": {
            "font": "Segoe UI Semibold", "font_size": 70, "primary_color": "#FFFFFF",
            "highlight_color": "#8B5CF6", "outline_color": "#000000", "outline": 0,
            "shadow": 0, "bg_box": True, "bg_color": "#000000", "uppercase": False,
            "words_per_line": 5, "position": "lower", "animation": "highlight",
        },
    },
    {
        "id": "00000000-0000-0000-0000-000000000003",
        "name": "Gospel Gold",
        "style": {
            "font": "Georgia", "font_size": 78, "primary_color": "#FFFFFF",
            "highlight_color": "#E8B931", "outline_color": "#1A1A2E", "outline": 4,
            "shadow": 3, "bg_box": False, "bg_color": "#000000", "uppercase": False,
            "words_per_line": 4, "position": "middle", "animation": "highlight",
        },
    },
    {
        "id": "00000000-0000-0000-0000-000000000004",
        "name": "One Word Pop",
        "style": {
            "font": "Impact", "font_size": 96, "primary_color": "#FFFFFF",
            "highlight_color": "#22D3EE", "outline_color": "#000000", "outline": 6,
            "shadow": 0, "bg_box": False, "bg_color": "#000000", "uppercase": True,
            "words_per_line": 1, "position": "middle", "animation": "pop",
        },
    },
    {
        "id": "00000000-0000-0000-0000-000000000005",
        "name": "Minimal",
        "style": {
            "font": "Segoe UI", "font_size": 64, "primary_color": "#FFFFFF",
            "highlight_color": "#FFFFFF", "outline_color": "#000000", "outline": 3,
            "shadow": 1, "bg_box": False, "bg_color": "#000000", "uppercase": False,
            "words_per_line": 6, "position": "bottom", "animation": "none",
        },
    },
]

DEFAULT_TEMPLATE_ID = BUILTIN_TEMPLATES[0]["id"]


def migrate() -> None:
    eng = engine()
    Base.metadata.create_all(eng)
    with SessionLocal() as db:
        current = db.scalar(select(SchemaVersion.version).order_by(SchemaVersion.version.desc()).limit(1))
        if current is None:
            db.add(SchemaVersion(version=1))
            current = 1
        for version, statements in MIGRATIONS:
            if version > current:
                for sql in statements:
                    m = _ADD_COLUMN.match(sql)
                    if m and _column_exists(db, m.group(1), m.group(2)):
                        continue  # new databases already have it (create_all built the full schema)
                    db.execute(text(sql))
                db.add(SchemaVersion(version=version))
        _seed_templates(db)
        db.commit()


def _seed_templates(db: Session) -> None:
    for t in BUILTIN_TEMPLATES:
        row = db.get(ClipTemplate, t["id"])
        if row is None:
            db.add(ClipTemplate(id=t["id"], org_id=None, name=t["name"], style=t["style"]))
        else:
            row.name, row.style = t["name"], t["style"]
