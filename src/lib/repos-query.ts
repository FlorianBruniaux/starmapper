// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";

type RepoRow = {
  owner: string;
  repo: string;
  mappedCount: number;
  countryCount: number;
  totalCount: number;
  language: string | null;
  updatedAt: Date;
  organicScore: number | null;
  organicTier: string | null;
};

export type RepoItem = {
  owner: string;
  repo: string;
  mappedCount: number;
  countryCount: number;
  totalCount: number;
  mappedPercent: number;
  language: string | null;
  updatedAt: string;
  organicScore: number | null;
  organicTier: string | null;
};

const MAX_PER_OWNER = 3;
const MIN_TOTAL_COUNT = 100;

export const fetchReposData = async (
  limit: number,
  diverse: boolean,
): Promise<{ repos: RepoItem[]; total: number }> => {
  "use cache";
  cacheTag("repos");
  cacheLife({ revalidate: 300, stale: 3600 });

  const pool = diverse ? Math.min(limit * 40, 500) : limit;

  const [rows, [{ count: totalBigInt }]] = await Promise.all([
    prisma.$queryRaw<RepoRow[]>`
      SELECT bc.owner, bc.repo, bc."mappedCount", bc."countryCount", bc."totalCount",
             bc.language, bc."updatedAt", bc."organicScore", bc."organicTier"
      FROM badge_cache bc
      WHERE EXISTS (
        SELECT 1 FROM stargazer_cache sc
        WHERE sc.owner = bc.owner AND sc.repo = bc.repo
      )
      ORDER BY bc."updatedAt" DESC
      LIMIT ${pool}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) FROM badge_cache bc
      WHERE EXISTS (
        SELECT 1 FROM stargazer_cache sc
        WHERE sc.owner = bc.owner AND sc.repo = bc.repo
      )
    `,
  ]);
  const total = Number(totalBigInt);

  let filtered = rows;
  if (diverse) {
    const ownerCount = new Map<string, number>();
    filtered = [];
    for (const r of rows) {
      if (r.totalCount < MIN_TOTAL_COUNT) continue;
      const n = ownerCount.get(r.owner) ?? 0;
      if (n >= MAX_PER_OWNER) continue;
      ownerCount.set(r.owner, n + 1);
      filtered.push(r);
      if (filtered.length >= limit) break;
    }
  }

  return {
    repos: filtered.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      mappedCount: r.mappedCount,
      countryCount: r.countryCount,
      totalCount: r.totalCount,
      mappedPercent: r.totalCount > 0 ? Math.round((r.mappedCount / r.totalCount) * 100) : 0,
      language: r.language ?? null,
      updatedAt: r.updatedAt.toISOString(),
      organicScore: r.organicScore ?? null,
      organicTier: r.organicTier ?? null,
    })),
    total,
  };
};
