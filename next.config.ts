// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import "./src/env"; // crash build if required env vars (DATABASE_URL, GITHUB_TOKEN, NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN) are missing
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  compress: false,       // Vercel CDN handles compression — redundant in serverless
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          // AGPL-3.0 §13: network services must provide source code access
          { key: "X-Source-Code", value: `https://github.com/FlorianBruniaux/starmapper/commit/${process.env.VERCEL_GIT_COMMIT_SHA ?? "main"}` },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // CSP is set dynamically per-request in middleware.ts (nonce-based, no unsafe-inline)
        ],
      },
    ];
  },
};

export default nextConfig;
