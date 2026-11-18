# Sermon Shorts — frontend

Next.js 16 (App Router, Turbopack, Tailwind v4) UI for the self-hosted Sermon Shorts API.

```bash
npm install
npm run dev      # http://0.0.0.0:3100 (LAN-reachable)
npm run build && npm run start
```

## Backend connection

All browser calls go to same-origin `/api/*`, which `next.config.ts` rewrites to
`${BACKEND_URL}/api/*` (default `http://127.0.0.1:18765`). Auth is the backend's httpOnly cookie.

- `BACKEND_URL` is read when the config loads. For `next start` the rewrite is baked in at
  **build** time, so set `BACKEND_URL` before `npm run build` if it isn't the default.
- Upload chunks are 16 MB. Next buffers proxied request bodies and silently truncates past
  10 MB by default, so `experimental.proxyClientMaxBodySize` is set to `64mb`. If you raise the
  backend's `UPLOAD_CHUNK_MB`, raise this too.
- `experimental.proxyTimeout` is 15 min so slow chunk uploads and ZIP downloads don't get cut off.
