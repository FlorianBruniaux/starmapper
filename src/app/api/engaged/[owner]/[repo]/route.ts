// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const cached = await prisma.engagedCache.findUnique({
      where: { owner_repo: key },
      select: {
        pointsGz: true,
        unmappedGz: true,
        knownCount: true,
        starCount: true,
        channels: true,
        scannedAt: true,
      },
    });
    if (!cached) return jsonError("not_found", 404);

    const points = decompressGzBase64<Record<string, unknown>>(cached.pointsGz);
    const unmapped = decompressGzBase64(cached.unmappedGz);

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
        knownCount: cached.knownCount,
        starCount: cached.starCount,
        channels: cached.channels.split(","),
        scannedAt: cached.scannedAt.toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    logError("engaged GET", err);
    return jsonError("internal", 500);
  }
};
