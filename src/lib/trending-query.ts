// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { cacheLife, cacheTag } from "next/cache";
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

type MvRow = {
  owner: string;
  repo: string;
  stars_7d: bigint;
  stars_30d: bigint;
  stars_90d: bigint;
  language: string | null;
  total_count: bigint;
};

const MAP_REPOS_LIMIT = 5;

// Returns null when trending_repos_mv is empty (not yet initialized).
export const fetchTrendingRepos = async (): Promise<{
  repos: TrendingRepo[];
  meta: { total: number };
} | null> => {
  "use cache";
  cacheTag("trending");
  cacheLife({ revalidate: 300, stale: 3600 });

  const rows = await prisma.$queryRaw<MvRow[]>`
    SELECT owner, repo, stars_7d, stars_30d, stars_90d, language, "totalCount" AS total_count
    FROM trending_repos_mv
    ORDER BY stars_7d DESC
    LIMIT 50
  `;

  if (!rows.length) return null;

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

  const top10 = repos.slice(0, 10);
  const cacheKeys = await prisma.stargazerCache.findMany({
    where: { OR: top10.map((r) => ({ owner: r.owner, repo: r.repo })) },
    select: { owner: true, repo: true },
  });

  const cachedSet = new Set(cacheKeys.map((c) => `${c.owner}/${c.repo}`));
  repos.forEach((r) => {
    r.hasMap = cachedSet.has(`${r.owner}/${r.repo}`);
  });

  return { repos, meta: { total: rows.length } };
};

export const fetchTrendingMap = async (): Promise<StargazerPoint[]> => {
  "use cache";
  cacheTag("trending");
  cacheLife({ revalidate: 300, stale: 3600 });

  const topRows = await prisma.$queryRaw<{ owner: string; repo: string }[]>`
    SELECT owner, repo
    FROM trending_repos_mv
    ORDER BY stars_7d DESC
    LIMIT ${MAP_REPOS_LIMIT}
  `;

  const caches = await prisma.stargazerCache.findMany({
    where: { OR: topRows.map((r) => ({ owner: r.owner, repo: r.repo })) },
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

  return mapPoints;
};
