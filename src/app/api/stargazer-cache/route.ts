// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";

const MAX_CACHEABLE_STARS = 500_000;

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, points, unmapped, pointsGz, unmappedGz, totalCount, latestStarredAt, ts } = body;

    const key = validateOwnerRepo(owner, repo);
    if (!key || typeof totalCount !== "number" || totalCount < 0 || totalCount > MAX_CACHEABLE_STARS) {
      return jsonError("invalid_params", 400);
    }

    // Freshness check — rejects requests older than 5 minutes (anti-replay)
    if (typeof ts !== "number" || Math.abs(Date.now() - ts) > 5 * 60_000) {
      return jsonError("expired_request", 400);
    }

    // Plausibility check — if badge data exists, totalCount must be within ±20%
    // Prevents overwriting a 50k-star repo cache with fabricated data
    const existingBadge = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: { totalCount: true },
    });
    if (existingBadge && existingBadge.totalCount > 0) {
      const ratio = totalCount / existingBadge.totalCount;
      if (ratio < 0.8 || ratio > 1.2) {
        return jsonError("totalCount_mismatch", 400);
      }
    }

    let finalPointsGz: string;
    let finalUnmappedGz: string;

    if (typeof pointsGz === "string" && typeof unmappedGz === "string") {
      // New format: client compressed client-side to stay under Vercel's 4.5MB body limit
      // 30 MB base64 per field — supports up to ~500k stars
      if (pointsGz.length > 30_000_000 || unmappedGz.length > 30_000_000) {
        return jsonError("payload_too_large", 413);
      }
      finalPointsGz = pointsGz;
      finalUnmappedGz = unmappedGz;
    } else if (Array.isArray(points) && Array.isArray(unmapped)) {
      // Legacy format: raw arrays — compress on server
      if (points.length + unmapped.length > MAX_CACHEABLE_STARS) {
        return jsonError("too_large", 413);
      }
      type RawPoint = { bio?: unknown; avatarUrl?: unknown; [k: string]: unknown };
      const slim = (points as RawPoint[]).map(({ bio: _bio, avatarUrl: _av, ...rest }) => rest);
      finalPointsGz = gzipSync(JSON.stringify(slim)).toString("base64");
      finalUnmappedGz = gzipSync(JSON.stringify(unmapped)).toString("base64");
    } else {
      return jsonError("invalid_params", 400);
    }

    const health = await checkDbHealth();
    if (health.ok && health.usagePct >= DB_CRITICAL_PCT)
      return jsonError("storage_full", 507);

    const latestStarredAtDate = typeof latestStarredAt === "string" ? new Date(latestStarredAt) : null;
    await prisma.stargazerCache.upsert({
      where: { owner_repo: key },
      create: { ...key, points: finalPointsGz, unmapped: finalUnmappedGz, totalCount, scannedAt: new Date(), latestStarredAt: latestStarredAtDate },
      update: { points: finalPointsGz, unmapped: finalUnmappedGz, totalCount, scannedAt: new Date(), latestStarredAt: latestStarredAtDate },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("internal", 500);
  }
};
