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


def test_range_requests(client, tmp_path):
    from fastapi import Request

    from app.files import file_response
    p = tmp_path / "f.bin"
    p.write_bytes(bytes(range(100)))
    scope = {"type": "http", "headers": [(b"range", b"bytes=10-19")]}
    resp = file_response(Request(scope), p)
    assert resp.status_code == 206 and resp.headers["content-range"] == "bytes 10-19/100"
