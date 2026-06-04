// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  if (!login || !/^[a-zA-Z0-9_-]{1,39}$/.test(login)) return jsonError("invalid_params", 400);

  try {
    const meta = await prisma.followerCache.findUnique({
      where: { login },
      select: { scannedAt: true },
    });

    if (!meta) return jsonError("not_found", 404);

    const etag = `"${meta.scannedAt.getTime()}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    const cached = await prisma.followerCache.findUnique({
      where: { login },
      select: { pointsGz: true, unmappedGz: true, totalCount: true, scannedAt: true },
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
        totalCount: cached.totalCount,
        scannedAt: cached.scannedAt.toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600", ETag: etag } },
    );
  } catch (err) {
    logError("follower-cache GET", err);
    return jsonError("internal", 500);
  }
};
