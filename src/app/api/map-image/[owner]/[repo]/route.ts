import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { prisma } from "@/lib/db";

export const revalidate = 21600; // 6h CDN cache

type Point = { lat: number; lng: number };

const decompress = (value: unknown): Point[] => {
  if (typeof value === "string") {
    return JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8"));
  }
  return Array.isArray(value) ? value : [];
};

// Equirectangular projection
const project = (lat: number, lng: number, w: number, h: number) => ({
  x: Math.round(((lng + 180) / 360) * w),
  y: Math.round(((90 - lat) / 180) * h),
});

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

const makeSvg = (
  owner: string,
  repo: string,
  points: Point[],
  mappedCount: number,
  countryCount: number,
  totalCount: number,
  theme: "dark" | "light",
): string => {
  const W = 800;
  const H = 400;
  const PAD = 20;
  const HEADER_H = 48;
  const FOOTER_H = 32;
  const MAP_X = PAD;
  const MAP_Y = PAD + HEADER_H;
  const MAP_W = W - PAD * 2;
  const MAP_H = H - PAD * 2 - HEADER_H - FOOTER_H;

  const isDark = theme === "dark";
  const bg = isDark ? "#0d1117" : "#ffffff";
  const headerBg = isDark ? "#161b22" : "#f6f8fa";
  const mapBg = isDark ? "#010409" : "#f0f6fc";
  const fg = isDark ? "#f0f6fc" : "#1f2328";
  const muted = isDark ? "#7d8590" : "#636c76";
  const accent = isDark ? "#58a6ff" : "#0969da";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const dotColor = isDark ? "#58a6ff" : "#1f6feb";
  const dotOpacity = isDark ? "0.65" : "0.55";

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

  const repoLabel = truncate(`${owner}/${repo}`, 48);
  const statsText =
    countryCount > 0
      ? `${fmt(mappedCount)} mapped  ·  ${countryCount} countries  ·  ${fmt(totalCount)} total`
      : "Scan this repo on starmapper.bruniaux.com";

  const hasData = points.length > 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="StarMapper — ${repoLabel}">
  <title>StarMapper — ${repoLabel}</title>
  <!-- Card background -->
  <rect width="${W}" height="${H}" fill="${bg}" rx="10"/>
  <!-- Header bar -->
  <rect x="${PAD}" y="${PAD}" width="${MAP_W}" height="${HEADER_H - 6}" fill="${headerBg}" rx="6"/>
  <!-- Map area -->
  <rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_W}" height="${MAP_H}" fill="${mapBg}" rx="4" stroke="${borderColor}" stroke-width="1"/>
  <!-- Subtle latitude grid lines -->
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.25}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.25}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.5}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.5}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <line x1="${MAP_X}" y1="${MAP_Y + MAP_H * 0.75}" x2="${MAP_X + MAP_W}" y2="${MAP_Y + MAP_H * 0.75}" stroke="${borderColor}" stroke-width="0.4" stroke-dasharray="3,6"/>
  <!-- Dots -->
  ${hasData ? circles : `<text x="${MAP_X + MAP_W / 2}" y="${MAP_Y + MAP_H / 2 + 5}" fill="${muted}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" text-anchor="middle">No data yet — scan to generate map</text>`}
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
  const { owner, repo } = await params;
  const theme = req.nextUrl.searchParams.get("theme") === "light" ? "light" : "dark";
  const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

  let points: Point[] = [];
  let mappedCount = 0;
  let countryCount = 0;
  let totalCount = 0;

  try {
    const [cached, badge] = await Promise.all([
      prisma.stargazerCache.findUnique({ where: { owner_repo: key } }),
      prisma.badgeCache.findUnique({ where: { owner_repo: key } }),
    ]);

    if (cached) {
      points = decompress(cached.points);
      totalCount = cached.totalCount;
    }
    if (badge) {
      mappedCount = badge.mappedCount;
      countryCount = badge.countryCount;
      if (!totalCount) totalCount = badge.totalCount;
    }
  } catch {
    // DB down — return empty map
  }

  const svg = makeSvg(owner, repo, points, mappedCount, countryCount, totalCount, theme);

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=21600, s-maxage=21600",
    },
  });
};
