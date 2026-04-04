// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

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
    // 1. Aggregate totals in SQL — replaces findMany(10k) that generated IN($1…$10000)
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
      return jsonError("no_data", 404);
    }

    const total = Number(totals.total);
    const mappedCount = Number(totals.mapped);
    const enrichedUserCount = Number(totals.enriched);
    const botCount = Number(totals.bots);
    const avgFollowers = Math.round(totals.avg_followers ?? 0);

    // Queries 2-5 are independent — run in parallel to save ~3 × Neon round-trip latency
    const [locationRows, companyRows, topUsersRaw, crossRepoGroups] = await Promise.all([
      // 2. Top locations (raw strings) — parseLocation in Node on max 200 rows
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
      // 3. Top companies
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
      // 4. Top users (by followers, max 60)
      prisma.$queryRaw<{
        login: string; name: string | null; followers: number;
        publicRepos: number; location: string | null; company: string | null;
      }[]>`
        SELECT u.login, u.name, u.followers, u."publicRepos", u.location, u.company
        FROM star_event se
        JOIN github_user u USING (login)
        WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
        ORDER BY u.followers DESC
        LIMIT 60
      `,
      // 5. Power stargazers — CTE + INNER JOIN (avoids correlated subquery O(n²))
      prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
        WITH repo_logins AS (
          SELECT DISTINCT login FROM star_event WHERE owner = ${key.owner} AND repo = ${key.repo}
        )
        SELECT se.login, COUNT(*) AS cnt
        FROM star_event se
        INNER JOIN repo_logins USING (login)
        GROUP BY se.login
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 20
      `,
    ]);

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    for (const { location, cnt } of locationRows) {
      const n = Number(cnt);
      const { country, city } = parseLocation(location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + n);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + n);
    }

    const companyCount = new Map(companyRows.map(({ company, cnt }) => [company, Number(cnt)] as [string, number]));

    const topUsers = topUsersRaw.map((u) => ({
      ...u,
      avatarUrl: `https://github.com/${u.login}.png`,
    }));

    // Fetch user details for power stargazers (logins list is small — max 20)
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

    const stats: RepoStats = {
      totalStars: total,
      mappedCount,
      mappingRate: total > 0 ? Math.round((mappedCount / total) * 100) : 0,
      avgFollowers,
      countryCount: countryCount.size,
      topCountries: [...countryCount.entries()].sort((a, b) => b[1] - a[1]),
      topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCompanies: [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topUsers,
      powerStargazers,
      botCount,
      enrichedUserCount,
      isCapped: false, // no longer capped — aggregation done in SQL
    };

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("stats", err);
    return jsonError("internal", 500);
  }
};
