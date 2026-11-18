"""End-to-end smoke test against a running API + worker.

Usage: python scripts/e2e_smoke.py <video.mp4> [--base http://127.0.0.1:8000]
Registers (or logs in) a test account, uploads the video in chunks, waits for
processing and rendering, then downloads every clip and checks it with ffprobe.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import httpx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="e2e@example.com")
    ap.add_argument("--lengths", default="30,60")
    ap.add_argument("--timeout", type=int, default=3600)
    a = ap.parse_args()

    c = httpx.Client(base_url=a.base, timeout=120)
    creds = {"email": a.email, "password": "e2e-password-123"}
    r = c.post("/api/auth/login", json=creds)
    if r.status_code != 200:
        r = c.post("/api/auth/register", json={**creds, "name": "E2E", "org_name": "E2E Church"})
        r.raise_for_status()
    print("signed in")

    size = os.path.getsize(a.video)
    up = c.post("/api/uploads", json={"filename": os.path.basename(a.video), "size": size}).json()
    off, cs = 0, up["chunk_size"]
    t0 = time.time()
    with open(a.video, "rb") as f:
        while off < size:
            f.seek(off)
            r = c.put(f"/api/uploads/{up['id']}", params={"offset": off}, content=f.read(cs),
                      headers={"Content-Type": "application/octet-stream"})
            r.raise_for_status()
            off = r.json()["received_bytes"]
    print(f"uploaded {size/1e6:.1f} MB in {time.time()-t0:.1f}s")
    lengths = [int(x) for x in a.lengths.split(",")]
    s = c.post(f"/api/uploads/{up['id']}/complete", json={
        "title": "E2E test sermon", "speaker": "Test", "rights_confirmed": True,
        "settings": {"modes": ["all"], "clip_lengths": lengths, "aspect": "9:16"}}).json()
    sid = s["id"]
    print("sermon", sid)

    t0, last = time.time(), None
    while True:
        d = c.get(f"/api/sermons/{sid}").json()
        state = (d["status"], d["stage"], d["progress"])
        if state != last:
            print(f"[{time.time()-t0:6.0f}s] {state}" + (f" job={d['job']}" if d.get("job") and d["job"].get("error") else ""))
            last = state
        if d["status"] == "failed":
            print("FAILED:", d["error"])
            sys.exit(1)
        if d["status"] == "ready" and d["clips_rendering"] == 0:
            break
        if time.time() - t0 > a.timeout:
            print("timeout")
            sys.exit(1)
        time.sleep(3)

    print("summary:", d["summary"])
    print("topics:", [t["name"] for t in d["topics"]])
    print("bible refs:", [b["reference"] for b in d["bible_references"]])
    clips = c.get("/api/clips", params={"sermon_id": sid}).json()
    print(f"{len(clips)} clips")
    out_dir = os.path.join(os.path.dirname(os.path.abspath(a.video)), "e2e_out")
    os.makedirs(out_dir, exist_ok=True)
    ok = True
    for cl in clips:
        print(f"- [{cl['score']:3}] {cl['status']:9} {cl['start_s']:7.1f}-{cl['end_s']:7.1f} ({cl['duration_s']:.0f}s) "
              f"{cl['category']}: {cl['title']}")
        if cl["status"] != "ready":
            print("   error:", cl["error"])
            ok = False
            continue
        r = c.get(cl["download_url"])
        r.raise_for_status()
        p = os.path.join(out_dir, f"{cl['id']}.mp4")
        open(p, "wb").write(r.content)
        info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", p],
                                         capture_output=True, text=True).stdout)
        v = next(x for x in info["streams"] if x["codec_type"] == "video")
        print(f"   downloaded {len(r.content)/1e6:.1f} MB {v['width']}x{v['height']} -> {p}")
    r = c.get("/api/search", params={"q": "prayer"}).json()
    print("search 'prayer':", [(round(h["start_s"]), h["match"], h["excerpt"][:60]) for h in r["results"][:3]],
          "semantic" if r["semantic"] else "keyword-only")
    r = c.get("/api/search", params={"q": "Romans 8:28"}).json()
    print("search 'Romans 8:28':", [(round(h["start_s"]), h["match"]) for h in r["results"][:3]])
    sys.exit(0 if ok and clips else 1)


if __name__ == "__main__":
    main()
