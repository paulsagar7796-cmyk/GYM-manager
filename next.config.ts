import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pinned because the nearest lockfile sits above the repo, which otherwise
    // makes Turbopack infer a project root outside of it.
    root: import.meta.dirname,
  },

  async headers() {
    return [
      {
        // The worker must never be served stale, or a fix to it can never ship.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
