from fastapi.testclient import TestClient


def register(c: TestClient, email="pastor@example.com", org="Grace Church"):
    r = c.post("/api/auth/register", json={"email": email, "password": "password123", "name": "Pastor", "org_name": org})
    assert r.status_code == 200, r.text
    return r.json()


def upload(c: TestClient, data: bytes, name="sermon.mp4"):
    r = c.post("/api/uploads", json={"filename": name, "size": len(data)})
    assert r.status_code == 200, r.text
    up = r.json()
    chunk = 7  # tiny chunks to exercise resume logic
    off = 0
    while off < len(data):
        r = c.put(f"/api/uploads/{up['id']}?offset={off}", content=data[off:off + chunk])
        assert r.status_code == 200, r.text
        off = r.json()["received_bytes"]
    return up["id"]


def test_register_login_me_logout(client):
    out = register(client)
    assert out["user"]["role"] == "owner"
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "pastor@example.com", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "pastor@example.com", "password": "password123"}).status_code == 200
    assert client.get("/api/auth/me").json()["org"]["name"] == "Grace Church"


def test_upload_flow_creates_sermon_and_job(client):
    register(client)
    data = b"0123456789" * 5
    uid = upload(client, data)
    # wrong offset is rejected with the server's position (resume support)
    r = client.put(f"/api/uploads/{uid}?offset=3", content=b"xx")
    assert r.status_code in (409,)
    r = client.post(f"/api/uploads/{uid}/complete", json={"title": "Faith", "rights_confirmed": False})
    assert r.status_code == 400
    r = client.post(f"/api/uploads/{uid}/complete", json={"title": "Faith", "rights_confirmed": True,
                                                           "settings": {"modes": ["viral", "teaching"], "clip_lengths": [30]}})
    assert r.status_code == 200, r.text
    sermon = r.json()
    assert sermon["status"] == "queued"
    jobs = client.get("/api/jobs?active=true").json()
    assert jobs and jobs[0]["kind"] == "process_sermon"
    assert client.get("/api/stats").json()["sermons"] == 1


def test_rejects_bad_file_type(client):
    register(client)
    assert client.post("/api/uploads", json={"filename": "virus.exe", "size": 10}).status_code == 400


def test_tenant_isolation(client):
    register(client, "a@example.com", "Church A")
    uid = upload(client, b"x" * 20)
    sid = client.post(f"/api/uploads/{uid}/complete", json={"title": "A sermon", "rights_confirmed": True}).json()["id"]
    client.post("/api/auth/logout")
    register(client, "b@example.com", "Church B")
    assert client.get(f"/api/sermons/{sid}").status_code == 404
    assert client.get("/api/sermons").json() == []
    assert client.delete(f"/api/sermons/{sid}").status_code == 404


def test_folders_brand_templates(client):
    register(client)
    f = client.post("/api/folders", json={"name": "Sunday Services"}).json()
    assert client.get("/api/folders").json()[0]["name"] == "Sunday Services"
    kits = client.get("/api/brand-kits").json()
    assert len(kits) == 1 and kits[0]["is_default"]
    k2 = client.post("/api/brand-kits", json={"name": "Youth", "is_default": True}).json()
    kits = {k["id"]: k for k in client.get("/api/brand-kits").json()}
    assert kits[k2["id"]]["is_default"] and sum(k["is_default"] for k in kits.values()) == 1
    tpls = client.get("/api/templates").json()
    assert len(tpls) >= 5 and all(t["builtin"] for t in tpls)
    t = client.post("/api/templates", json={"name": "Mine", "style": {"font_size": 999, "position": "bogus"}}).json()
    assert t["style"]["font_size"] == 160 and t["style"]["position"] == "lower"
    assert client.delete(f"/api/folders/{f['id']}").status_code == 200


