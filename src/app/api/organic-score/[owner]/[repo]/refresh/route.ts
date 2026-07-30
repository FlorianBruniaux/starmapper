// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// POST /api/organic-score/[owner]/[repo]/refresh
// Re-fetches GitHub data and recomputes organic score for a repo.
// Rate limited to once per hour per repo (checked via organicComputedAt).

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeOrganicScore } from "@/lib/organic-score";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import type { RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import type { OrganicTier } from "@/lib/organic-score";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

type GhRepo = { forks_count: number; subscribers_count: number; stargazers_count: number; open_issues_count: number };
type GhRelease = { tag_name: string; html_url: string; published_at: string };

export const POST = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  if (process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED !== "true") {
    return jsonError("feature_disabled", 404);
  }

  const { owner: rawOwner, repo: rawRepo } = await params;
  const key = validateOwnerRepo(rawOwner, rawRepo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const badge = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: { totalCount: true, organicComputedAt: true, releasesCount: true, contributorsCount: true },
    });
    if (!badge) return jsonError("not_found", 404);

    if (badge.organicComputedAt && Date.now() - badge.organicComputedAt.getTime() < COOLDOWN_MS) {
      return jsonError("rate_limited", 429);
    }

    const token = process.env.GITHUB_TOKEN;
    const ghHeaders = {
      Accept: "application/vnd.github.v3+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const [ghRes, releaseRes, prSearchRes, releasesCountRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${key.owner}/${key.repo}`, { headers: ghHeaders }),
      fetch(`https://api.github.com/repos/${key.owner}/${key.repo}/releases/latest`, { headers: ghHeaders }),
      fetch(
        `https://api.github.com/search/issues?q=repo:${key.owner}/${key.repo}+type:pr+state:open&per_page=1`,
        { headers: ghHeaders },
      ),
      fetch(
        `https://api.github.com/repos/${key.owner}/${key.repo}/releases?per_page=1`,
        { headers: ghHeaders },
      ),
    ]);
    if (!ghRes.ok) return jsonError("github_error", 502);
    const meta = await ghRes.json() as GhRepo;
    const release: GhRelease | null = releaseRes.ok ? await releaseRes.json() as GhRelease : null;
    const prData: { total_count: number } | null =
      prSearchRes.ok ? await prSearchRes.json() as { total_count: number } : null;
    const openPRsCount = prData?.total_count ?? null;

    // Parse total releases count from Link header pagination
    let releasesCount: number | null = null;
    if (releasesCountRes.ok) {
      const link = releasesCountRes.headers.get("link");
      if (link) {
        const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        releasesCount = match ? parseInt(match[1], 10) : 1;
      } else {
        const items = await releasesCountRes.json() as unknown[];
        releasesCount = items.length;
      }
    }

    let zfRow: { zero_count: bigint; sample_size: bigint } | null = null;
    try {
      const [row] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
          COUNT(*)::bigint AS sample_size
        FROM github_user gu
        INNER JOIN star_event se ON se.login = gu.login
        WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
          AND gu."dataVersion" >= 1
      `;
      zfRow = row ?? null;
    } catch { /* Neon timeout — skip zero-follower signal */ }

    const zeroFollowerCount = zfRow ? Number(zfRow.zero_count) : null;
    const sampleSize = zfRow ? Number(zfRow.sample_size) : null;

    const result = computeOrganicScore({
      starsCount:        meta.stargazers_count,
      forksCount:        meta.forks_count,
      watchersCount:     meta.subscribers_count,
      zeroFollowerCount:  sampleSize && sampleSize > 0 ? zeroFollowerCount : null,
      sampleSize:         sampleSize ?? null,
      releasesCount,
      contributorsCount:  badge.contributorsCount ?? null,
    });

    const now = new Date();
    const latestReleaseAt = release?.published_at ? new Date(release.published_at) : null;

    await prisma.badgeCache.update({
      where: { owner_repo: key },
      data: {
        forksCount:        meta.forks_count,
        watchersCount:     meta.subscribers_count,
        totalCount:        meta.stargazers_count,
        organicScore:      result.score,
        organicTier:       result.tier,
        organicComputedAt: now,
        openIssuesCount:   meta.open_issues_count,
        openPRsCount,
        latestReleaseTag:  release?.tag_name ?? null,
        latestReleaseUrl:  release?.html_url ?? null,
        latestReleaseAt,
        releasesCount,
      },
    });

    const organic: RepoOrganic = {
      score:            result.score,
      tier:             result.tier as OrganicTier,
      computedAt:       now.toISOString(),
      forksCount:       meta.forks_count,
      watchersCount:    meta.subscribers_count,
      totalCount:       meta.stargazers_count,
      openIssuesCount:  meta.open_issues_count,
      openPRsCount,
      latestReleaseTag: release?.tag_name ?? null,
      latestReleaseUrl: release?.html_url ?? null,
      latestReleaseAt:  latestReleaseAt?.toISOString() ?? null,
      releasesCount,
      contributorsCount: badge.contributorsCount ?? null,
    };

    return NextResponse.json({ organic });
  } catch (err) {
    logError("api/organic-score refresh", err);
    return jsonError("internal", 500);
  }
};
