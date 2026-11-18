// Resumable chunked upload against the backend's /api/uploads protocol:
//   POST /api/uploads {filename,size} -> {id, chunk_size, received_bytes}
//   PUT  /api/uploads/{id}?offset=N   (raw bytes; 409 {detail:{received_bytes}} on offset mismatch)
//   DELETE /api/uploads/{id}          (abort)

import { api, detailToMessage } from "./api";

export const ALLOWED_EXT = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".wmv", ".mpg", ".mpeg", ".3gp"];

export function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export class ChunkError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(status === 0 ? "Network error" : detailToMessage(detail, status));
    this.status = status;
    this.detail = detail;
  }
}

export class UploadCanceled extends Error {
  constructor() {
    super("Upload canceled");
  }
}

export interface UploadProgress {
  received: number;
  speed: number; // bytes/second
  retrying?: { attempt: number; inSeconds: number; reason: string } | null;
}

export interface UploadHandle {
  promise: Promise<string>; // resolves with the upload id once all bytes are received
  cancel: () => Promise<void>;
}

function putChunk(id: string, offset: number, blob: Blob, onProgress: (loaded: number) => void, setXhr: (x: XMLHttpRequest | null) => void) {
  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    setXhr(xhr);
    xhr.open("PUT", `/api/uploads/${encodeURIComponent(id)}?offset=${offset}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      setXhr(null);
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const rb = (body as { received_bytes?: number } | null)?.received_bytes;
        resolve(typeof rb === "number" ? rb : offset + blob.size);
      } else reject(new ChunkError(xhr.status, (body as { detail?: unknown } | null)?.detail ?? null));
    };
    xhr.onerror = () => {
      setXhr(null);
      reject(new ChunkError(0, null));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      setXhr(null);
      reject(new UploadCanceled());
    };
    xhr.send(blob);
  });
}

const sleep = (ms: number, isCanceled: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (isCanceled()) return reject(new UploadCanceled());
      if (Date.now() - started >= ms) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  });

const MAX_RETRIES = 8;

export function startUpload(file: File, onProgress: (p: UploadProgress) => void, onId?: (id: string) => void): UploadHandle {
  let canceled = false;
  let xhr: XMLHttpRequest | null = null;
  let uploadId: string | null = null;

  const run = async (): Promise<string> => {
    const init = await api.post<{ id: string; chunk_size: number; received_bytes: number }>("/api/uploads", {
      filename: file.name,
      size: file.size,
    });
    uploadId = init.id;
    onId?.(init.id);
    if (canceled) throw new UploadCanceled();
    const chunk = Math.max(256 * 1024, init.chunk_size || 16 * 1024 * 1024);
    let offset = init.received_bytes || 0;
    let attempt = 0;
    let conflicts = 0;
    // speed: exponential moving average over chunk transfers
    let speed = 0;
    let lastT = performance.now();
    let lastBytes = offset;

    const report = (loadedInChunk: number, retrying: UploadProgress["retrying"] = null) => {
      const now = performance.now();
      const bytes = offset + loadedInChunk;
      const dt = (now - lastT) / 1000;
      if (dt >= 0.5) {
        const inst = (bytes - lastBytes) / dt;
        speed = speed ? speed * 0.7 + inst * 0.3 : inst;
        lastT = now;
        lastBytes = bytes;
      }
      onProgress({ received: bytes, speed: Math.max(0, speed), retrying });
    };

    while (offset < file.size) {
      if (canceled) throw new UploadCanceled();
      const blob = file.slice(offset, Math.min(file.size, offset + chunk));
      try {
        offset = await putChunk(init.id, offset, blob, (l) => report(l), (x) => (xhr = x));
        attempt = 0;
        report(0);
      } catch (e) {
        if (e instanceof UploadCanceled || canceled) throw new UploadCanceled();
        if (!(e instanceof ChunkError)) throw e;
        const d = e.detail as { received_bytes?: number } | null;
        if (e.status === 409 && d && typeof d === "object" && typeof d.received_bytes === "number" && conflicts < 10) {
          conflicts++;
          offset = d.received_bytes; // server tells us where to resume
          lastBytes = offset;
          continue;
        }
        if (e.status === 401) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- outside React, full reload intended
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
          throw e;
        }
        const retryable = e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES) throw e;
        const wait = Math.min(30, 2 ** attempt);
        attempt++;
        report(0, { attempt, inSeconds: wait, reason: e.message });
        await sleep(wait * 1000, () => canceled);
        // re-sync with the server in case the last chunk landed but the response was lost
        try {
          const st = await api.get<{ received_bytes: number }>(`/api/uploads/${init.id}`);
          offset = st.received_bytes;
          lastBytes = offset;
        } catch {
          /* keep offset; the PUT will 409 with the right one if needed */
        }
      }
    }
    return init.id;
  };

  return {
    promise: run(),
    cancel: async () => {
      canceled = true;
      xhr?.abort();
      if (uploadId) {
        try {
          await api.del(`/api/uploads/${uploadId}`);
        } catch {
          /* best effort */
        }
      }
    },
  };
}