def test_team_members(client):
    register(client)
    r = client.post("/api/org/members", json={"email": "media@example.com", "name": "Media Team", "password": "password123"})
    assert r.status_code == 200
    assert len(client.get("/api/org/members").json()) == 2
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "media@example.com", "password": "password123"})
    # members can't add members
    assert client.post("/api/org/members", json={"email": "x@example.com", "name": "X", "password": "password123"}).status_code == 403


def _add_clips(org_id: str, sermon_id: str, n: int, tmp_path) -> list[str]:
    """Insert ready clips with real files on disk (as if the worker rendered them)."""
    from app.db import SessionLocal
    from app.jobs import enqueue
    from app.models import GeneratedClip
    ids = []
    with SessionLocal() as db:
        for i in range(n):
            v, t = tmp_path / f"clip{i}.mp4", tmp_path / f"clip{i}.jpg"
            v.write_bytes(b"video")
            t.write_bytes(b"thumb")
            c = GeneratedClip(org_id=org_id, sermon_id=sermon_id, title=f"Clip {i}", start_s=i * 10, end_s=i * 10 + 5,
                              status="ready", video_path=str(v), thumb_path=str(t))
            db.add(c)
            db.flush()
            enqueue(db, org_id, "render_clip", c.id)  # pending re-render that deletion must cancel
            ids.append(c.id)
        db.commit()
    return ids


def test_delete_single_and_bulk_clips(client, tmp_path):
    me = register(client, "a@example.com", "Church A")
    uid = upload(client, b"x" * 20)
    sid = client.post(f"/api/uploads/{uid}/complete", json={"title": "S", "rights_confirmed": True}).json()["id"]
    ids = _add_clips(me["org"]["id"], sid, 4, tmp_path)

    # single delete removes the row, its files and its queued render job
    assert client.delete(f"/api/clips/{ids[0]}").status_code == 200
    assert not (tmp_path / "clip0.mp4").exists() and not (tmp_path / "clip0.jpg").exists()
    assert client.get(f"/api/clips/{ids[0]}").status_code == 404
    jobs = {j["ref_id"]: j["status"] for j in client.get("/api/jobs").json() if j["kind"] == "render_clip"}
    assert jobs[ids[0]] == "failed" and jobs[ids[1]] == "queued"

    # bulk delete; an unknown id is skipped, not an error
    r = client.post("/api/clips/bulk-delete", json={"ids": [ids[1], ids[2], "no-such-clip"]})
    assert r.json() == {"deleted": 2, "not_found": 1}
    assert [c["id"] for c in client.get("/api/clips").json()] == [ids[3]]
    assert client.post("/api/clips/bulk-delete", json={"ids": []}).status_code == 422

    # another organisation can't delete these clips
    client.post("/api/auth/logout")
    register(client, "b@example.com", "Church B")
    assert client.post("/api/clips/bulk-delete", json={"ids": [ids[3]]}).json() == {"deleted": 0, "not_found": 1}
    assert client.delete(f"/api/clips/{ids[3]}").status_code == 404
    assert (tmp_path / "clip3.mp4").exists()


def test_delete_sermon_removes_clips(client, tmp_path):
    me = register(client)
    uid = upload(client, b"x" * 20)
    sid = client.post(f"/api/uploads/{uid}/complete", json={"title": "S", "rights_confirmed": True}).json()["id"]
    _add_clips(me["org"]["id"], sid, 2, tmp_path)
    assert client.delete(f"/api/sermons/{sid}").status_code == 200
    assert client.get(f"/api/sermons/{sid}").status_code == 404
    assert client.get("/api/clips").json() == []


def test_range_requests(client, tmp_path):
    from fastapi import Request

    from app.files import file_response
    p = tmp_path / "f.bin"
    p.write_bytes(bytes(range(100)))
    scope = {"type": "http", "headers": [(b"range", b"bytes=10-19")]}
    resp = file_response(Request(scope), p)
    assert resp.status_code == 206 and resp.headers["content-range"] == "bytes 10-19/100"
