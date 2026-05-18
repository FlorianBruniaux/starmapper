// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decompressGzBase64 } from "@/lib/compression";
import type { StargazerPoint } from "@/app/api/chunk/route";

export type TrendingMapResponse = {
  mapPoints: StargazerPoint[];
};

type MvRow = { owner: string; repo: string };

const MAP_REPOS_LIMIT = 5;

export const GET = async () => {
  try {
    const topRows = await prisma.$queryRaw<MvRow[]>`
      SELECT owner, repo
      FROM trending_repos_mv
      ORDER BY stars_7d DESC
      LIMIT ${MAP_REPOS_LIMIT}
    `;

    const caches = await prisma.stargazerCache.findMany({
      where: { OR: topRows.map((r: MvRow) => ({ owner: r.owner, repo: r.repo })) },
      select: { owner: true, repo: true, points: true },
    });

    const seen = new Set<string>();
    const mapPoints: StargazerPoint[] = [];
    for (const cache of caches) {
      const points = decompressGzBase64<StargazerPoint>(cache.points);
      for (const p of points) {
        if (!seen.has(p.login)) {
          seen.add(p.login);
          mapPoints.push({
            ...p,
            avatarUrl: p.avatarUrl ?? `https://github.com/${p.login}.png`,
            lat: Math.round(p.lat * 100) / 100,
            lng: Math.round(p.lng * 100) / 100,
          });
        }
      }
    }

    return NextResponse.json(
      { mapPoints } satisfies TrendingMapResponse,
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } },
    );
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
