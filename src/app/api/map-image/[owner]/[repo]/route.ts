// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { feature } from "topojson-client";
import { validateOwnerRepo } from "@/lib/api-validation";
import { decompressGzBase64 } from "@/lib/compression";
import { fmt } from "@/lib/format";
import type { Topology, GeometryCollection } from "topojson-specification";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const worldTopo = require("world-atlas/land-110m.json") as Topology<{
  land: GeometryCollection;
}>;

export const revalidate = 21600; // 6h CDN cache

type Point = { lat: number; lng: number };

// Map layout constants (shared between land path pre-computation and makeSvg)
const W = 800;
const H = 400;
const PAD = 20;
const HEADER_H = 48;
const FOOTER_H = 32;
const MAP_X = PAD;
const MAP_Y = PAD + HEADER_H;
const MAP_W = W - PAD * 2;
const MAP_H = H - PAD * 2 - HEADER_H - FOOTER_H;

// Pre-compute the SVG land path once at module load (equirectangular projection)
const buildLandPath = (): string => {
  const landFeature = feature(worldTopo, worldTopo.objects.land);
  const features = "features" in landFeature ? landFeature.features : [landFeature];
  const parts: string[] = [];

  for (const f of features) {
    if (!f.geometry || f.geometry.type !== "MultiPolygon") continue;
    for (const polygon of (f.geometry as GeoJSON.MultiPolygon).coordinates) {
      for (const ring of polygon) {
        let d = "";
        for (let i = 0; i < ring.length; i++) {
          const [lng, lat] = ring[i];
          const x = (((lng + 180) / 360) * MAP_W + MAP_X).toFixed(1);
          const y = (((90 - lat) / 180) * MAP_H + MAP_Y).toFixed(1);
          d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
        }
        d += "Z";
        parts.push(d);
      }
    }
  }

  return parts.join(" ");
};

const LAND_PATH = buildLandPath();

// Equirectangular projection (same formula as LAND_PATH)
const project = (lat: number, lng: number, w: number, h: number) => ({
  x: Math.round(((lng + 180) / 360) * w),
  y: Math.round(((90 - lat) / 180) * h),
});

