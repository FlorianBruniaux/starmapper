// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "linear-gradient(135deg, #0d1117 0%, #161b22 100%)",
          display: "flex",
          flexDirection: "column",
          padding: "60px 80px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          position: "relative",
        }}
      >
        {/* Globe watermark */}
        <div style={{ position: "absolute", right: 60, top: 40, fontSize: 280, opacity: 0.05, display: "flex" }}>
          🌍
        </div>

        {/* Dot cluster decoration */}
        <div style={{ position: "absolute", right: 80, bottom: 100, display: "flex", gap: 10, flexWrap: "wrap", width: 320, opacity: 0.15 }}>
          {Array.from({ length: 48 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: i % 5 === 0 ? "#ffa657" : i % 3 === 0 ? "#58a6ff" : "#3fb950",
              }}
            />
          ))}
        </div>

        {/* Logo + app name */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 48 }}>
          <span style={{ fontSize: 48 }}>🌍</span>
          <span style={{ color: "#f0f6fc", fontSize: 40, fontWeight: 800, letterSpacing: "-0.5px" }}>
            StarMapper
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: "auto" }}>
          <span style={{ color: "#f0f6fc", fontSize: 64, fontWeight: 800, lineHeight: 1.1, maxWidth: 700 }}>
            Map your GitHub stargazers
          </span>
          <span style={{ color: "#8b949e", fontSize: 26, lineHeight: 1.4, maxWidth: 600 }}>
            See where in the world your repo's fans are. Geocoded, clustered, and beautiful.
          </span>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 48,
            borderTop: "1px solid #21262d",
            paddingTop: 24,
          }}
        >
          <div style={{ display: "flex", gap: 32 }}>
            <span style={{ color: "#3fb950", fontSize: 20 }}>Free</span>
            <span style={{ color: "#3fb950", fontSize: 20 }}>No login</span>
            <span style={{ color: "#3fb950", fontSize: 20 }}>Any public repo</span>
          </div>
          <span style={{ color: "#58a6ff", fontSize: 22, fontWeight: 600 }}>starmapper.bruniaux.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
