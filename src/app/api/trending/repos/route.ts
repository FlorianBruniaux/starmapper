// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { TrendingRepo } from "@/app/api/trending/route";

export type { TrendingRepo };

export type TrendingReposResponse = {
  repos: TrendingRepo[];
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

    const repos: TrendingRepo[] = rows.map((r: MvRow, i: number) => ({
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

    // Cheap hasMap lookup: select only owner/repo — no decompression.
    const top10 = repos.slice(0, 10);
    const cacheKeys = await prisma.stargazerCache.findMany({
      where: { OR: top10.map((r) => ({ owner: r.owner, repo: r.repo })) },
      select: { owner: true, repo: true },
    });

    const cachedSet = new Set(cacheKeys.map((c: { owner: string; repo: string }) => `${c.owner}/${c.repo}`));
    repos.forEach((r) => {
      r.hasMap = cachedSet.has(`${r.owner}/${r.repo}`);
    });

    return NextResponse.json(
      { repos, meta: { total: rows.length } } satisfies TrendingReposResponse,
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
