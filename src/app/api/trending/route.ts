// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decompressGzBase64 } from "@/lib/compression";
import type { StargazerPoint } from "@/app/api/chunk/route";

export type TrendingRepo = {
  owner: string;
  repo: string;
  stars7d: number;
  stars30d: number;
  stars90d: number;
  totalCount: number;
  language: string | null;
  rank: number;
  hasMap: boolean;
};

export type TrendingResponse = {
  repos: TrendingRepo[];
  mapPoints: StargazerPoint[];
  meta: { total: number };
};

type MvRow = {
  owner: string;
  repo: string;
  stars_7d: bigint;
  stars_30d: bigint;
  stars_90d: bigint;
  language: string | null;
  total_count: bigint;
};

/**
 * @deprecated Use /api/trending/repos (list) + /api/trending/map (geo points) instead.
 * Kept for backward compatibility — will be removed in a future release.
 */
export const GET = async () => {
  try {
    const rows = await prisma.$queryRaw<MvRow[]>`
      SELECT owner, repo, stars_7d, stars_30d, stars_90d, language, "totalCount" AS total_count
      FROM trending_repos_mv
      ORDER BY stars_7d DESC
      LIMIT 50
    `;

    if (!rows.length) {
      return NextResponse.json(
        { error: "trending_mv_empty", message: "Run pnpm create:trending-mv to initialize." },
        { status: 503 },
      );
    }

    const repos: TrendingRepo[] = rows.map((r, i) => ({
      owner: r.owner,
      repo: r.repo,
      stars7d: Number(r.stars_7d),
      stars30d: Number(r.stars_30d),
      stars90d: Number(r.stars_90d),
      totalCount: Number(r.total_count),
      language: r.language,
      rank: i + 1,
      hasMap: false,
    }));

    // Fetch geo points from top 10 repos that have a stargazer_cache entry.
    const top10 = repos.slice(0, 10);
    const caches = await prisma.stargazerCache.findMany({
      where: { OR: top10.map((r) => ({ owner: r.owner, repo: r.repo })) },
      select: { owner: true, repo: true, points: true },
    });

    const cachedSet = new Set(caches.map((c) => `${c.owner}/${c.repo}`));
    repos.forEach((r) => {
      r.hasMap = cachedSet.has(`${r.owner}/${r.repo}`);
    });

    // Merge points from all cached repos, dedup by login (first occurrence wins).
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
      { repos, mapPoints, meta: { total: rows.length } } satisfies TrendingResponse,
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
