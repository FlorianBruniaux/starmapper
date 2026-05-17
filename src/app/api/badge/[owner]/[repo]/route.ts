// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";
import { fmt } from "@/lib/format";

// Cache badge SVG for 6 hours at the CDN level
export const revalidate = 21600;

// Approximate character width for Verdana 11px (average ~6.5px/char)
const textWidth = (s: string) => s.length * 6.5;

const makeSvg = (label: string, value: string): string => {
  const lw = Math.round(textWidth(label) + 22);
  const rw = Math.round(textWidth(value) + 22);
  const w = lw + rw;
  const h = 20;
  const lx = Math.round(lw / 2);
  const rx = lw + Math.round(rw / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${w}" height="${h}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="#555"/>
    <rect x="${lw}" width="${rw}" height="${h}" fill="#238636"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" text-rendering="geometricPrecision">
    <text x="${lx}" y="15" fill="#010101" fill-opacity=".3" text-anchor="middle">${label}</text>
    <text x="${lx}" y="14" text-anchor="middle">${label}</text>
    <text x="${rx}" y="15" fill="#010101" fill-opacity=".3" text-anchor="middle">${value}</text>
    <text x="${rx}" y="14" text-anchor="middle">${value}</text>
  </g>
</svg>`;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  let mappedCount = 0;
  let countryCount = 0;

  try {
    const cached = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: { mappedCount: true, countryCount: true },
    });
    if (cached) {
      mappedCount = cached.mappedCount;
      countryCount = cached.countryCount;
    }
  } catch {
    // DB down — return fallback badge
  }

  const label = "StarMapper";
  const value = countryCount > 0
    ? `${fmt(mappedCount)} mapped · ${countryCount} countries`
    : "map your stargazers";

  return new NextResponse(makeSvg(label, value), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=3600",
    },
  });
};
