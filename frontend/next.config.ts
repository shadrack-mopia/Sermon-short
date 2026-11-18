import type { NextConfig } from "next";

// The FastAPI backend listens only on localhost; the browser (laptop or phone on
// the LAN) talks to Next on :3100 and every /api/* call is proxied through here.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:18765";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Let other devices on the LAN use the dev server (production `next start` needs nothing).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  experimental: {
    // Next clones/buffers request bodies before proxying rewrites and silently truncates
    // anything over 10 MB (verified: a 16 MB PUT hung / arrived truncated). Upload chunks
    // are 16 MB (backend UPLOAD_CHUNK_MB), so allow headroom. Raise this if you raise the chunk size.
    proxyClientMaxBodySize: "64mb",
    // The default 30 s proxy timeout is too short for slow Wi-Fi chunks and ZIP downloads.
    proxyTimeout: 15 * 60 * 1000,
  },
  // Keep proxied video Range responses byte-exact (LAN app, compression gains little).
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
