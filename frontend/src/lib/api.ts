// Thin fetch wrapper for the FastAPI backend. Everything is same-origin `/api/...`
// (proxied by next.config rewrites) and authenticated by an httpOnly cookie.

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

interface ValidationItem {
  loc?: (string | number)[];
  msg?: string;
}

/** Turn any FastAPI `detail` (string, object, pydantic list) into a readable sentence. */
export function detailToMessage(detail: unknown, status?: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d: ValidationItem) => {
      const loc = (d.loc ?? []).filter((x) => x !== "body" && x !== "query").join(" → ");
      const msg = (d.msg ?? "is invalid").replace(/^Value error, /, "");
      return loc ? `${humanize(String(loc))}: ${msg}` : msg;
    });
    if (parts.length) return parts.join("; ");
  }
  if (detail && typeof detail === "object") {
    const o = detail as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.detail === "string") return o.detail;
    try {
      return JSON.stringify(detail);
    } catch {
      /* fall through */
    }
  }
  if (status === 413) return "The request was too large.";
  if (status === 502 || status === 503 || status === 504)
    return "Can't reach the Sermon Shorts server. Is the backend running?";
  return status ? `Request failed (${status})` : "Something went wrong";
}

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return "Network error — can't reach the server.";
  if (e instanceof Error) return e.message;
  return String(e);
}

const NO_REDIRECT = ["/api/auth/login", "/api/auth/register", "/api/auth/config"];

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const here = window.location.pathname;
  if (here.startsWith("/login") || here.startsWith("/register")) return;
  const next = encodeURIComponent(here + window.location.search);
  // outside React (no router here); a full load also clears any stale in-memory data
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?next=${next}`;
}

export async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) detail = (await res.json())?.detail ?? null;
    else detail = (await res.text()).slice(0, 300) || null;
  } catch {
    /* ignore */
  }
  // a text/html error page from the proxy isn't useful to show
  if (typeof detail === "string" && detail.trim().startsWith("<")) detail = null;
  return new ApiError(res.status, detail, detailToMessage(detail, res.status));
}

type Body = Record<string, unknown> | unknown[] | FormData | Blob | null | undefined;

export async function request<T>(method: string, path: string, body?: Body, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob) payload = body;
  else if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: "include", signal, cache: "no-store" });
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && !NO_REDIRECT.some((p) => path.startsWith(p))) redirectToLogin();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? await res.json() : await res.text()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: Body) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: Body) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
