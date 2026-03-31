// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const cached = await prisma.stargazerCache.findUnique({ where: { owner_repo: key } });

    if (cached) {
      const points = decompressGzBase64<Record<string, unknown>>(cached.points);
      const unmapped = decompressGzBase64(cached.unmapped);

      // Reconstruct avatarUrl from login (stripped on write to save space)
      // Legacy rows already have avatarUrl — only add if missing
      // Reduce lat/lng precision to ~1.1 km (2 decimals) to prevent individual geolocation
      const pointsWithAvatar = points.map((p) => ({
        ...p,
        avatarUrl: p.avatarUrl ?? `https://github.com/${p.login}.png`,
        ...(typeof p.lat === "number" && typeof p.lng === "number"
          ? { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 }
          : {}),
      }));

      return NextResponse.json(
        {
          points: pointsWithAvatar,
          unmapped,
          totalCount: cached.totalCount,
          scannedAt: cached.scannedAt.toISOString(),
        },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
      );
    }

    // No stargazer cache — check badge_cache for last scan metadata
    const badge = await prisma.badgeCache.findUnique({ where: { owner_repo: key } });
    if (badge) {
      return NextResponse.json({ lastScan: badge.updatedAt.toISOString() }, { status: 206 });
    }

    return jsonError("not_found", 404);
  } catch {
    return jsonError("internal", 500);
  }
};
