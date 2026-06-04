// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/organic-score/[owner]/[repo]
// MCP-optimised endpoint: returns the full organic signal breakdown.
// Unlike /api/organic-score/, this recomputes signals from stored badge_cache
// raw values + a live zero-follower query so MCP clients get the full picture.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeOrganicScore, tierLabel, ORGANIC_WEIGHTS, ORGANIC_CORPUS_ACCURACY } from "@/lib/organic-score";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type McpOrganicScoreResponse = {
  score: number | null;
  tier: string;
  tierLabel: string;
  computedAt: string | null;
  signals: {
    forkRatio: number | null;
    watcherRatio: number | null;
    zeroFollowerPct: number | null;
    releasesCount: number | null;
    sampleSize: number;
  };
  weights: {
    fork_ratio: number;
    watcher_ratio: number;
    zero_follower_pct: number;
    releases_count: number;
  };
  activeSignals: string[];
  reasons: string[];
  corpusAccuracy: number;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  const key = validateOwnerRepo(rawOwner, rawRepo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const row = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: {
        organicScore: true, organicTier: true, organicComputedAt: true,
        forksCount: true, watchersCount: true, totalCount: true,
        releasesCount: true,
      },
    });

    if (!row?.organicTier) return jsonError("not_found", 404);

    // Attempt live zero-follower query, gracefully degrade on timeout
    let zeroFollowerCount: number | null = null;
    let sampleSize: number | null = null;
    try {
      const [zfRow] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
          COUNT(*)::bigint AS sample_size
        FROM github_user gu
        INNER JOIN star_event se ON se.login = gu.login
        WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
          AND gu."dataVersion" >= 1
      `;
      if (zfRow) {
        zeroFollowerCount = Number(zfRow.zero_count);
        sampleSize = Number(zfRow.sample_size);
      }
    } catch { /* Neon timeout, proceed without zero-follower signal */ }

    const result = computeOrganicScore({
      starsCount:        row.totalCount,
      forksCount:        row.forksCount ?? 0,
      watchersCount:     row.watchersCount ?? 0,
      zeroFollowerCount,
      sampleSize,
      releasesCount:     row.releasesCount ?? null,
    });

    const response: McpOrganicScoreResponse = {
      score:        row.organicScore,
      tier:         row.organicTier,
      tierLabel:    tierLabel(row.organicTier as Parameters<typeof tierLabel>[0]) ?? row.organicTier,
      computedAt:   row.organicComputedAt?.toISOString() ?? null,
      signals:      result.signals,
      weights:      ORGANIC_WEIGHTS,
      activeSignals: result.activeSignals,
      reasons:      result.reasons,
      corpusAccuracy: ORGANIC_CORPUS_ACCURACY,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/mcp/organic-score GET", err);
    return jsonError("internal", 500);
  }
};
