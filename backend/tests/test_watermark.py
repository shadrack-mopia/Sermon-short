import io
import sqlite3
from types import SimpleNamespace

from PIL import Image

from app.pipeline import watermark as wm


def kit(**kw):
    base = dict(watermark_text="@church", social_icons=["tiktok"], watermark_position="top-left",
                watermark_size=100, watermark_opacity=80, font=None)
    return SimpleNamespace(**{**base, **kw})


def test_spec_for_clip_uses_kit_then_overrides():
    s = wm.spec_for_clip(kit(), {"watermark": True})
    assert (s.text, s.icons, s.position, s.size, s.opacity) == ("@church", ["tiktok"], "top-left", 100, 80)
    s = wm.spec_for_clip(kit(), {"watermark": True, "wm_position": "center", "wm_size": 200, "wm_opacity": 50,
                                 "wm_icons": ["youtube", "instagram"]})
    assert (s.position, s.size, s.opacity, s.icons) == ("center", 200, 50, ["youtube", "instagram"])
    # icons can be switched off per clip, leaving just the text
    assert wm.spec_for_clip(kit(), {"watermark": True, "wm_icons": []}).icons == []
    # watermark off, no kit, or nothing to show -> no watermark
    assert wm.spec_for_clip(kit(), {"watermark": False}) is None
    assert wm.spec_for_clip(None, {"watermark": True}) is None
    assert wm.spec_for_clip(kit(watermark_text=None, social_icons=[]), {"watermark": True}) is None


def test_icons_only_and_clamping():
    s = wm.clamp_spec(text="", icons=["x", "x", "bogus", "whatsapp"], position="nowhere", size=999, opacity=1)
    assert s.icons == ["x", "whatsapp"] and s.position == "top-left" and s.size == 300 and s.opacity == 10
    assert not s.is_empty()


def test_overlay_positions():
    assert wm.overlay_xy("top-left", 40) == "40:40"
    assert wm.overlay_xy("center", 40) == "(W-w)/2:(H-h)/2"
    assert wm.overlay_xy("bottom-center", 40) == "(W-w)/2:H-h-40"
    assert wm.overlay_xy("middle-right", 40) == "W-w-40:(H-h)/2"
    assert len({wm.overlay_xy(p, 40) for p in wm.POSITIONS}) == 9


def test_image_scales_with_size_and_opacity():
    small = wm.build_image(wm.clamp_spec(text="@church", icons=["youtube"], size=50), 1080, 1920)
    big = wm.build_image(wm.clamp_spec(text="@church", icons=["youtube"], size=200), 1080, 1920)
    assert big.height > small.height * 3 and big.width > small.width * 3
    faint = wm.build_image(wm.clamp_spec(text="@church", opacity=20), 1080, 1920)
    solid = wm.build_image(wm.clamp_spec(text="@church", opacity=100), 1080, 1920)
    assert faint.getchannel("A").getextrema()[1] < solid.getchannel("A").getextrema()[1]
    for name in wm.SOCIAL_ICONS:
        assert wm.draw_icon(name, 40).getbbox() is not None  # every icon draws something


def test_brand_kit_watermark_api(client):
    client.post("/api/auth/register", json={"email": "p@example.com", "password": "password123", "name": "P"})
    k = client.get("/api/brand-kits").json()[0]
    assert (k["watermark_position"], k["watermark_size"], k["social_icons"]) == ("top-left", 100, [])
    r = client.patch(f"/api/brand-kits/{k['id']}", json={"watermark_text": "@grace", "watermark_position": "bottom-center",
                                                         "watermark_size": 150, "watermark_opacity": 60,
                                                         "social_icons": ["tiktok", "instagram"]})
    assert r.status_code == 200, r.text
    k = r.json()
    assert (k["watermark_position"], k["watermark_size"], k["watermark_opacity"], k["social_icons"]) == \
        ("bottom-center", 150, 60, ["tiktok", "instagram"])
    assert client.patch(f"/api/brand-kits/{k['id']}", json={"watermark_position": "somewhere"}).status_code == 422
    assert client.patch(f"/api/brand-kits/{k['id']}", json={"watermark_size": 1000}).status_code == 422
    assert client.patch(f"/api/brand-kits/{k['id']}", json={"social_icons": ["myspace"]}).status_code == 422

    r = client.get("/api/watermark/preview", params={"text": "@grace", "icons": "tiktok,instagram", "size": 150})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(r.content)).mode == "RGBA"
    assert client.get("/api/watermark/preview", params={"icons": "myspace"}).status_code == 400
    assert client.get("/api/watermark/preview").status_code == 400  # nothing to draw


def test_migration_upgrades_existing_database(tmp_path, monkeypatch):
    """A database created before watermark settings existed gets the new columns, keeping its data."""
    dbfile = tmp_path / "old.db"
    con = sqlite3.connect(dbfile)
    con.executescript("""
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME);
        INSERT INTO schema_version VALUES (1, '2026-11-01');
        CREATE TABLE organizations (id VARCHAR(36) PRIMARY KEY, created_at DATETIME, updated_at DATETIME,
            name VARCHAR(200), speaker_name VARCHAR(200), onboarded BOOLEAN, platforms JSON);
        INSERT INTO organizations VALUES ('o1', '2026-11-01', '2026-11-01', 'Grace', NULL, 1, '[]');
        CREATE TABLE brand_kits (id VARCHAR(36) PRIMARY KEY, created_at DATETIME, updated_at DATETIME,
            org_id VARCHAR(36), name VARCHAR(200), logo_path VARCHAR(500), colors JSON, font VARCHAR(100),
            watermark_text VARCHAR(200), logo_position VARCHAR(20), default_template_id VARCHAR(36),
            is_default BOOLEAN, auto_apply BOOLEAN);
        INSERT INTO brand_kits VALUES ('k1', '2026-11-01', '2026-11-01', 'o1', 'Grace', NULL, '{}', NULL,
            '@grace', 'top-right', NULL, 1, 1);
    """)
    con.commit()
    con.close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app import config, db
    config.get_settings.cache_clear()
    db.init_engine(f"sqlite:///{dbfile.as_posix()}")
    from app.migrations import migrate
    migrate()
    migrate()  # running twice is harmless
    db.engine().dispose()
    con = sqlite3.connect(dbfile)
    row = con.execute("select watermark_text, watermark_position, watermark_size, watermark_opacity, social_icons "
                      "from brand_kits where id='k1'").fetchone()
    versions = [v for (v,) in con.execute("select version from schema_version order by version")]
    con.close()
    config.get_settings.cache_clear()
    assert row == ("@grace", "top-left", 100, 80, "[]")
    assert versions == [1, 2]
