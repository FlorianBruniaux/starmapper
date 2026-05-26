// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import type { OrganicTier } from "@/lib/organic-score";

export type RepoOrganic = {
  score: number | null;
  tier: OrganicTier;
  computedAt: string | null;
  forksCount: number | null;
  watchersCount: number | null;
  totalCount: number;
  openIssuesCount: number | null;
  openPRsCount: number | null;
  latestReleaseTag: string | null;
  latestReleaseUrl: string | null;
  latestReleaseAt: string | null;
  releasesCount: number | null;
};

export type RepoStats = {
  totalStars: number;
  mappedCount: number;
  mappingRate: number;
  avgFollowers: number;
  countryCount: number;
  topCountries: [string, number][];
  topCities: [string, number][];
  topCompanies: [string, number][];
  topUsers: { login: string; name: string | null; followers: number; publicRepos: number; location: string | null; avatarUrl: string; company: string | null }[];
  powerStargazers: { login: string; name: string | null; followers: number; trackedRepos: number; avatarUrl: string }[];
  botCount: number;
  enrichedUserCount: number;
  isCapped: boolean;
  organic: RepoOrganic | null;
  isPartial?: boolean;
};

const isNeonTimeout = (err: unknown): boolean => {
  if (err instanceof Error) {
    return err.message.includes("57014") || err.message.includes("canceling statement due to statement timeout");
  }
  return false;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }

  const key = normalizeOwnerRepo(owner, repo);

  try {
    // 1. badge_cache first — fast lookup, used as fallback when aggregation timeouts
    const badgeRow = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: {
        organicScore: true, organicTier: true, organicComputedAt: true,
        forksCount: true, watchersCount: true, totalCount: true,
        mappedCount: true, countryCount: true,
        openIssuesCount: true,
        openPRsCount: true,
        latestReleaseTag: true, latestReleaseUrl: true, latestReleaseAt: true,
        releasesCount: true,
      },
    });

    // 2. Aggregate totals via JOIN — slow on large repos; catch Neon timeout
    let total = 0, mappedCount = 0, avgFollowers = 0, enrichedUserCount = 0, botCount = 0;
    let joinTimedOut = false;

    try {
      const [totals] = await prisma.$queryRaw<{
        total: bigint;
        mapped: bigint;
        avg_followers: number;
        enriched: bigint;
        bots: bigint;
      }[]>`
        SELECT
          COUNT(*)                                                                                             AS total,
          COUNT(*) FILTER (WHERE u.lat IS NOT NULL AND u.lng IS NOT NULL)                                     AS mapped,
          COALESCE(AVG(u.followers)::int, 0)                                                                  AS avg_followers,
          COUNT(*) FILTER (WHERE u."dataVersion" >= 1)                                                        AS enriched,
          COUNT(*) FILTER (WHERE u."dataVersion" >= 1 AND u.followers < 5 AND u.following < 5 AND u."publicRepos" < 2) AS bots
        FROM star_event se
        JOIN github_user u USING (login)
        WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
      `;

      if (!totals || Number(totals.total) === 0) {
        // No star_event rows — fall through to badge_cache or 404
        if (!badgeRow) return jsonError("no_data", 404);
        joinTimedOut = true;
      } else {
        total = Number(totals.total);
        mappedCount = Number(totals.mapped);
        enrichedUserCount = Number(totals.enriched);
        botCount = Number(totals.bots);
        avgFollowers = Math.round(totals.avg_followers ?? 0);
      }
    } catch (err) {
      if (isNeonTimeout(err)) {
        joinTimedOut = true;
        logError("stats/totals timeout", { owner: key.owner, repo: key.repo });
      } else {
        throw err;
      }
    }

    // Fallback: use badge_cache totals when JOIN timed out
    if (joinTimedOut) {
      if (!badgeRow) return jsonError("no_data", 404);
      total = badgeRow.totalCount;
      mappedCount = badgeRow.mappedCount ?? 0;
    }

    // 3. Location + company + power queries — also JOIN-heavy; catch timeout independently
    let locationRows: { location: string; cnt: bigint }[] = [];
    let companyRows: { company: string; cnt: bigint }[] = [];
    let crossRepoGroups: { login: string; cnt: bigint }[] = [];

    if (!joinTimedOut) {
      try {
        [locationRows, companyRows, crossRepoGroups] = await Promise.all([
          prisma.$queryRaw<{ location: string; cnt: bigint }[]>`
            SELECT u.location, COUNT(*) AS cnt
            FROM star_event se
            JOIN github_user u USING (login)
            WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
              AND u.location IS NOT NULL
            GROUP BY u.location
            ORDER BY cnt DESC
            LIMIT 200
          `,
          prisma.$queryRaw<{ company: string; cnt: bigint }[]>`
            SELECT u.company, COUNT(*) AS cnt
            FROM star_event se
            JOIN github_user u USING (login)
            WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
              AND u.company IS NOT NULL
            GROUP BY u.company
            ORDER BY cnt DESC
            LIMIT 50
          `,
          prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
            SELECT mv.login, mv.cnt
            FROM power_users_mv mv
            INNER JOIN star_event se ON se.login = mv.login
            WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
            ORDER BY mv.cnt DESC
            LIMIT 20
          `,
        ]);
      } catch (err) {
        if (isNeonTimeout(err)) {
          logError("stats/location timeout", { owner: key.owner, repo: key.repo });
          // Keep empty arrays — partial response
        } else {
          throw err;
        }
      }
    }

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    for (const { location, cnt } of locationRows) {
      const n = Number(cnt);
      const { country, city } = parseLocation(location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + n);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + n);
    }

    const companyCount = new Map(companyRows.map(({ company, cnt }) => [company, Number(cnt)] as [string, number]));

    // Fetch user details for power stargazers (small list — max 20)
    const powerLogins = crossRepoGroups.map((g) => g.login);
    const powerUsers = powerLogins.length > 0
      ? await prisma.gitHubUser.findMany({
          where: { login: { in: powerLogins } },
          select: { login: true, name: true, followers: true },
        })
      : [];
    const powerUserMap = new Map(powerUsers.map((u) => [u.login, u]));
    const powerStargazers = crossRepoGroups.map((g) => {
      const u = powerUserMap.get(g.login);
      return {
        login: g.login,
        name: u?.name ?? null,
        followers: u?.followers ?? 0,
        trackedRepos: Number(g.cnt),
        avatarUrl: `https://github.com/${g.login}.png`,
      };
    });

    const organic: RepoOrganic | null = badgeRow?.organicTier
      ? {
          score:            badgeRow.organicScore,
          tier:             badgeRow.organicTier as OrganicTier,
          computedAt:       badgeRow.organicComputedAt?.toISOString() ?? null,
          forksCount:       badgeRow.forksCount,
          watchersCount:    badgeRow.watchersCount,
          totalCount:       badgeRow.totalCount,
          openIssuesCount:  badgeRow.openIssuesCount ?? null,
          openPRsCount:     badgeRow.openPRsCount ?? null,
          latestReleaseTag: badgeRow.latestReleaseTag ?? null,
          latestReleaseUrl: badgeRow.latestReleaseUrl ?? null,
          latestReleaseAt:  badgeRow.latestReleaseAt?.toISOString() ?? null,
          releasesCount:    badgeRow.releasesCount ?? null,
        }
      : null;

    // Use badge_cache countryCount when available and our computed one is empty (timeout)
    const finalCountryCount = countryCount.size > 0
      ? countryCount.size
      : (badgeRow?.countryCount ?? 0);

    const stats: RepoStats = {
      totalStars: total,
      mappedCount,
      mappingRate: total > 0 ? Math.round((mappedCount / total) * 100) : 0,
      avgFollowers,
      countryCount: finalCountryCount,
      topCountries: [...countryCount.entries()].sort((a, b) => b[1] - a[1]),
      topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCompanies: [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topUsers: [],
      powerStargazers,
      botCount,
      enrichedUserCount,
      isCapped: false,
      organic,
      ...(joinTimedOut ? { isPartial: true } : {}),
    };

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("stats", err);
    return jsonError("internal", 500);
  }
};
