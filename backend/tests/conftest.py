import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-test-secret-key-123456")
    monkeypatch.setenv("ALLOW_REGISTRATION", "true")
    from app import config, db
    config.get_settings.cache_clear()
    db.init_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    from fastapi.testclient import TestClient

    from app.main import app
    from app.security import login_limiter
    login_limiter.hits.clear()
    with TestClient(app) as c:
        yield c
    db.engine().dispose()  # release the SQLite file so pytest can clean up tmp_path on Windows
    config.get_settings.cache_clear()
    os.environ.pop("DATA_DIR", None)
