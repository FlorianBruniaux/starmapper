// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;

  let stars = 0;
  let description = "";
  let avatar = "";
  try {
    const token = process.env.GITHUB_TOKEN;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: "application/vnd.github.v3+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.ok) {
      const data = await res.json() as { stargazers_count?: number; description?: string; owner?: { avatar_url?: string } };
      stars = data.stargazers_count ?? 0;
      description = data.description ?? "";
      avatar = data.owner?.avatar_url ?? "";
    }
  } catch {}

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          background: "linear-gradient(135deg, #0d1117 0%, #161b22 100%)",
          display: "flex", flexDirection: "column",
          padding: "60px 80px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          position: "relative",
        }}
      >
        {/* Globe watermark */}
        <div style={{ position: "absolute", right: 80, top: 60, fontSize: 200, opacity: 0.06, display: "flex" }}>
          🌍
        </div>

        {/* Header: avatar + repo name */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
          {avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} width={64} height={64} style={{ borderRadius: 32, border: "2px solid #30363d" }} alt="" />
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#8b949e", fontSize: 22 }}>{owner} /</span>
            <span style={{ color: "#f0f6fc", fontSize: 36, fontWeight: 700, lineHeight: 1.2 }}>{repo}</span>
          </div>
        </div>

        {/* Description */}
        {description && (
          <p style={{ color: "#8b949e", fontSize: 22, margin: "0 0 40px", maxWidth: 800, lineHeight: 1.4 }}>
            {description.length > 120 ? description.slice(0, 120) + "…" : description}
          </p>
        )}

        {/* Stars stat */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: "auto" }}>
          <span style={{ color: "#f0f6fc", fontSize: 72, fontWeight: 800 }}>
            {stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars.toLocaleString()}
          </span>
          <span style={{ color: "#ffa657", fontSize: 32, fontWeight: 600 }}>★ stars</span>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, borderTop: "1px solid #21262d", paddingTop: 24 }}>
          <span style={{ color: "#484f58", fontSize: 20 }}>See where your stargazers are in the world</span>
          <span style={{ color: "#58a6ff", fontSize: 22, fontWeight: 600 }}>🌍 starmapper.bruniaux.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
