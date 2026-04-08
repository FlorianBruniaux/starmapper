// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type ExploreSummary = {
  totalUsers: number;
  totalTrackedRepos: number;
  totalStarEvents: number;
  totalCountries: number;
  countryList: string[];
};

export const GET = async () => {
  try {
    // pg_class.reltuples = table statistics estimate, updated by ANALYZE/autovacuum.
    // Accuracy: ±1-5% on large tables, but loads in microseconds vs 8s full scan.
    const [estimates, totalTrackedRepos, distinctCountries] = await Promise.all([
      prisma.$queryRaw<{ users: bigint; events: bigint }[]>`
        SELECT
          (SELECT reltuples::bigint FROM pg_class WHERE relname = 'github_user') AS users,
          (SELECT reltuples::bigint FROM pg_class WHERE relname = 'star_event')  AS events
      `,
      prisma.badgeCache.count(),
      // country_stats_mv pre-aggregates 4.3M rows — reads in ~5ms instead of 9s full scan.
      // Falls back to direct DISTINCT scan if MV is missing (new DB instance, rollback, etc.).
      prisma.$queryRaw<{ country: string }[]>`
        SELECT country FROM country_stats_mv ORDER BY country
      `.catch(() =>
        prisma.$queryRaw<{ country: string }[]>`
          SELECT DISTINCT "countryNormalized" AS country
          FROM github_user
          WHERE "countryNormalized" IS NOT NULL
            AND "countryNormalized" NOT LIKE 'http%'
          ORDER BY "countryNormalized"
        `
      ),
    ]);

    const totalUsers = Number(estimates[0]?.users ?? 0);
    const totalStarEvents = Number(estimates[0]?.events ?? 0);
    const countryList = distinctCountries.map((r) => r.country);

    const data: ExploreSummary = {
      totalUsers,
      totalTrackedRepos,
      totalStarEvents,
      totalCountries: countryList.length,
      countryList,
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (err) {
    logError("explore", err);
    return jsonError("internal", 500);
  }
};
