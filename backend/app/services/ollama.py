"""Thin client for a local Ollama server (LLM + embeddings). No data leaves the machine."""
import json
import time

import httpx
import numpy as np

from ..config import get_settings


class OllamaError(RuntimeError):
    pass


def _client(timeout: float = 600) -> httpx.Client:
    return httpx.Client(base_url=get_settings().ollama_url, timeout=timeout)


def health() -> dict:
    s = get_settings()
    try:
        with _client(5) as c:
            tags = c.get("/api/tags").json()
        names = {m["name"] for m in tags.get("models", [])}
        has = lambda m: m in names or f"{m}:latest" in names  # noqa: E731
        return {"ok": True, "llm": has(s.llm_model), "embed": has(s.embed_model)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def chat_json(system: str, user: str, schema: dict, temperature: float = 0.3, keep_alive: str | int = "5m",
              retries: int = 2) -> dict:
    """Ask the LLM for JSON constrained by a JSON schema. Raises OllamaError on failure (never fakes output)."""
    s = get_settings()
    body = {
        "model": s.llm_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "format": schema,
        "stream": False,
        "keep_alive": keep_alive,
        "options": {"temperature": temperature, "num_ctx": s.llm_num_ctx},
    }
    last = None
    for attempt in range(retries + 1):
        try:
            with _client() as c:
                r = c.post("/api/chat", json=body)
            if r.status_code != 200:
                raise OllamaError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
            content = r.json()["message"]["content"]
            return json.loads(content)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError, OllamaError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise OllamaError(f"LLM request failed: {last}. Is Ollama running and is '{s.llm_model}' pulled?")


def unload_llm() -> None:
    """Free GPU memory so Whisper can use it."""
    try:
        with _client(30) as c:
            c.post("/api/generate", json={"model": get_settings().llm_model, "keep_alive": 0})
    except httpx.HTTPError:
        pass


def embed(texts: list[str], kind: str = "document", batch: int = 32) -> np.ndarray:
    """Return L2-normalised float32 embeddings. kind: 'document' | 'query' (nomic prefixes)."""
    s = get_settings()
    prefix = "search_query: " if kind == "query" else "search_document: "
    vecs = []
    for i in range(0, len(texts), batch):
        chunk = [prefix + t for t in texts[i:i + batch]]
        try:
            with _client(300) as c:
                r = c.post("/api/embed", json={"model": s.embed_model, "input": chunk, "keep_alive": "2m"})
            r.raise_for_status()
            vecs.extend(r.json()["embeddings"])
        except (httpx.HTTPError, KeyError) as e:
            raise OllamaError(f"Embedding failed: {e}. Is '{s.embed_model}' pulled?") from e
    arr = np.asarray(vecs, dtype=np.float32)
    if arr.size:
        arr /= np.linalg.norm(arr, axis=1, keepdims=True) + 1e-9
    return arr
