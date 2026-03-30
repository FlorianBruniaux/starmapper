// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { prisma } from "@/lib/db";

// Decompress points/unmapped stored as gzip+base64 string, or return as-is if legacy JSON array.
const decompress = (value: unknown): unknown[] => {
  if (typeof value === "string") {
    // New format: gzip+base64 encoded
    return JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8"));
  }
  // Legacy format: plain JSON array (rows written before this change)
  return Array.isArray(value) ? value : [];
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

  try {
    const cached = await prisma.stargazerCache.findUnique({ where: { owner_repo: key } });

    if (cached) {
      const points = decompress(cached.points) as Record<string, unknown>[];
      const unmapped = decompress(cached.unmapped);

      // Reconstruct avatarUrl from login (stripped on write to save space)
      // Legacy rows already have avatarUrl — only add if missing
      const pointsWithAvatar = points.map((p) => ({
        ...p,
        avatarUrl: p.avatarUrl ?? `https://github.com/${p.login}.png`,
      }));

      return NextResponse.json({
        points: pointsWithAvatar,
        unmapped,
        totalCount: cached.totalCount,
        scannedAt: cached.scannedAt.toISOString(),
      });
    }

    // No stargazer cache — check badge_cache for last scan metadata
    const badge = await prisma.badgeCache.findUnique({ where: { owner_repo: key } });
    if (badge) {
      return NextResponse.json({ lastScan: badge.updatedAt.toISOString() }, { status: 206 });
    }

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