const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (d: Date): string => {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const makeSvg = (
  owner: string,
  repo: string,
  points: Point[],
  mappedCount: number,
  countryCount: number,
  totalCount: number,
  theme: "dark" | "light",
  scannedAt: Date | null,
): string => {
  const isDark = theme === "dark";
  const bg = isDark ? "#0d1117" : "#ffffff";
  const headerBg = isDark ? "#161b22" : "#f6f8fa";
  const mapBg = isDark ? "#010409" : "#f0f6fc";
  const landFill = isDark ? "#161b22" : "#d1dfe9";
  const landStroke = isDark ? "#1e2d3d" : "#b8cad8";
  const fg = isDark ? "#f0f6fc" : "#1f2328";
  const muted = isDark ? "#7d8590" : "#636c76";
  const accent = isDark ? "#58a6ff" : "#0969da";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const dotColor = isDark ? "#58a6ff" : "#1f6feb";
  const dotOpacity = isDark ? "0.8" : "0.7";

  // Sample up to 2500 points to keep SVG size reasonable
  const sampled =
    points.length > 2500
      ? points.filter((_, i) => i % Math.ceil(points.length / 2500) === 0)
      : points;

  const circles = sampled
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const { x, y } = project(p.lat, p.lng, MAP_W, MAP_H);
      return `<circle cx="${MAP_X + x}" cy="${MAP_Y + y}" r="2.2" fill="${dotColor}" opacity="${dotOpacity}"/>`;
    })
    .join("");

  const repoLabel = xmlEscape(truncate(`${owner}/${repo}`, 48));
  const dateLabel = scannedAt ? `  ·  ${fmtDate(scannedAt)}` : "";
  const statsText = xmlEscape(
    countryCount > 0
      ? `${fmt(mappedCount)} mapped  ·  ${countryCount} countries  ·  ${fmt(totalCount)} total${dateLabel}`
      : "Scan this repo on starmapper.bruniaux.com",
  );

  const hasData = points.length > 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="StarMapper — ${repoLabel}">
  <title>StarMapper — ${repoLabel}</title>
  <!-- Card background -->
  <rect width="${W}" height="${H}" fill="${bg}" rx="10"/>
  <!-- Header bar -->
  <rect x="${PAD}" y="${PAD}" width="${MAP_W}" height="${HEADER_H - 6}" fill="${headerBg}" rx="6"/>
  <!-- Map area -->
  <rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_W}" height="${MAP_H}" fill="${mapBg}" rx="4" stroke="${borderColor}" stroke-width="1"/>
  <!-- Clipping mask so land paths don't overflow the map area -->
  <defs>
    <clipPath id="mapClip">
      <rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_W}" height="${MAP_H}" rx="4"/>
    </clipPath>
  </defs>
  <!-- Land masses (Natural Earth 110m, equirectangular) -->
  <path clip-path="url(#mapClip)" d="${LAND_PATH}" fill="${landFill}" stroke="${landStroke}" stroke-width="0.4" stroke-linejoin="round"/>
  <!-- Subtle latitude grid lines -->
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.25}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.25}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.5}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.5}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.75}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.75}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <!-- Dots -->
  ${hasData ? `<g clip-path="url(#mapClip)">${circles}</g>` : `<text x="${MAP_X + MAP_W / 2}" y="${MAP_Y + MAP_H / 2 + 5}" fill="${muted}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" text-anchor="middle">No data yet — scan to generate map</text>`}
  <!-- Header: repo name left, star count right -->
  <text x="${PAD + 12}" y="${PAD + 30}" fill="${fg}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" font-weight="bold">${repoLabel}</text>
  <text x="${W - PAD - 10}" y="${PAD + 30}" fill="${muted}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" text-anchor="end">&#x2605; ${fmt(totalCount)} stars</text>
  <!-- Footer: stats left, branding right -->
  <text x="${MAP_X + 4}" y="${MAP_Y + MAP_H + 22}" fill="${muted}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="10">${statsText}</text>
  <text x="${W - PAD - 4}" y="${MAP_Y + MAP_H + 22}" fill="${accent}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="10" text-anchor="end">starmapper.bruniaux.com</text>
</svg>`;
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const raw = await params;
  const validated = validateOwnerRepo(raw.owner, raw.repo);
  if (!validated) return new NextResponse("Invalid repository", { status: 400 });
  const { owner, repo } = validated;
  const theme = req.nextUrl.searchParams.get("theme") === "light" ? "light" : "dark";
  // Redirect to canonical URL to prevent CDN cache busting via extra query params.
  // Only fires when unknown params are present (e.g. ?theme=dark&_=1234 → ?theme=dark).
  // Does NOT fire for unknown theme values — those are silently normalized to "dark".
  const hasExtraParams = [...req.nextUrl.searchParams.keys()].some((k) => k !== "theme");
  if (hasExtraParams) {
    const canonical = new URL(req.nextUrl.href);
    canonical.search = `?theme=${theme}`;
    return NextResponse.redirect(canonical, {
      status: 301,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const key = { owner, repo };

  let points: Point[] = [];
  let mappedCount = 0;
  let countryCount = 0;
  let totalCount = 0;
  let scannedAt: Date | null = null;

  try {
    const [cached, badge] = await Promise.all([
      prisma.stargazerCache.findUnique({
        where: { owner_repo: key },
        select: { points: true, totalCount: true, scannedAt: true },
      }),
      prisma.badgeCache.findUnique({ where: { owner_repo: key } }),
    ]);

    if (cached) {
      points = decompressGzBase64<Point>(cached.points);
      totalCount = cached.totalCount;
      scannedAt = cached.scannedAt;
    }
    if (badge) {
      mappedCount = badge.mappedCount;
      countryCount = badge.countryCount;
      if (!totalCount) totalCount = badge.totalCount;
      if (!scannedAt) scannedAt = badge.updatedAt;
    }
  } catch {
    // DB down — return empty map
  }

  const svg = makeSvg(owner, repo, points, mappedCount, countryCount, totalCount, theme, scannedAt);

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=3600",
    },
  });
};
