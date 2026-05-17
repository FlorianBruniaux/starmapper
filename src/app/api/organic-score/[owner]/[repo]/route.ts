// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/organic-score/[owner]/[repo]
// Lightweight endpoint: reads organic data directly from badge_cache.
// No star_event dependency — works even when stats API returns 404.

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import type { RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import type { OrganicTier } from "@/lib/organic-score";

export const revalidate = 300;

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  if (!OWNER_REPO_RE.test(rawOwner) || !OWNER_REPO_RE.test(rawRepo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(rawOwner, rawRepo);

  try {
    const row = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: {
        organicScore:      true,
        organicTier:       true,
        organicComputedAt: true,
        forksCount:        true,
        watchersCount:     true,
        totalCount:        true,
        openIssuesCount:   true,
        openPRsCount:      true,
        latestReleaseTag:  true,
        latestReleaseUrl:  true,
        latestReleaseAt:   true,
        releasesCount:     true,
      },
    });

    if (!row?.organicTier) return jsonError("not_found", 404);

    let openPRsCount = row.openPRsCount ?? null;
    if (openPRsCount === null && row.openIssuesCount !== null) {
      try {
        const token = process.env.GITHUB_TOKEN;
        const headers = {
          Accept: "application/vnd.github.v3+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const prRes = await fetch(
          `https://api.github.com/search/issues?q=repo:${key.owner}/${key.repo}+type:pr+state:open&per_page=1`,
          { headers },
        );
        if (prRes.ok) {
          const prData = await prRes.json() as { total_count: number };
          openPRsCount = prData.total_count;
          await prisma.badgeCache.update({
            where: { owner_repo: key },
            data: { openPRsCount },
          });
        }
      } catch { /* non-critical — proceed without split */ }
    }

    const organic: RepoOrganic = {
      score:            row.organicScore,
      tier:             row.organicTier as OrganicTier,
      computedAt:       row.organicComputedAt?.toISOString() ?? null,
      forksCount:       row.forksCount,
      watchersCount:    row.watchersCount,
      totalCount:       row.totalCount,
      openIssuesCount:  row.openIssuesCount ?? null,
      openPRsCount,
      latestReleaseTag: row.latestReleaseTag ?? null,
      latestReleaseUrl: row.latestReleaseUrl ?? null,
      latestReleaseAt:  row.latestReleaseAt?.toISOString() ?? null,
      releasesCount:    row.releasesCount ?? null,
    };

    return NextResponse.json({ organic }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/organic-score GET", err);
    return jsonError("internal", 500);
  }
};
