"""Serving private media files with HTTP Range support (needed for video seeking)."""
import mimetypes
import os
import re
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

CHUNK = 1024 * 1024


def _iter_file(path: Path, start: int, length: int):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(CHUNK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def file_response(request: Request, path: str | Path | None, download_name: str | None = None,
                  media_type: str | None = None) -> Response:
    if not path or not Path(path).is_file():
        raise HTTPException(404, "File not found")
    path = Path(path)
    size = path.stat().st_size
    media_type = media_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    if download_name:
        safe = re.sub(r'[^\w\-. ]', "_", download_name)
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'

    rng = request.headers.get("range")
    if rng:
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if not m:
            raise HTTPException(416, "Bad range")
        s, e = m.groups()
        if s == "":
            start, end = max(0, size - int(e)), size - 1
        else:
            start = int(s)
            end = min(int(e), size - 1) if e else size - 1
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        length = end - start + 1
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)})
        return StreamingResponse(_iter_file(path, start, length), status_code=206, media_type=media_type, headers=headers)

    headers["Content-Length"] = str(size)
    return StreamingResponse(_iter_file(path, 0, size), media_type=media_type, headers=headers)


def safe_unlink(path: str | Path | None) -> None:
    try:
        if path:
            os.remove(path)
    except OSError:
        pass
